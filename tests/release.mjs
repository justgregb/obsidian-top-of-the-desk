import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

// Obsidian runs these stores in a renderer window.
globalThis.window = globalThis;

const dir = await mkdtemp(join(tmpdir(), 'top-of-desk-release-tests-'));
const require = createRequire(import.meta.url);
let passed = 0;
const test = (name, run) => { run(); passed++; console.log('✓ ' + name); };
try {
  await build({ entryPoints: ['src/model.ts', 'src/recent-history.ts', 'src/source-types.ts', 'src/widget-layout.ts', 'src/writing-activity.ts'], bundle: true, format: 'cjs', platform: 'node', outdir: dir,
    plugins: [{ name: 'host-boundary', setup(b) {
      b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
      b.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: 'export class Component {} export class Notice {} export class TFolder {} export const editorInfoField = {}; export function setTooltip() {}' }));
    } }]
  });
  const { normalizeSettings, widgetDefaults } = require(join(dir, 'model.js'));
  const { recentGroup, RecentHistory } = require(join(dir, 'recent-history.js'));
  const { fileSourceType, sourceWebUrl } = require(join(dir, 'source-types.js'));
  const { resolveWidgetLayout, plannedWidgetMove, commitWidgetMove, resizeWidgetLayout } = require(join(dir, 'widget-layout.js'));
  const { WritingActivity } = require(join(dir, 'writing-activity.js'));
  test('Recent history uses seven local calendar days and rejects future or undated entries', () => {
    const now = new Date(2026, 9, 26, 12), oldest = new Date(2026, 9, 20).getTime();
    assert.equal(recentGroup(new Date(2026, 9, 26).getTime(), now).key, 'today');
    assert.equal(recentGroup(oldest, now).key, 'earlier');
    for (const t of [oldest - 1, now.getTime() + 1, null, NaN]) assert.equal(recentGroup(t, now), null);
  });
  test('Recent files deduplicate, retain opening times, and follow folder renames', () => {
    let saved;
    const app = { loadLocalStorage: () => [{path:'Draft.md', openedAt:100}, {path:'Draft.md',openedAt:99}], saveLocalStorage: (_,v) => { saved=v; }, vault: {getFileByPath: path => ({path,extension:path.split('.').pop()})}, workspace: {getLastOpenFiles:()=>[]} };
    const h = new RecentHistory(app); h.open('Draft.md'); h.open('Draft.md');
    assert.equal(h.entries.length, 1); assert.ok(h.entries[0].openedAt > 100);
    h.open('Research/Reading.pdf'); h.rename('Research','Library');
    assert.equal(saved[0].path,'Library/Reading.pdf');
  });
  test('Source types cover supported files and reject executable or credential-bearing URLs', () => {
    for (const [ext,kind] of Object.entries({md:'note',base:'base',canvas:'canvas',pdf:'pdf',WAV:'audio',svg:'image'})) assert.equal(fileSourceType(ext),kind);
    assert.equal(fileSourceType('exe'),null);
    for(const url of ['javascript:alert(1)','file:///private/file','https://user:pass@example.com']) assert.equal(sourceWebUrl(url),null);
    assert.equal(sourceWebUrl('https://example.com/read?q=one#two'),'https://example.com/read?q=one#two');
  });
  const fixture = () => normalizeSettings({version:10,items:[],widgets:Object.fromEntries(Array.from({length:40},(_,i)=>['image-'+i,{...widgetDefaults('image'),enabled:true,columns:i%4+1,rows:i%3*2+2,path:'Media/'+i+'.png'}])),widgetOrder:Array.from({length:40},(_,i)=>'image-'+i)});
  function validLayout(layout,columns) {
    const rects=[...layout.values()];
    for(const r of rects) assert.ok(r.column>=1 && r.row>=1 && r.column+r.columns-1<=columns);
    for(let i=0;i<rects.length;i++) for(let j=i+1;j<rects.length;j++) {
      const a=rects[i],b=rects[j]; assert.ok(a.column+a.columns<=b.column || b.column+b.columns<=a.column || a.row+a.rows<=b.row || b.row+b.rows<=a.row,'Overlapping desk items');
    }
  }
  test('Responsive layouts keep every visible item in bounds without overlapping',()=>{
    const s=fixture(); for(const columns of [1,2,4]) { const l=resolveWidgetLayout(s,columns); assert.equal(l.size,40); validLayout(l,columns); }
  });
  test('Moving and resizing items survive serialization without overlaps or preview mutations',()=>{
    const s=fixture(),before=JSON.stringify(s),current=resolveWidgetLayout(s,4),next=plannedWidgetMove(s,'image-0',{column:3,row:10},4);
    assert.equal(JSON.stringify(s),before); validLayout(next,4); commitWidgetMove(s,'image-0',4,current,next);
    resizeWidgetLayout(s,'image-1',{columns:3,rows:8},4); const restored=normalizeSettings(JSON.parse(JSON.stringify(s)));
    for(const columns of [1,2,4]) validLayout(resolveWidgetLayout(restored,columns),columns);
    assert.equal(restored.widgets['image-1'].columns,3); assert.equal(restored.widgets['image-1'].rows,8);
  });
  const doc = s => ({toString:()=>s});
  test('Writing activity counts net changes once, supports deletion, and survives reload',()=>{
    let saved=null; const app={loadLocalStorage:()=>saved,saveLocalStorage:(_,v)=>{saved=structuredClone(v);}};
    const a=new WritingActivity(app); a.start(); const owner={},x=doc('one'),y=doc('one two'),z=doc('one two three');
    a.capture(owner,x,y,'2026-10-19'); a.capture(owner,y,z,'2026-10-19'); a.flushAll(); a.flushAll(); assert.equal(a.total('2026-10-19'),2);
    a.capture(owner,z,x,'2026-10-19'); a.flushAll(); assert.equal(a.total('2026-10-19'),0);
    a.capture(owner,x,y,'2026-10-19'); a.stop(); assert.equal(new WritingActivity(app).total('2026-10-19'),1);
    assert.deepEqual(Object.keys(saved).sort(),['days','startedOn','version']);
  });
  test('Writing activity separates edits that cross midnight',()=>{
    const a=new WritingActivity({loadLocalStorage:()=>null,saveLocalStorage:()=>{}}); a.start(); const owner={},x=doc(''),y=doc('one'),z=doc('one two three');
    a.capture(owner,x,y,'2026-10-19'); a.capture(owner,y,z,'2026-10-20'); a.stop(); assert.equal(a.total('2026-10-19'),1); assert.equal(a.total('2026-10-20'),2);
  });
  console.log(`\n${passed} release regression tests passed.`);
} finally { await rm(dir,{recursive:true,force:true}); }
