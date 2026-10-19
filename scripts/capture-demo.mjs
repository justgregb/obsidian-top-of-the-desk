import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const vault=process.argv[2];
if(!vault) throw new Error('Usage: node scripts/capture-demo.mjs "Top of the Desk Demo" [output-directory]');
const output=resolve(process.argv[3] || resolve(repo,'images')); await mkdir(output,{recursive:true});
function cli(args){const r=spawnSync('obsidian',[`vault=${vault}`,...args],{encoding:'utf8',maxBuffer:10*1024*1024});if(r.error)throw r.error;if(r.status!==0||/Error:/.test(r.stdout))throw new Error(r.stderr||r.stdout);return r.stdout.trim();}
const guard=`const marker=JSON.parse(await app.vault.adapter.read('.demo/marker.json'));if(marker.id!=='top-of-the-desk-release-demo')throw new Error('Refusing to alter a non-demo vault.');`;
const evaluate=code=>cli(['eval',`code=(async()=>{${guard}${code}})()`]);
const settle=()=>evaluate(`await document.fonts.ready; await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));`);
const view=`const view=app.workspace.getLeavesOfType('top-of-the-desk-home')[0].view;`;
const shot=async name=>{settle();cli(['dev:screenshot',`path=${resolve(output,name)}`]);console.log(`Captured ${name}`);};
const before=cli(['eval','code=JSON.stringify({theme:app.getTheme(),sidebar:app.workspace.leftSplit.collapsed})']);
const original=JSON.parse(before.replace(/^=>\s*/,''));
// Verify isolation BEFORE changing the viewport or appearance.
evaluate('return marker.id;');
try {
  cli(['dev:cdp','method=Emulation.setDeviceMetricsOverride','params='+JSON.stringify({width:1600,height:850,deviceScaleFactor:1,mobile:false})]);
  evaluate(`app.workspace.leftSplit.collapse(); app.changeTheme('moonstone');`);
  cli(['command','id=top-of-the-desk:open-desk']);
  settle();
  await shot('01-desk-light.png');
  evaluate(`app.changeTheme('obsidian');`);
  await shot('02-desk-dark.png');
  evaluate(`app.changeTheme('moonstone'); ${view} const anchor=view.deskItems.itemAnchor('observations');if(!anchor)throw new Error('Demo stack is missing.'); view.deskItems.popup.close(false);view.deskItems.popup.open('observations',anchor);`);
  await shot('03-note-stack.png');
  evaluate(`${view} view.deskItems.popup.close(false);app.plugins.plugins['top-of-the-desk'].pickDesk();`);
  await shot('04-add-to-desk.png');
  evaluate(`const p=app.plugins.plugins['top-of-the-desk'];for(const dialog of [...p.widgetDialogs])dialog.close();p.selectStackWidget('writing','scratchpad');`);
  await shot('05-scratchpad.png');
  evaluate(`app.plugins.plugins['top-of-the-desk'].selectStackWidget('writing','daily');`);
  await writeFile(resolve(output,'capture-info.json'),JSON.stringify({pluginVersion:'0.9.50',obsidian:cli(['version']),capturedAt:new Date().toISOString(),viewport:{width:1600,height:850},theme:'Obsidian default, light and dark; teal accent',syntheticData:true,images:['01-desk-light.png','02-desk-dark.png','03-note-stack.png','04-add-to-desk.png','05-scratchpad.png']},null,2)+'\n');
} finally {
  evaluate(`const p=app.plugins.plugins['top-of-the-desk'];for(const dialog of [...p.widgetDialogs])dialog.close();${view}view.deskItems.popup.close(false);app.changeTheme(${JSON.stringify(original.theme)});${original.sidebar?'app.workspace.leftSplit.collapse()':'app.workspace.leftSplit.expand()'};`);
  cli(['dev:cdp','method=Emulation.clearDeviceMetricsOverride']);
}
