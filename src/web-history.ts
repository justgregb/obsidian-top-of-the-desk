import { isRecord, isUnknownArray, singleLine } from './validation';
import { sourceWebUrl as recentWebUrl } from './source-types';
import { recentWindow } from './recent-history';
import { Component, Events, Keymap, Notice, View, type App, type WorkspaceLeaf } from 'obsidian';

export interface OpenedWebPage { kind: 'web'; url: string; title: string; openedAt: number; }
interface ViewedPage { url: string; historyAt: number; viewedAt: number; }
interface WebViewElement extends HTMLElement { getURL?(): unknown; }
const VISITS_STORAGE = 'top-of-the-desk:web-visits';
interface HistoryStore {
  db?: unknown;
  getHistoryItems?(): Promise<unknown>;
}
interface WebViewer { db?: HistoryStore; }
interface CorePlugins extends Events { getEnabledPluginById(id: string): WebViewer | null; }

export { sourceWebUrl as recentWebUrl } from './source-types';

export function webPageLabel(entry: OpenedWebPage): { title: string; domain: string } {
  const url = new URL(entry.url), domain = url.host.replace(/^www\./i, '');
  return { title: entry.title || `${domain}${url.pathname === '/' ? '' : url.pathname}${url.search}${url.hash}`, domain };
}

/** Core history supplies pages; a bounded local record remembers revisits to open tabs. */
export class WebHistory extends Component {
  entries: OpenedWebPage[] = [];
  private stopped = false;
  private timer = 0;
  private activeTimer = 0;
  private forceActive = false;
  private revision = 0;
  private loading = false;
  private pending = false;
  private retries = 0;
  private signature = '[]';
  private visits = new Map<string, ViewedPage>();
  private visitsSignature = '[]';
  private nativePages = new Map<string, OpenedWebPage>();
  private pendingVisits = new Map<string, number>();
  private active: { leaf: WorkspaceLeaf; url: string; doc: Document } | null = null;
  private windows = new Map<Window, Component>();

  constructor(private app: App, private changed: () => void) { super(); }

  // This small adapter contains the internal API used by Obsidian 1.14.4's history view.
  private get core(): CorePlugins | undefined {
    return (this.app as unknown as { internalPlugins?: CorePlugins }).internalPlugins;
  }
  private viewer(): WebViewer | null {
    const core = this.core;
    return typeof core?.getEnabledPluginById === 'function' ? core.getEnabledPluginById('webviewer') : null;
  }

  onload(): void {
    this.stopped = false;
    const stored: unknown = this.app.loadLocalStorage(VISITS_STORAGE), group = recentWindow();
    if (isUnknownArray(stored)) for (const value of stored.slice(0, 100)) {
      if (!isRecord(value) || typeof value.viewedAt !== 'number' || !group(value.viewedAt) ||
        typeof value.historyAt !== 'number' || !Number.isSafeInteger(value.historyAt) || value.historyAt <= 0 || value.historyAt > value.viewedAt) continue;
      const url = recentWebUrl(value.url);
      if (url) this.visits.set(url, { url, historyAt: value.historyAt, viewedAt: value.viewedAt });
    }
    this.visitsSignature = JSON.stringify(stored ?? []);
    this.registerEvent((this.app.workspace as Events).on('webviewer:update-history', () => {
      // Navigation can change the URL without changing the active leaf. A history
      // clear or a background page load must not count as viewing the active page.
      this.trackActive(); this.requestRefresh();
    }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
      this.trackActive(); this.queueActive();
    }));
    this.registerEvent(this.app.workspace.on('window-open', (_workspaceWindow, win) => this.watchWindow(win)));
    this.registerEvent(this.app.workspace.on('window-close', (_workspaceWindow, win) => {
      const events = this.windows.get(win);
      if (events) this.removeChild(events);
      this.windows.delete(win);
      if (this.active?.doc === win.document) this.finishActive();
    }));
    const core = this.core;
    if (typeof core?.on === 'function') this.registerEvent(core.on('change', () => {
      this.requestRefresh();
    }));
    this.app.workspace.onLayoutReady(() => {
      if (this.stopped) return;
      this.watchWindow(window);
      this.app.workspace.iterateAllLeaves(leaf => {
        const win = leaf.view.containerEl.ownerDocument.defaultView;
        if (win) this.watchWindow(win);
      });
      this.trackActive(); this.requestRefresh(0);
    });
  }

  private watchWindow(win: Window): void {
    if (this.windows.has(win)) return;
    const events = this.addChild(new Component());
    this.windows.set(win, events);
    events.registerDomEvent(win, 'focus', () => this.trackActive(true));
    events.registerDomEvent(win, 'blur', () => { if (this.active?.doc === win.document) this.finishActive(); });
    events.registerDomEvent(win.document, 'visibilitychange', () => {
      if (win.document.visibilityState === 'hidden') {
        if (this.active?.doc === win.document) this.finishActive();
      } else this.trackActive(true);
    });
    // Web viewer commits its saved URL after a debounce, and may emit no history
    // event for a repeated URL. Observe the native page-load events as well.
    const navigated = (event: Event) => {
      const view = this.app.workspace.getActiveViewOfType(View);
      if (event.target && view?.getViewType() === 'webviewer' && event.target === view.containerEl.querySelector('webview')) this.queueActive(true);
    };
    for (const name of ['dom-ready', 'did-navigate-in-page', 'did-stop-loading']) {
      win.document.addEventListener(name, navigated, true);
      events.register(() => win.document.removeEventListener(name, navigated, true));
    }
  }

  private queueActive(force = false): void {
    this.forceActive ||= force;
    if (this.activeTimer) return;
    this.activeTimer = window.setTimeout(() => {
      this.activeTimer = 0;
      const force = this.forceActive; this.forceActive = false; this.trackActive(force);
    }, 0);
  }

  private trackActive(force = false): void {
    if (this.stopped) return;
    const leaf = this.app.workspace.getActiveViewOfType(View)?.leaf, state = leaf?.getViewState();
    const doc = leaf?.view.containerEl.ownerDocument;
    let url = state?.type === 'webviewer' && isRecord(state.state) ? recentWebUrl(state.state.url) : null;
    if (state?.type === 'webviewer') {
      const webview = leaf?.view.containerEl.querySelector<WebViewElement>('webview');
      // Electron's live URL is available before Obsidian's debounced view state.
      // The getter can throw until the embedded page is ready.
      try { if (typeof webview?.getURL === 'function') url = recentWebUrl(webview.getURL()) || url; } catch { /* Use saved view state while loading. */ }
    }
    const next = leaf && url && doc?.visibilityState === 'visible' && doc.hasFocus() && this.viewer() ? { leaf, url, doc } : null;
    const same = next && this.active?.leaf === next.leaf && this.active.url === next.url;
    if (same && !force) return;
    // A page read across midnight belongs to today when the user leaves it.
    if (this.active && !same && this.active.doc.hasFocus()) this.rememberView(this.active.url);
    this.active = next;
    if (next) this.rememberView(next.url);
  }

  private finishActive(): void {
    const previous = this.active; this.active = null;
    if (previous) this.rememberView(previous.url);
  }

  private rememberView(url: string): void {
    if (this.stopped || !this.viewer()) return;
    const viewedAt = Date.now(), native = this.nativePages.get(url);
    // Save known pages immediately, including when the window is closing.
    if (native) { this.visits.set(url, { url, historyAt: native.openedAt, viewedAt }); this.saveVisits(); }
    else {
      this.pendingVisits.set(url, viewedAt);
      if (this.pendingVisits.size > 100) this.pendingVisits.delete(this.pendingVisits.keys().next().value!);
    }
    this.requestRefresh();
  }

  private saveVisits(): void {
    const group = recentWindow();
    this.visits = new Map([...this.visits.values()].filter(visit => group(visit.viewedAt))
      .sort((a, b) => b.viewedAt - a.viewedAt).slice(0, 100).map(visit => [visit.url, visit]));
    const signature = JSON.stringify([...this.visits.values()]);
    if (signature === this.visitsSignature) return;
    this.app.saveLocalStorage(VISITS_STORAGE, [...this.visits.values()]); this.visitsSignature = signature;
  }

  private requestRefresh(delay = 80, resetRetries = true): void {
    if (this.stopped) return;
    this.revision++;
    if (resetRetries) this.retries = 0;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = 0; void this.refresh(); }, delay);
  }

  private async refresh(): Promise<void> {
    if (this.stopped) return;
    if (this.loading) { this.pending = true; return; }
    const revision = this.revision, viewer = this.viewer(), store = viewer?.db;
    if (typeof store?.getHistoryItems !== 'function') {
      this.active = null; this.pendingVisits.clear(); this.nativePages.clear(); this.replace([]); return;
    }
    // The core plugin starts its database connection asynchronously during enable.
    if ('db' in store && !store.db) {
      this.replace([]);
      if (this.retries < 5) this.requestRefresh(100 * 2 ** this.retries++, false);
      return;
    }
    this.loading = true;
    try {
      const history = await store.getHistoryItems();
      if (this.stopped || revision !== this.revision || viewer !== this.viewer()) return;
      const pages = new Map<string, OpenedWebPage>(), now = Date.now();
      const group = recentWindow(new Date(now));
      if (isUnknownArray(history)) for (const value of history) {
        if (!isRecord(value)) continue;
        const openedAt = value.accessTs;
        // An old native visit can have been viewed again today. Validate its
        // timestamp here and apply the seven-day cutoff after merging revisits.
        if (typeof openedAt !== 'number' || !Number.isSafeInteger(openedAt) || openedAt <= 0 || openedAt > now) continue;
        const url = recentWebUrl(value.url);
        if (!url) continue;
        const previous = pages.get(url);
        if (previous && previous.openedAt >= openedAt) continue;
        const title = typeof value.title === 'string' ? singleLine(value.title, true).slice(0, 500) : '';
        pages.set(url, { kind: 'web', url, title: recentWebUrl(title) === url ? '' : title, openedAt });
      }
      this.nativePages = pages;
      const visits = new Map<string, ViewedPage>(), entries: OpenedWebPage[] = [];
      for (const page of pages.values()) {
        const visit = this.visits.get(page.url);
        // Tie a revisit to its original history entry: deleting that entry must
        // not transfer its timestamp to an older visit of the same URL.
        const savedAt = visit?.historyAt === page.openedAt ? visit.viewedAt : 0;
        const openedAt = Math.max(page.openedAt, savedAt, this.pendingVisits.get(page.url) || 0);
        if (!group(openedAt)) continue;
        entries.push({ ...page, openedAt });
        if (openedAt > page.openedAt) visits.set(page.url, { url: page.url, historyAt: page.openedAt, viewedAt: openedAt });
      }
      this.visits = visits; this.pendingVisits.clear(); this.saveVisits();
      this.replace(entries.sort((a, b) => b.openedAt - a.openedAt).slice(0, 100));
    } catch {
      if (!this.stopped && revision === this.revision) this.replace([]);
    } finally {
      this.loading = false;
      if (this.pending && !this.stopped) { this.pending = false; this.requestRefresh(0, false); }
    }
  }

  private replace(entries: OpenedWebPage[]): void {
    const signature = JSON.stringify(entries);
    if (signature === this.signature) return;
    this.entries = entries; this.signature = signature; this.changed();
  }

  async open(url: string, event?: MouseEvent | KeyboardEvent): Promise<void> {
    const destination = recentWebUrl(url);
    if (!destination) return;
    if (!this.viewer()) { new Notice('Turn on Web viewer in Obsidian’s core plugin settings to open this page.'); return; }
    const pane = event && 'button' in event && event.button === 1 ? 'tab' : event ? Keymap.isModEvent(event) : false;
    try {
      await this.app.workspace.getLeaf(pane).setViewState({ type: 'webviewer', active: true, state: { url: destination, navigate: true } });
    } catch { new Notice('Couldn’t open this page in Web viewer. Try again.'); }
  }

  onunload(): void {
    this.stopped = true; this.revision++;
    if (this.timer) window.clearTimeout(this.timer);
    if (this.activeTimer) window.clearTimeout(this.activeTimer);
    this.activeTimer = 0;
    this.forceActive = false;
    this.timer = 0; this.pending = false; this.retries = 0; this.entries = []; this.signature = '[]';
    this.active = null; this.windows.clear(); this.nativePages.clear(); this.pendingVisits.clear();
  }
}
