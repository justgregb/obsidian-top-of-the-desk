import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const dir = await mkdtemp(join(tmpdir(), 'top-of-desk-review-'));
const require = createRequire(import.meta.url);
let passed = 0;
const test = async (name, run) => { await run(); passed++; console.log('✓ ' + name); };
try {
  const outfile = join(dir, 'review.cjs');
  await build({ stdin: { contents: `
    export * from './src/model'; export * from './src/validation';
    export * from './src/recent-history'; export * from './src/web-history';
    export * from './src/source-catalog'; export { TFile, TFolder } from 'obsidian';
  `, resolveDir: process.cwd() }, outfile, bundle: true, platform: 'node', format: 'cjs', plugins: [{ name: 'host', setup(b) {
    b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
    b.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: `
      export class Component {} export class Events {} export class Notice {} export const Keymap = {};
      export class TFile { constructor(path) { this.path=path; this.name=path.split('/').pop(); this.basename=this.name.replace(/\\.[^.]+$/, ''); this.extension=path.split('.').pop(); } }
      export class TFolder { constructor(path) { this.path=path; this.name=path; } }
      export function setTooltip() {}
    ` }));
  } }] });
  const { normalizeSettings, normalizeDeskItems, safePath, stripControls, singleLine, RecentHistory, WebHistory, SourceCatalog, TFile, TFolder } = require(outfile);
  await test('Control sanitization rejects unsafe paths and preserves Unicode titles', () => {
    for (let n = 0; n < 32; n++) assert.equal(safePath(`Notes/a${String.fromCharCode(n)}b.md`), null);
    assert.equal(safePath('Заметки/🌊 море.md'), 'Заметки/🌊 море.md');
    assert.equal(stripControls('🌊\u0000По\nморю'), '🌊Поморю');
    assert.equal(singleLine(' A\u0000\n B\u007f ', true), 'A B');
    const [stack] = normalizeDeskItems([{ type: 'stack', paths: ['A.md', 'B.md'], name: 'A\u0000B', description: 'First\nsecond' }]);
    assert.equal(stack.name, 'AB'); assert.equal(stack.description, 'First second');
  });
  await test('Malformed saved settings fail closed without losing valid entries', () => {
    for (const input of [null, false, 42, 'wrong', [], {widgets:[null,2]}, {items:[null,2,[],{type:'stack',paths:{}}]}]) assert.doesNotThrow(() => normalizeSettings(input));
    const s = normalizeSettings(JSON.parse('{"version":10,"items":[null,{"type":"note","path":"Draft.md"}],"widgets":{"__proto__":{"type":"image"},"bad":null}}'));
    assert.deepEqual(s.items.map(i=>i.path), ['Draft.md']); assert.equal(s.widgets.__proto__, undefined);
    assert.equal({}.type, undefined);
  });
  await test('Recent history treats malformed records as unknown rather than inventing dates', () => {
    const h = new RecentHistory({ loadLocalStorage: () => [null, 4, [], {path:'A.md',openedAt:'yesterday'}, {path:'B.md',openedAt:NaN}, {path:'C.md',openedAt:100}], workspace:{getLastOpenFiles:()=>[]} });
    assert.deepEqual(h.entries.map(i=>i.openedAt), [null,null,100]);
  });
  await test('Web history ignores malformed records, deduplicates, and uses the same seven-day scope', async () => {
    const now = Date.now(), data = [null, [], 3, {url:'https://example.com',accessTs:'today'},
      {url:'https://old.example.com',accessTs:now-8*86400000}, {url:'https://future.example.com',accessTs:now+86400000},
      {url:'javascript:alert(1)',accessTs:now}, {url:'https://example.com/',title:'Old title',accessTs:now-1000},
      {url:'https://example.com/',title:'Hello\u0000\nworld',accessTs:now}];
    const viewer = {db:{getHistoryItems:async()=>data}};
    const h = new WebHistory({internalPlugins:{getEnabledPluginById:()=>viewer}},()=>{});
    await h.refresh();
    assert.equal(h.entries.length,1); assert.equal(h.entries[0].title,'Hello world'); assert.equal(h.entries[0].openedAt,now);
  });
  await test('File choices enumerate only on first use and after explicit invalidation', () => {
    let scans=0, noteScans=0;
    const root=new TFolder('/'), note=new TFile('Draft.md'), pdf=new TFile('Paper.pdf'), unsupported=new TFile('Script.exe');
    const vault={ getRoot:()=>root, getAllLoadedFiles:()=>{scans++;return [root,note,pdf,unsupported];}, getFileByPath:path=>path===note.path?note:null,
      getMarkdownFiles:()=>{noteScans++;return [note];} };
    const catalog=new SourceCatalog(vault);
    assert.equal(catalog.note('Draft.md'),note); assert.equal(scans+noteScans,0);
    assert.equal(catalog.note('draft.md'),note); catalog.note('DRAFT.MD'); assert.equal(noteScans,1);
    assert.equal(catalog.all().length,3); catalog.all(); catalog.ofType('pdf'); catalog.ofType('pdf'); assert.equal(scans,1);
    catalog.invalidate(); catalog.all(); assert.equal(scans,2);
  });
  console.log(`\n${passed} review regression tests passed.`);
} finally { await rm(dir,{recursive:true,force:true}); }
