import { Component, type TFile } from 'obsidian';
import type DeskPlugin from './main';
import { formatCount } from './copy';
import { updateText, updateTooltip } from './ui';

interface NoteDetails {
  file: TFile;
  stamp: string;
  link: HTMLElement;
  context: HTMLElement;
  excerpt: HTMLElement;
  words: HTMLElement;
  count?: number;
  unavailable?: string;
  ready: boolean;
}

/** Enrich only visible browser rows, sharing the cover and word-count caches. */
export class CollectionPreviewDetails extends Component {
  private rows = new Map<HTMLElement, NoteDetails>();
  private fileRows = new Map<TFile, Set<HTMLElement>>();
  private visible = new Set<HTMLElement>();
  private queued = new Set<HTMLElement>();
  private loading = new Set<NoteDetails>();
  private observer: IntersectionObserver;
  private stopped = false;
  private frame = 0;

  constructor(private plugin: DeskPlugin, private list: HTMLElement, layoutChanged: () => void) {
    super();
    this.observer = new list.ownerDocument.defaultView!.IntersectionObserver(entries => {
      if (this.stopped) return;
      for (const entry of entries) {
        const row = entry.target as HTMLElement;
        if (!this.rows.has(row)) continue;
        if (entry.isIntersecting) { this.visible.add(row); this.queued.add(row); }
        else { this.visible.delete(row); this.queued.delete(row); }
      }
      this.drain();
    }, { root: list, rootMargin: '80px 0px' });
    const changed = (file: TFile) => {
      if (this.stopped) return;
      // Vault events also cover unrelated notes. Look up only this file's rows;
      // membership reconciliation belongs to sync().
      const rows = this.fileRows.get(file);
      if (!rows) return;
      const stamp = plugin.previewStamp(file);
      for (const row of rows) {
        const details = this.rows.get(row);
        if (!details || stamp === details.stamp) continue;
        const next = { ...details, stamp, ready: false };
        this.rows.set(row, next); this.describe(next);
        if (this.visible.has(row)) this.queued.add(row);
      }
      this.drain();
    };
    this.registerEvent(plugin.app.vault.on('modify', changed));
    this.registerEvent(plugin.app.metadataCache.on('changed', changed));
    const win = list.ownerDocument.defaultView!;
    const resize = new win.ResizeObserver(() => {
      if (this.stopped || this.frame) return;
      this.frame = win.requestAnimationFrame(() => { this.frame = 0; if (!this.stopped) layoutChanged(); });
    });
    resize.observe(list); this.register(() => resize.disconnect());
  }

  sync(): void {
    if (this.stopped) return;
    const retained = new Set<HTMLElement>();
    const fileRows = new Map<TFile, Set<HTMLElement>>();
    for (const row of this.list.querySelectorAll<HTMLElement>(':scope > .tod-folder-row')) {
      const path = row.dataset.notePath || row.dataset.path;
      const file = path && this.plugin.app.vault.getFileByPath(path);
      if (!file || file.extension !== 'md') continue;
      retained.add(row);
      let matches = fileRows.get(file);
      if (!matches) { matches = new Set(); fileRows.set(file, matches); }
      matches.add(row);
      const stamp = this.plugin.previewStamp(file);
      let details = this.rows.get(row);
      if (details?.file === file && details.stamp === stamp) continue;
      if (!details) {
        const link = row.querySelector<HTMLElement>('.tod-folder-link');
        const title = link?.querySelector<HTMLElement>('.tod-recent-title');
        if (!link || !title) continue;
        let identity = link.querySelector<HTMLElement>('.tod-list-identity');
        if (!identity) {
          identity = link.ownerDocument.createElement('span'); identity.className = 'tod-list-identity';
          title.replaceWith(identity); identity.append(title);
        }
        const heading = identity.createSpan('tod-browser-heading');
        heading.append(title);
        const summary = identity.createSpan('tod-browser-summary');
        const context = summary.createSpan('tod-browser-context');
        // Duplicate titles and folder-search results keep their source context on
        // the same secondary line, without adding a third row.
        const source = identity.querySelector<HTMLElement>(':scope > .tod-source-path');
        if (source) context.append(source);
        const excerpt = context.createSpan('tod-browser-excerpt');
        const words = summary.createSpan('tod-browser-words');
        words.hidden = true;
        // Reserve the secondary line before async details arrive, so rows stay in place.
        excerpt.hidden = true; context.hidden = !source;
        details = { file, stamp, link, context, excerpt, words, ready: false };
        row.addClass('tod-browser-note');
        this.observer.observe(row);
      } else details = { ...details, file, stamp, ready: false };
      this.rows.set(row, details);
      this.describe(details);
      if (this.visible.has(row)) this.queued.add(row);
    }
    for (const row of this.rows.keys()) if (!retained.has(row)) {
      this.observer.unobserve(row); this.rows.delete(row); this.visible.delete(row); this.queued.delete(row);
    }
    this.fileRows = fileRows;
    this.drain();
  }

  private drain(): void {
    if (this.stopped) return;
    while (this.loading.size < 4 && this.queued.size) {
      const row = this.queued.values().next().value!;
      this.queued.delete(row);
      const details = this.rows.get(row);
      if (!details || details.ready || this.loading.has(details) || !row.isConnected) continue;
      this.loading.add(details);
      const current = () => !this.stopped && row.isConnected && this.rows.get(row) === details;
      void Promise.allSettled([this.plugin.preview(details.file), this.plugin.noteWordCount(details.file)]).then(([preview, words]) => {
        if (!current()) return;
        const text = preview.status === 'fulfilled' ? preview.value.trim() : '';
        updateText(details.excerpt, text); details.excerpt.hidden = !text;
        details.context.hidden = !text && !details.context.querySelector('.tod-source-path');
        details.count = words.status === 'fulfilled' ? words.value : undefined;
        details.words.hidden = details.count === undefined;
        updateText(details.words, details.count === undefined ? '' : formatCount(details.count, 'word'));
        if (details.count !== undefined) updateTooltip(details.words, `${formatCount(details.count, 'word')}. Note properties aren’t counted.`);
        details.unavailable = [preview.status === 'rejected' ? 'Preview unavailable' : '', words.status === 'rejected' ? 'Word count unavailable' : ''].filter(Boolean).join('. ');
        this.describe(details);
        details.ready = true;
      }).finally(() => { this.loading.delete(details); this.drain(); });
    }
  }

  private describe(details: NoteDetails): void {
    const label = `Open ${details.link.querySelector('.tod-recent-title')?.textContent || details.file.basename}`;
    const description = [details.file.path, details.count === undefined ? '' : formatCount(details.count, 'word'),
      `Last edited ${new Date(details.file.stat.mtime).toLocaleString()}`, details.unavailable].filter(Boolean).join('\n');
    updateTooltip(details.link, description);
    details.link.setAttribute('aria-label', label);
    details.link.setAttribute('aria-description', description);
  }

  onunload(): void {
    this.stopped = true; this.observer.disconnect(); this.rows.clear(); this.fileRows.clear(); this.visible.clear(); this.queued.clear(); this.loading.clear();
    if (this.frame) this.list.ownerDocument.defaultView!.cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}
