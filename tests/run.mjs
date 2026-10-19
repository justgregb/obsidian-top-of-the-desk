import { build } from 'esbuild';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

// Obsidian runs these stores in a renderer window.
globalThis.window = globalThis;

const dir = await mkdtemp(join(tmpdir(), 'top-of-desk-tests-'));
await build({ entryPoints: ['src/model.ts', 'src/scratch.ts', 'src/word-count.ts'], bundle: true, format: 'cjs', platform: 'node', outdir: dir });
const require = createRequire(import.meta.url);
const { normalizeSettings, deskPaths, safePath, renamePath, movePin, recentPaths, excerpt, validRecovery } = require(join(dir, 'model.js'));
const { ScratchStore, ScratchConflict } = require(join(dir, 'scratch.js'));
const { noteWordCount } = require(join(dir, 'word-count.js'));
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('✓ ' + name); }
function fixture(initial = null) {
  let disk = initial, recovery = null, writes = 0, fail = false, gate;
  const store = new ScratchStore({
    path: () => 'Desk/Scratchpad.md',
    read: async () => disk,
    write: async (expected, text) => {
      if (gate) await gate;
      if (fail) throw new Error('Disk unavailable');
      if (disk !== expected && disk !== text) throw new ScratchConflict();
      disk = text; writes++;
    },
    recovery: value => { recovery = value; }
  });
  return { store, get disk() { return disk; }, set disk(v) { disk = v; }, get recovery() { return recovery; }, get writes() { return writes; }, set fail(v) { fail = v; }, set gate(v) { gate = v; } };
}

await test('Page-heading visibility defaults on and persists when hidden', () => {
  assert.equal(normalizeSettings({}).pageTitle, 'Top of the Desk');
  const hidden = normalizeSettings({ showHeading: false });
  assert.equal(normalizeSettings(JSON.parse(JSON.stringify(hidden))).pageTitle, '');
});
await test('Stack word counts include the full note body and exclude metadata and link destinations', () => {
  assert.equal(noteWordCount('---\ntitle: Hidden words\n---\n# Heading\nHello, world!\n[visible words](https://example.com/private/path)'), 5);
  assert.equal(noteWordCount('[[Folder/Note|two words]] %% hidden comment %% ![[Embedded note]]'), 2);
  assert.equal(noteWordCount('Привет, мир!'), 2);
  assert.equal(noteWordCount('one '.repeat(10000)), 10000);
  assert.equal(noteWordCount('---\ntype: daily\n---\n'), 0);
});
await test('Stored settings are validated; duplicates and unsafe paths are rejected', () => {
  const s = normalizeSettings({ pins: ['A.md', 'A.md', '../B.md', '/absolute.md', '.obsidian/data.md', 3], scratchPath: '../../bad.md', baseEnabled: true, basePath: 'Shelf/Clippings.base' });
  assert.deepEqual(deskPaths(s.items), ['A.md']); assert.equal(s.scratchPath, 'Desk scratchpad.md'); assert.equal(s.widgets.base.path, 'Shelf/Clippings.base');
  assert.equal(safePath('C:\\secret.md', 'md'), null); assert.equal(safePath('Folder/../note.md', 'md'), null);
});
await test('Existing notes become desk surfaces without changing their sources or Base', () => {
  const s = normalizeSettings({ pins: ['Draft.md'], baseEnabled: true, basePath: 'Clippings.base', baseView: 'Read Later', scratchPath: 'Desk/Scratchpad.md' });
  assert.equal(s.version, 10);
  assert.deepEqual(s.widgetOrder, ['item-note-0', 'recents', 'scratchpad', 'base', 'daily', 'activity']);
  assert.equal(s.widgets.desk, undefined); assert.equal(s.widgets['item-note-0'].rows, 2);
  assert.equal(s.widgets.recents.columns, 1); assert.equal(s.widgets.recents.rows, 4);
  assert.equal(s.widgets.base.columns, 2); assert.equal(s.widgets.base.rows, 8);
  assert.equal(s.widgets.base.enabled, true); assert.equal(s.widgets.daily.enabled, true);
  assert.deepEqual(deskPaths(s.items), ['Draft.md']); assert.equal(s.widgets.base.view, 'Read Later'); assert.equal(s.scratchPath, 'Desk/Scratchpad.md');
});
await test('Widget choices survive serialization and invalid or duplicate entries are normalized', () => {
  const s = normalizeSettings({ widgets: { desk: { width: 'full', enabled: false }, recents: { width: 'quarter' }, daily: { width: 'half', enabled: false } }, widgetOrder: ['daily', 'desk', 'daily', 'obsolete'] });
  const saved = normalizeSettings(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(saved, s);
  assert.equal(saved.widgets.desk, undefined);
  assert.equal(saved.widgets.daily.enabled, false);
  assert.deepEqual(saved.widgetOrder, ['daily', 'recents', 'scratchpad', 'base', 'activity']);
  assert.equal(normalizeSettings({ widgets: { desk: { width: 'giant' } } }).widgets.desk, undefined);
});
await test('Grid footprints migrate from widths and retain valid two-dimensional sizes', () => {
  const migrated = normalizeSettings({ version: 2, widgets: { base: { width: 'quarter', enabled: true }, daily: { width: 'quarter' } } });
  assert.deepEqual(migrated.widgets.base, { type: 'base', enabled: true, columns: 1, rows: 4, path: '', view: '', title: '' });
  assert.equal(migrated.widgets.daily.rows, 4);
  const chosen = normalizeSettings({ widgets: { desk: { columns: 3, rows: 2 }, base: { columns: 4, rows: 3 } } });
  assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(chosen))), chosen);
  assert.equal(chosen.widgets.desk, undefined); assert.equal(chosen.widgets.base.rows, 12);
  const invalid = normalizeSettings({ widgets: { recents: { columns: 8, rows: -2 }, daily: { columns: 1.5, rows: '2' } } });
  assert.deepEqual(invalid.widgets.recents, { type: 'recents', enabled: true, columns: 1, rows: 4, path: '', view: '', title: '' });
  assert.deepEqual(invalid.widgets.daily, { type: 'daily', enabled: true, columns: 1, rows: 4, path: '', view: '', title: '' });
});
await test('Multiple Base and folder sources survive reload independently; singleton copies are rejected', () => {
  const settings = normalizeSettings({
    version: 5, items: [{ id: 'draft', type: 'note', path: 'Draft.md' }], scratchPath: 'Notes/Scratchpad.md',
    widgets: {
      desk: { type: 'desk', enabled: false, columns: 3, rows: 2 },
      recents: { type: 'recents', enabled: true, columns: 1, rows: 1 },
      duplicate: { type: 'recents', enabled: true },
      'base-a': { type: 'base', enabled: true, path: 'Research.base', view: 'Reading', title: 'Read next', columns: 2, rows: 2 },
      'base-b': { type: 'base', enabled: true, path: 'Research.base', view: 'Used', title: 'Sources', columns: 1, rows: 3 },
      'folder-a': { type: 'folder', enabled: true, path: 'Projects/Essay', title: '', columns: 1, rows: 1 },
      'folder-b': { type: 'folder', enabled: true, path: '/', title: 'Library', columns: 2, rows: 1 },
    },
    widgetOrder: ['folder-b', 'base-b', 'recents', 'base-a', 'folder-a', 'desk', 'duplicate'],
  });
  const restored = normalizeSettings(JSON.parse(JSON.stringify(settings)));
  assert.deepEqual(restored, settings);
  assert.equal(restored.widgets.duplicate, undefined);
  assert.equal(restored.widgets.desk, undefined); assert.equal(restored.widgets['item-draft'].enabled, false);
  assert.equal(restored.widgets.scratchpad.enabled, false);
  assert.equal(restored.widgets.daily.enabled, false);
  assert.deepEqual(deskPaths(restored.items), []); assert.deepEqual(deskPaths(restored.putAwayItems), ['Draft.md']);
  assert.equal(restored.scratchPath, 'Notes/Scratchpad.md');
  assert.equal(restored.widgets['base-a'].view, 'Reading');
  assert.equal(restored.widgets['base-b'].view, 'Used');
  assert.equal(restored.widgets['item-folder-folder-b'].path, '/');
  assert.deepEqual(restored.widgetOrder.slice(0, 6), ['item-folder-folder-b', 'base-b', 'recents', 'base-a', 'item-folder-folder-a', 'item-draft']);
});
await test('The existing featured Base becomes an independent widget without losing layout or custom title', () => {
  const restored = normalizeSettings({
    version: 4, basePath: 'Research.base', baseView: 'Read later', baseTitle: 'For the essay',
    widgets: { base: { enabled: true, columns: 3, rows: 2 }, recents: { enabled: false, columns: 2, rows: 3 } },
    widgetOrder: ['base', 'daily', 'recents', 'scratchpad', 'activity'],
  });
  assert.equal(restored.version, 10);
  assert.deepEqual(restored.widgets.base, { type: 'base', enabled: true, columns: 3, rows: 8, path: 'Research.base', view: 'Read later', title: 'For the essay' });
  assert.equal(restored.widgets.recents.enabled, false);
  assert.equal(restored.widgets.recents.rows, 12);
  assert.deepEqual(restored.widgetOrder, ['base', 'daily', 'recents', 'scratchpad', 'activity']);
});
await test('File and folder renames retain exact references without affecting similar names', () => {
  assert.equal(renamePath('Desk/Draft.md', 'Desk', 'Writing'), 'Writing/Draft.md');
  assert.equal(renamePath('Desktop/Draft.md', 'Desk', 'Writing'), 'Desktop/Draft.md');
  assert.equal(renamePath('A.md', 'A.md', 'B.md'), 'B.md');
});
await test('Reordering works in both directions and moving to boundaries', () => {
  assert.deepEqual(movePin(['a','b','c'], 'a', 2), ['b','c','a']);
  assert.deepEqual(movePin(['a','b','c'], 'c', 0), ['c','a','b']);
  assert.deepEqual(movePin(['a','b','c'], 'b', 99), ['a','c','b']);
});
await test('Recents include pinned and scratch notes, excluding missing, duplicate, and non-note files', () => {
  assert.deepEqual(recentPaths(['A.md','A.md','B.md','Scratch.md','X.base','gone.md','C.md'], p => p !== 'gone.md'), ['A.md','B.md','Scratch.md','C.md']);
});
await test('Previews omit frontmatter, headings, images, and markup while preserving link labels', () => {
  assert.equal(excerpt('---\ntype: secret\n---\n# Title\n![[image.png]]\nA **small** [[Actual|idea]] and [link](https://example.com).'), 'A small idea and link.');
  assert.equal(excerpt('Ignored', 'Explicit summary'), 'Explicit summary');
});
await test('Opening an empty scratchpad does not create a note', async () => {
  const f = fixture(); await f.store.load(null); await f.store.flush();
  assert.equal(f.disk, null); assert.equal(f.writes, 0); f.store.stop();
});
await test('Scratch text has synchronous recovery and persists as exact Markdown', async () => {
  const f = fixture(); await f.store.load(null); f.store.edit('An idea\n\n[[A note]]');
  assert.equal(f.recovery.text, 'An idea\n\n[[A note]]');
  await f.store.flush(); assert.equal(f.disk, 'An idea\n\n[[A note]]'); assert.equal(f.recovery, null); f.store.stop();
});
await test('Body editing preserves the full frontmatter block and CRLF line endings', async () => {
  const prefix = '\uFEFF---\r\ntype: daily\r\ntags: [journal]\r\n---\r\n';
  const f = fixture(prefix + 'Original\r\nSecond line'); await f.store.load(null);
  assert.equal(f.store.body, 'Original\nSecond line');
  f.store.editBody('Updated\nBody'); await f.store.flush();
  assert.equal(f.disk, prefix + 'Updated\r\nBody');
  f.store.editBody(''); await f.store.flush();
  assert.equal(f.disk, prefix); f.store.stop();
});
await test('A frontmatter-only note accepts body text without joining its closing delimiter', async () => {
  const f = fixture('---\ntype: daily\n---'); await f.store.load(null);
  assert.equal(f.store.body, ''); f.store.editBody('An entry'); await f.store.flush();
  assert.equal(f.disk, '---\ntype: daily\n---\nAn entry'); f.store.stop();
});
await test('Body editing cannot overwrite external changes to hidden metadata', async () => {
  const f = fixture('---\ntype: daily\n---\nOriginal'); await f.store.load(null);
  f.store.editBody('My entry'); f.disk = '---\ntype: journal\n---\nOriginal';
  await f.store.flush();
  assert.equal(f.disk, '---\ntype: journal\n---\nOriginal');
  assert.equal(f.store.conflict, true); assert.equal(f.store.body, 'My entry'); f.store.stop();
});
await test('Unclosed frontmatter and new delimiter-like body text stay visible while editing', async () => {
  const f = fixture('---\ntype: daily'); await f.store.load(null);
  assert.equal(f.store.body, '---\ntype: daily'); f.store.stop();
  const g = fixture(''); await g.store.load(null);
  g.store.editBody('---\nA thought\n---\nMore');
  assert.equal(g.store.body, '---\nA thought\n---\nMore');
  await g.store.flush(); assert.equal(g.disk, g.store.body); g.store.stop();
});
await test('An external edit cannot be overwritten by an older scratch draft', async () => {
  const f = fixture('Original'); await f.store.load(null); f.store.edit('My draft'); f.disk = 'Edited elsewhere';
  await f.store.flush(); assert.equal(f.disk, 'Edited elsewhere'); assert.equal(f.store.conflict, true); assert.equal(f.recovery.text, 'My draft'); f.store.stop();
});
await test('A deleted scratchpad cannot be silently recreated with a pending old draft', async () => {
  const f = fixture('Original'); await f.store.load(null); f.store.edit('My draft'); f.disk = null;
  await f.store.flush(); assert.equal(f.disk, null); assert.equal(f.store.conflict, true); f.store.stop();
});
await test('Text typed during an in-flight save is written afterwards in order', async () => {
  const f = fixture('Original'); await f.store.load(null);
  let release; f.gate = new Promise(resolve => { release = resolve; });
  f.store.edit('First'); const saving = f.store.flush(); f.store.edit('Second'); release();
  await saving; assert.equal(f.disk, 'Second'); assert.equal(f.store.dirty, false); assert.equal(f.writes, 2); f.store.stop();
});
await test('Recovered draft resumes only when its disk baseline still matches', async () => {
  const f = fixture('Original'); await f.store.load({ path: 'Desk/Scratchpad.md', baseline: 'Original', text: 'Recovered' });
  await f.store.flush(); assert.equal(f.disk, 'Recovered'); f.store.stop();
  const g = fixture('Newer'); await g.store.load({ path: 'Desk/Scratchpad.md', baseline: 'Original', text: 'Recovered' });
  await g.store.flush(); assert.equal(g.disk, 'Newer'); assert.equal(g.store.text, 'Recovered'); assert.equal(g.store.conflict, true); g.store.stop();
});
await test('Storage failure retains recovery and a retry saves successfully', async () => {
  const f = fixture(); await f.store.load(null); f.fail = true; f.store.edit('Keep me'); await f.store.flush();
  assert.equal(f.recovery.text, 'Keep me'); assert.ok(f.store.error);
  f.fail = false; await f.store.flush(); assert.equal(f.disk, 'Keep me'); assert.equal(f.store.error, ''); f.store.stop();
});
await test('Clean scratchpad reflects external edits', async () => {
  const f = fixture('Old'); await f.store.load(null); f.disk = 'New'; await f.store.refresh();
  assert.equal(f.store.text, 'New'); assert.equal(f.store.dirty, false); f.store.stop();
});
await test('Saving a conflict copy does not discard text typed while the copy was being written', async () => {
  const f = fixture('Original'); await f.store.load(null); f.store.edit('Draft'); f.disk = 'External'; await f.store.flush();
  f.store.edit('Draft updated'); await f.store.copiedDraft('Draft');
  assert.equal(f.store.text, 'Draft updated'); assert.equal(f.store.dirty, true);
  await f.store.copiedDraft('Draft updated'); assert.equal(f.store.text, 'External'); assert.equal(f.recovery, null); f.store.stop();
});
await test('Recovery from a different scratchpad cannot be applied to this note', () => {
  assert.equal(validRecovery({ path: 'Other.md', baseline: null, text: 'Wrong file' }, 'Desk/Scratchpad.md'), null);
});
console.log(`\n${passed} tests passed.`);
