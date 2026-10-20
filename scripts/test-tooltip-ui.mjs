import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const vault = process.argv[2];
if (vault !== 'Top of the Desk Release QA') throw new Error('Use the isolated release QA vault.');
const run = args => {
  const result = spawnSync('obsidian', [`vault=${vault}`, ...args], { encoding: 'utf8', timeout: 30000 });
  if (result.error || result.status !== 0 || /^Error:/m.test(result.stdout)) throw new Error(result.error?.message || result.stderr || result.stdout);
  return result.stdout.trim();
};
const evaluate = expression => JSON.parse(run(['eval', `code=(async()=>JSON.stringify(await (${expression})))()`]).replace(/^=>\s*/, ''));
const direct = (method, params = {}) => JSON.parse(run(['dev:cdp', `method=${method}`, `params=${JSON.stringify(params)}`]));
let sessionId, sequence = 0;
const send = (method, params = {}) => sessionId
  ? direct('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: ++sequence, method, params }) })
  : direct(method, params);
const hover = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
const doc = 'app.setting.activeTab.containerEl.ownerDocument';
const button = id => `app.setting.activeTab.containerEl.querySelector('[data-toolbar-control="${id}"]')`;
const point = expression => evaluate(`(()=>{const b=${expression};b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
// Electron can throttle timers in an unfocused popout to one second.
const tip = (documentExpression = doc, delay = 1100) => evaluate(`(async()=>{
  await new Promise(r=>setTimeout(r,${delay}));
  const d=${documentExpression},el=d.querySelector('.tod-tooltip:not([hidden])');
  if(!el)return null;const style=d.defaultView.getComputedStyle(el),r=el.getBoundingClientRect();
  return{text:el.textContent,visible:style.display!=='none'&&style.visibility!=='hidden'&&r.width>0&&r.height>0,
    inside:r.left>=0&&r.top>=0&&r.right<=d.documentElement.clientWidth&&r.bottom<=d.documentElement.clientHeight};
})()`);
const checks = [];
const check = (value, label) => { assert.ok(value, label); checks.push(label); };
try {
  direct('Emulation.setFocusEmulationEnabled', { enabled: true });
  const marker = evaluate(`JSON.parse(await app.vault.adapter.read('.demo/marker.json'))`);
  assert.equal(marker.id, 'top-of-the-desk-release-demo');
  run(['eval', `code=app.plugins.plugins['top-of-the-desk'].openSettings('top-of-the-desk')`]);
  const main = direct('Target.getTargetInfo').targetInfo;
  const target = direct('Target.getTargets').targetInfos.find(t => t.openerId === main.targetId && t.type === 'page' && t.title.startsWith('Settings'));
  if (target) sessionId = direct('Target.attachToTarget', { targetId: target.targetId, flatten: false }).sessionId;
  send('Emulation.setFocusEmulationEnabled', { enabled: true });
  hover(1, 1);
  for (const [id, expected] of [['addNotes', 'Note stacks only'], ['unstack', 'Stacks only'], ['edit', 'Edit'], ['resize', 'Resize']]) {
    const p = point(button(id)); hover(p.x, p.y);
    const current = tip();
    check(current?.visible && current.inside && current.text.includes(expected), `Real hover shows ${id} tooltip in the settings window${current ? '' : ' (no tooltip)'}`);
    hover(1, 1);
    check(tip() === null, `Pointer exit hides ${id} tooltip`);
  }
  const p = point(button('addNotes')); hover(p.x, p.y); hover(1, 1);
  check(tip() === null, 'Leaving before the delay does not leave a stale tooltip');
  run(['eval', `code=${button('move')}.focus()`]);
  for (const type of ['keyDown', 'keyUp']) send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  const focused = evaluate(`${doc}.activeElement.getAttribute('aria-label')`);
  check(tip()?.text.startsWith(focused), 'Real Tab navigation displays the focused control tooltip');
  send('Emulation.setFocusEmulationEnabled', { enabled: false });
  if (sessionId) { direct('Target.detachFromTarget', { sessionId }); sessionId = undefined; }
  run(['eval', `code=(async()=>{app.setting.close();const p=app.plugins.plugins['top-of-the-desk'];await p.openDesk();app.workspace.setActiveLeaf(app.workspace.getLeavesOfType('top-of-the-desk-home')[0],{focus:true});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`]);
  check(evaluate(`!app.plugins.plugins['top-of-the-desk']._children.some(c=>c._children?.some(t=>t.root?.matches('.tod-toolbar-settings')))`), 'Closing settings removes its tooltip component');
  direct('Emulation.setFocusEmulationEnabled', { enabled: true });
  const day = point(`document.querySelector('.tod-writing-day')`);
  hover(1, 1); hover(day.x, day.y);
  check(tip('document')?.visible, 'Real hover also displays writing activity tooltips');
  hover(1, 1);
  check(tip('document') === null, 'Writing activity tooltip clears on pointer exit');
} catch (error) {
  checks.push({ error: String(error), stack: error.stack });
  process.exitCode = 1;
} finally {
  if (sessionId) {
    try { send('Emulation.setFocusEmulationEnabled', { enabled: false }); direct('Target.detachFromTarget', { sessionId }); } catch { /* The settings window may already be closed. */ }
  }
  direct('Emulation.setFocusEmulationEnabled', { enabled: false });
  run(['eval', 'code=app.setting.close()']);
  await mkdir('dist/verification', { recursive: true });
  const result = { passed: checks.filter(c => typeof c === 'string').length, checks };
  await writeFile('dist/verification/tooltip-ui.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
