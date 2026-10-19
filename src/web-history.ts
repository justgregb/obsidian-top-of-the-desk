import { isRecord, isUnknownArray, singleLine } from './validation';
import { sourceWebUrl as recentWebUrl } from './source-types';
import { recentWindow } from './recent-history';
import { Component, Events, Keymap, Notice, type App } from 'obsidian';

export interface OpenedWebPage { kind: 'web'; url: string; title: string; openedAt: number; }
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

/** Read the core plugin's history, without keeping a second persistent browsing log. */
export class WebHistory extends Component {
  entries: OpenedWebPage[] = [];
  private stopped = false;
  private timer = 0;
  private revision = 0;
  private loading = false;
  private pending = false;
  private retries = 0;
  private signature = '[]';

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
    this.registerEvent((this.app.workspace as Events).on('webviewer:update-history', () => this.requestRefresh()));
    const core = this.core;
    if (typeof core?.on === 'function') this.registerEvent(core.on('change', () => {
      this.requestRefresh();
    }));
    this.app.workspace.onLayoutReady(() => { if (!this.stopped) this.requestRefresh(0); });
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
    if (typeof store?.getHistoryItems !== 'function') { this.replace([]); return; }
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
      const pages = new Map<string, OpenedWebPage>();
      const group = recentWindow();
      if (isUnknownArray(history)) for (const value of history) {
        if (!isRecord(value)) continue;
        const openedAt = value.accessTs;
        // Filter before the limit so invalid/future entries cannot crowd out recent pages.
        // Old history also needs no URL parsing or title normalization.
        if (typeof openedAt !== 'number' || !group(openedAt)) continue;
        const url = recentWebUrl(value.url);
        if (!url) continue;
        const previous = pages.get(url);
        if (previous && previous.openedAt >= openedAt) continue;
        const title = typeof value.title === 'string' ? singleLine(value.title, true).slice(0, 500) : '';
        pages.set(url, { kind: 'web', url, title: recentWebUrl(title) === url ? '' : title, openedAt });
      }
      this.replace([...pages.values()].sort((a, b) => b.openedAt - a.openedAt).slice(0, 100));
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
    this.timer = 0; this.pending = false; this.retries = 0; this.entries = []; this.signature = '[]';
  }
}
