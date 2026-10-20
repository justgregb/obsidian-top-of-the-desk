import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const dir = await mkdtemp(join(tmpdir(), 'tod-web-visits-'));
const RealDate = Date;
let now = new Date(2026, 9, 20, 12).getTime(), passed = 0;
globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
class Emitter {
  handlers = new Map();
  on(event, callback) { const list = this.handlers.get(event) || new Set(); list.add(callback); this.handlers.set(event, list); return () => list.delete(callback); }
  emit(event, ...args) { for (const handler of this.handlers.get(event) || []) handler(...args); }
  addEventListener(event, callback) { this.on(event, callback); }
  removeEventListener(event, callback) { this.handlers.get(event)?.delete(callback); }
}
const test = async (name, run) => { await run(); passed++; console.log('✓ ' + name); };
try {
  const outfile = join(dir, 'web.cjs');
  await build({ entryPoints: ['src/web-history.ts'], outfile, bundle: true, platform: 'node', format: 'cjs', plugins: [{ name: 'host', setup(b) {
    b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'host' }));
    b.onLoad({ filter: /.*/, namespace: 'host' }, () => ({ contents: `
      export class Component {
        cleanups=[]; children=[];
        load(){this.onload?.();}
        unload(){this.onunload?.();this.cleanups.forEach(f=>f());this.children.forEach(c=>c.unload());}
        registerEvent(off){this.cleanups.push(off);}
        register(off){this.cleanups.push(off);}
        registerDomEvent(el,event,callback){el.addEventListener(event,callback);this.cleanups.push(()=>el.removeEventListener(event,callback));}
        addChild(child){this.children.push(child);child.load();return child;}
        removeChild(child){child.unload();this.children=this.children.filter(c=>c!==child);}
      }
      export class Events {} export class Notice {} export class TFolder {} export class View {} export const Keymap={};
    ` }));
  } }] });
  const { WebHistory } = createRequire(import.meta.url)(outfile);
  function fixture(saved = []) {
    const doc = Object.assign(new Emitter(), { visibilityState: 'visible', focused: true, hasFocus() { return this.focused; } });
    const win = Object.assign(new Emitter(), { document: doc, setTimeout, clearTimeout }); doc.defaultView = win; globalThis.window = win;
    const workspace = Object.assign(new Emitter(), { activeLeaf: null, getActiveViewOfType() { return this.activeLeaf?.view; }, onLayoutReady(f) { f(); }, iterateAllLeaves() {} });
    let enabled = true, data = [], stored = structuredClone(saved), notifications = 0, reads = 0;
    const viewer = { db: { getHistoryItems: async () => { reads++; return structuredClone(data); } } };
    const core = Object.assign(new Emitter(), { getEnabledPluginById: () => enabled ? viewer : null });
    const app = { workspace, internalPlugins: core, loadLocalStorage: () => structuredClone(stored), saveLocalStorage: (_key, value) => { stored = structuredClone(value); } };
    let h = new WebHistory(app, () => notifications++); h.load();
    const flush = async () => { clearTimeout(h.timer); h.timer = 0; await h.refresh(); };
    const leaf = (url, type = 'webviewer') => {
      const value = { view: { getViewType: () => type, containerEl: { ownerDocument: doc, querySelector: () => null } }, getViewState: () => ({ type, state: { url } }) };
      value.view.leaf = value; return value;
    };
    return {
      get h() { return h; }, get stored() { return stored; }, get reads() { return reads; }, get notifications() { return notifications; },
      doc, win, workspace, core, viewer, leaf, flush,
      set data(value) { data = value; }, get data() { return data; }, set enabled(value) { enabled = value; core.emit('change'); },
      async select(value) { workspace.activeLeaf = value; workspace.emit('active-leaf-change', value); await flush(); },
      async history() { workspace.emit('webviewer:update-history'); await flush(); },
      async reload() { h.unload(); workspace.activeLeaf = null; h = new WebHistory(app, () => notifications++); h.load(); await flush(); },
      close() { h.unload(); },
    };
  }
  const url = 'https://example.com/article', yesterday = () => now - 86400000;
  await test('Returning to an old open tab moves it to today and survives reload', async () => {
    const f = fixture(); try {
      f.data = [{ url, title: 'Article', accessTs: yesterday() }]; await f.flush();
      assert.equal(f.h.entries[0].openedAt, yesterday());
      await f.select(f.leaf(url)); assert.equal(f.h.entries[0].openedAt, now);
      assert.deepEqual(f.stored, [{ url, historyAt: yesterday(), viewedAt: now }]);
      await f.reload(); assert.equal(f.h.entries[0].openedAt, now);
    } finally { f.close(); }
  });
  await test('Closing an untouched background tab and unrelated history events do not renew it', async () => {
    const f = fixture(); try {
      f.data = [{ url, accessTs: yesterday() }]; await f.flush();
      await f.select(f.leaf('', 'markdown')); await f.history();
      assert.equal(f.h.entries[0].openedAt, yesterday()); assert.equal(f.stored.length, 0);
    } finally { f.close(); }
  });
  await test('Returning to Obsidian renews its visible page, without marking hidden windows as viewed', async () => {
    const f = fixture(); try {
      f.data = [{ url, accessTs: yesterday() }]; await f.flush(); f.doc.focused = false;
      await f.select(f.leaf(url)); assert.equal(f.h.entries[0].openedAt, yesterday());
      f.doc.focused = true; f.win.emit('focus'); await f.flush(); assert.equal(f.h.entries[0].openedAt, now);
      const viewed = now; now += 60000; await f.history(); assert.equal(f.h.entries[0].openedAt, viewed);
    } finally { f.close(); }
  });
  await test('Leaving a page read across midnight records today, and repeat events do not churn', async () => {
    const f = fixture(); try {
      f.data = [{ url, accessTs: yesterday() }]; await f.flush(); const page = f.leaf(url);
      await f.select(page); const before = f.notifications;
      await f.select(page); assert.equal(f.notifications, before);
      now += 86400000; await f.select(f.leaf('', 'markdown')); assert.equal(f.h.entries[0].openedAt, now);
    } finally { f.close(); }
  });
  await test('Clearing history removes saved revisits and does not recreate the active page', async () => {
    const f = fixture(); try {
      f.data = [{ url, accessTs: yesterday() }]; await f.flush(); await f.select(f.leaf(url));
      f.data = []; await f.history(); assert.deepEqual(f.h.entries, []); assert.deepEqual(f.stored, []);
      await f.select(f.leaf('', 'markdown')); await f.reload(); assert.deepEqual(f.h.entries, []);
    } finally { f.close(); }
  });
  await test('Deleting the revisited record does not transfer its timestamp to an older duplicate', async () => {
    const f = fixture(); try {
      const older = yesterday() - 86400000;
      f.data = [{ url, accessTs: yesterday() }, { url, accessTs: older }]; await f.flush(); await f.select(f.leaf(url));
      f.data.shift(); await f.history(); assert.equal(f.h.entries[0].openedAt, older); assert.deepEqual(f.stored, []);
    } finally { f.close(); }
  });
  await test('Old pages become recent when viewed; the local record expires after seven calendar days', async () => {
    const f = fixture(); try {
      f.data = [{ url, accessTs: now - 30 * 86400000 }]; await f.flush(); assert.equal(f.h.entries.length, 0);
      await f.select(f.leaf(url)); assert.equal(f.h.entries[0].openedAt, now);
      now += 7 * 86400000; await f.reload(); assert.deepEqual(f.h.entries, []); assert.deepEqual(f.stored, []);
    } finally { f.close(); }
  });
  await test('Navigation updates only the active page and keeps native title updates', async () => {
    const f = fixture(); try {
      let current = url; const page = f.leaf(url); page.getViewState = () => ({ type: 'webviewer', state: { url: current } });
      f.data = [{ url, accessTs: yesterday() }]; await f.flush(); await f.select(page);
      current = 'https://example.com/next'; f.data.unshift({ url: current, accessTs: yesterday(), title: 'Next page' });
      now += 1000; await f.history(); assert.equal(f.h.entries.find(e=>e.url===current).openedAt, now);
      assert.equal(f.h.entries.find(e=>e.url===current).title, 'Next page');
      f.enabled = false; await f.flush(); assert.equal(f.h.entries.length, 0);
    } finally { f.close(); }
  });
  await test('A URL assigned after activation is captured without a new history event', async () => {
    const f = fixture(); try {
      f.data = [{ url, accessTs: yesterday() }]; await f.flush();
      const page = f.leaf(''); await f.select(page);
      page.getViewState = () => ({ type: 'webviewer', state: { url } });
      await new Promise(resolve => setTimeout(resolve, 0)); await f.flush();
      assert.equal(f.h.entries[0].openedAt, now);
    } finally { f.close(); }
  });
  await test('Native page-load events use the live URL before Obsidian commits its view state', async () => {
    const f = fixture(); try {
      f.data = [{ url, accessTs: yesterday() }]; await f.flush();
      let ready = false;
      const webview = { getURL() { if (!ready) throw new Error('Not ready'); return url; } };
      const page = f.leaf(''); page.view.containerEl.querySelector = () => webview;
      await f.select(page); ready = true;
      f.doc.emit('dom-ready', { target: webview });
      await new Promise(resolve => setTimeout(resolve, 0)); await f.flush();
      assert.equal(f.h.entries[0].openedAt, now);
      const viewedAt = now; now += 1000;
      f.doc.emit('did-stop-loading', { target: {} });
      await new Promise(resolve => setTimeout(resolve, 0)); await f.flush();
      assert.equal(f.h.entries[0].openedAt, viewedAt);
    } finally { f.close(); }
  });
  await test('Malformed and future visits are ignored, and unloading removes event listeners', async () => {
    const f = fixture([null, {url, historyAt:yesterday(),viewedAt:now+86400000}, {url:'javascript:bad()',historyAt:yesterday(),viewedAt:now}]);
    f.data=[{url, accessTs:yesterday()}, {url:'https://future.example.com',accessTs:now+86400000}]; await f.flush();
    assert.equal(f.h.entries.length, 1); assert.equal(f.h.entries[0].openedAt, yesterday());
    f.close(); assert.equal([...f.workspace.handlers.values()].reduce((n,s)=>n+s.size,0), 0);
    assert.equal([...f.win.handlers.values()].reduce((n,s)=>n+s.size,0), 0);
  });
  console.log(`\n${passed} web revisit tests passed.`);
} finally { globalThis.Date = RealDate; delete globalThis.window; await rm(dir, { recursive: true, force: true }); }
