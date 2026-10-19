import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const vault=process.argv[2]; if(vault!=='Top of the Desk Release QA') throw Error('Use the isolated QA vault.');
const run=args=>{const r=spawnSync('obsidian',[`vault=${vault}`,...args],{encoding:'utf8',timeout:30000,killSignal:'SIGKILL',maxBuffer:2000000});if(r.status!==0 || /^Error:/m.test(r.stdout))throw Error(r.stderr||r.stdout);return r.stdout.trim();};
const guard="const marker=JSON.parse(await app.vault.adapter.read('.demo/marker.json'));if(marker.id!=='top-of-the-desk-release-demo')throw Error('Not demo');const p=app.plugins.plugins['top-of-the-desk'];const view=app.workspace.getLeavesOfType('top-of-the-desk-home')[0].view;";
const evaluate=code=>JSON.parse(run(['eval',`code=(async()=>{${guard}${code}})()`]).replace(/^=>\s*/,''));
const cdp=(method,params)=>run(['dev:cdp',`method=${method}`,`params=${JSON.stringify(params)}`]);
const settle=()=>evaluate('await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true;');
const checks=[];
const before=evaluate('return {settings:p.settings,sidebar:app.workspace.leftSplit.collapsed,theme:app.getTheme()};');
await mkdir('dist/verification',{recursive:true});
try {
  evaluate('for(const dialog of [...p.widgetDialogs])dialog.close();app.workspace.leftSplit.collapse();return true;');
  cdp('Emulation.setDeviceMetricsOverride',{width:1400,height:1000,deviceScaleFactor:1,mobile:false});settle();
  const original=evaluate('return view.widgetGrid.layout.get("item-morning");');
  // Exercise the key handler in one evaluation to avoid cross-command focus changes.
  evaluate('const el=view.widgets.get("item-morning").el;const grip=el.querySelector("button[aria-label=Move]");grip.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true,cancelable:true}));return true;');settle();
  assert.equal(evaluate('return view.widgetGrid.layout.get("item-morning").row;'),original.row+1);checks.push('Keyboard Move handler with ArrowDown');
  evaluate('document.querySelector(".tod-undo-notice button").click();return true;');settle();
  assert.equal(evaluate('return view.widgetGrid.layout.get("item-morning").row;'),original.row);checks.push('Undo keyboard move');
  const coords=evaluate('const el=view.widgets.get("coast").el;const handle=[...el.querySelectorAll("[data-widget-drag]")].find(e=>e.tagName!=="BUTTON"&&e.getBoundingClientRect().width>0);if(!handle)throw Error("Heading handle missing");const r=handle.getBoundingClientRect(),target=view.widgets.get("item-morning").el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,tx:target.x+20,ty:target.y+20,before:JSON.stringify(view.widgetGrid.layout.get("coast"))};');
  cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:coords.x,y:coords.y});
  cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:coords.x,y:coords.y,button:'left',buttons:1,clickCount:1});
  for(let i=1;i<=6;i++) cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:coords.x+(coords.tx-coords.x)*i/6,y:coords.y+(coords.ty-coords.y)*i/6,button:'left',buttons:1});
  cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:coords.tx,y:coords.ty,button:'left',buttons:0,clickCount:1});settle();
  assert.notEqual(evaluate('return JSON.stringify(view.widgetGrid.layout.get("coast"));'),coords.before);checks.push('Mouse drag from visible heading commits placement');
  evaluate('document.querySelector(".tod-undo-notice button").click();return true;');settle();checks.push('Undo heading drag');
  evaluate('p.pickDesk();return true;');settle();
  assert.ok(evaluate('return !!document.querySelector(".prompt-input");'));checks.push('Add-to-desk dialog opens');
  cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});settle();
  assert.equal(evaluate('return p.widgetDialogs.size;'),0);checks.push('Escape closes Add-to-desk dialog');
  for(const width of [1400,900,500]) {
    cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});settle();
    const dimensions=evaluate('const grid=view.contentEl.querySelector(".tod-widgets"),rect=grid.getBoundingClientRect();const items=[...grid.children].filter(e=>e.classList.contains("tod-widget")&&!e.hidden).map(e=>({id:e.dataset.widget,r:e.getBoundingClientRect().toJSON()})).filter(x=>x.r.width>0);return {width:rect.width,scrollWidth:grid.scrollWidth,clientWidth:grid.clientWidth,columns:view.gridColumns,items};');
    assert.ok(dimensions.scrollWidth<=dimensions.clientWidth+2,'Horizontal overflow at '+width);
    for(let i=0;i<dimensions.items.length;i++)for(let j=i+1;j<dimensions.items.length;j++) {
      const a=dimensions.items[i].r,b=dimensions.items[j].r;
      assert.ok(a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1,'Overlap at '+width+': '+JSON.stringify([dimensions.items[i],dimensions.items[j]]));
    }
    checks.push(`No overlap or horizontal overflow at ${width}px (${dimensions.columns} columns)`);
    run(['dev:screenshot',`path=${resolve('dist/verification',`desk-${width}.png`)}`]);
  }
  cdp('Emulation.setDeviceMetricsOverride',{width:1400,height:1000,deviceScaleFactor:1,mobile:false});
  evaluate('app.changeTheme("obsidian");return true;');settle();
  run(['dev:screenshot', 'path='+resolve('dist/verification/desk-dark.png')]);checks.push('Dark appearance captured');
  const report={passed:checks.length,checks};await writeFile('dist/verification/ui.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
} finally {
  evaluate(`p.settings=${JSON.stringify(before.settings)};p.clearUndo();for(const dialog of [...p.widgetDialogs])dialog.close();p.changed();await p.whenSaved();app.changeTheme(${JSON.stringify(before.theme)});app.workspace.leftSplit.${before.sidebar?'collapse':'expand'}();return true;`);
  cdp('Emulation.clearDeviceMetricsOverride',{});
  cdp('Emulation.setFocusEmulationEnabled',{enabled:false});
}
