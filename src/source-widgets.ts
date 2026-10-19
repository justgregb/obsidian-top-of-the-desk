import { fileSourceType, SOURCE_TYPES } from './source-types';
import { CollectionSearch } from './collection-search';
import { COPY } from './copy';
import { Component, MarkdownRenderer, TFile, TFolder, setIcon, setTooltip } from 'obsidian';
import type DeskPlugin from './main';
import { WidgetSettings } from './model';
import { WidgetEmptyState } from './empty-state';
import { setCollectionIcon } from './collection-icons';
import { compareNames, navigateList, reconcileChildren } from './ui';
import { CollectionPreviewDetails } from './collection-preview-details';
import { trackBaseListMarkers } from './base-list-markers';

/** Only Bases embed their native view; other source cards use SourceCardWidget. */
export class BaseWidget extends Component {
  private key = '';
  private renderer: Component | null = null;
  private stopped = false;

  constructor(private plugin: DeskPlugin, private id: string, private body: HTMLElement,
    private bindLinks: (host: HTMLElement, sourcePath: string) => () => void) { super(); }

  render(settings: WidgetSettings): void {
    if (settings.type !== 'base') return;
    this.body.toggleClass('tod-base-controls-hidden', settings.showBaseControls === false);
    const candidate = this.plugin.app.vault.getFileByPath(settings.path);
    const file = candidate?.extension === 'base' ? candidate : null;
    const key = JSON.stringify([settings.type, settings.enabled, settings.path, settings.view, !!file]);
    if (key === this.key) return;
    this.key = key;
    if (this.renderer) { this.removeChild(this.renderer); this.renderer = null; }
    this.body.empty();
    if (!settings.enabled) return;
    if (!file) {
      new WidgetEmptyState(this.body, settings.path ? 'This file is no longer available.' : 'Choose a file to preview here.', {
        label: 'Choose Base', run: () => this.plugin.configureWidget(this.id),
      });
      return;
    }
    const host = this.body.createDiv('tod-base-host markdown-rendered');
    const component = this.renderer = this.addChild(new Component());
    trackBaseListMarkers(host, component);
    component.register(this.bindLinks(host, settings.path));
    const link = this.plugin.app.fileManager.generateMarkdownLink(file, '', settings.view ? '#' + settings.view : '');
    void MarkdownRenderer.render(this.plugin.app, '!' + link, host, '', component).catch(error => {
      console.error('Top of the Desk: source preview failed', error);
      if (this.stopped || this.renderer !== component) return;
      this.removeChild(component); this.renderer = null; this.body.empty();
      new WidgetEmptyState(this.body, 'Couldn’t display this preview. You can still open the original file.', {
        label: COPY.tryAgain, run: () => {
          const current = this.plugin.settings.widgets[this.id];
          if (!this.stopped && current?.enabled) { this.key = ''; this.render(current); }
        },
      });
    }).finally(() => {
      if (this.stopped || this.renderer !== component) component.unload();
    });
  }
  onunload(): void { this.stopped = true; this.key = ''; this.body.empty(); }
}

/** A folder is a live window onto vault files; browsing never moves or copies them. */
export class FolderWidget extends Component {
  private search: CollectionSearch;
  private limit = 200;
  private source = '';
  private current = '';
  private signature = '';
  private navigationKey = '';
  private listingKey = '';
  private listing: TFolder['children'] = [];
  private sortedNotes?: { source: string; revision: number; files: TFile[] };
  private navigation: HTMLElement;
  private list: HTMLElement;
  private settings: WidgetSettings | null = null;
  private details: CollectionPreviewDetails | null = null;

  constructor(private plugin: DeskPlugin, private id: string, private body: HTMLElement,
    private bindNote: (row: HTMLElement, link: HTMLElement, path: string) => void,
    private bindFolder?: (row: HTMLElement, link: HTMLElement, path: string) => void,
    private chooseSource: (() => void) | null = () => plugin.configureWidget(id),
    private onFileOpen?: () => void,
    private layoutChanged?: () => void, previewDetails = false) {
    super();
    this.search = this.addChild(new CollectionSearch(body, 'Find notes in this folder…', () => {
      this.signature = ''; this.limit = 200; this.list.scrollTop = 0; if (this.settings) this.render(this.settings); this.remember(); this.layoutChanged?.();
    }));
    this.navigation = body.createEl('nav', { cls: 'tod-folder-navigation', attr: { 'aria-label': 'Folder navigation' } });
    this.list = body.createDiv({ cls: 'tod-recents tod-folder-list', attr: { role: 'list' } });
    if (previewDetails) this.details = this.addChild(new CollectionPreviewDetails(plugin, this.list, () => this.layoutChanged?.()));
    this.registerDomEvent(this.list, 'scroll', () => this.remember(), { passive: true });
    this.registerDomEvent(this.list, 'keydown', event => navigateList(event, this.list, '.tod-folder-link'));
  }

  render(settings: WidgetSettings): void {
    this.settings = settings;
    if (!settings.enabled) return;
    let restoreScroll: number | undefined;
    if (this.source !== settings.path) {
      this.source = settings.path; this.current = settings.path; this.signature = ''; this.limit = 200;
      const saved = this.plugin.collectionBrowseState.get(settings.itemId || this.id);
      if (saved?.source === settings.path && (saved.current === settings.path || settings.path === '/' || saved.current.startsWith(settings.path + '/'))) {
        this.current = saved.current; this.search.set(saved.query); restoreScroll = saved.scroll; this.limit = saved.limit || 200;
      } else this.search.set('');
    }
    const vault = this.plugin.app.vault;
    const find = (path: string) => path === '/' ? vault.getRoot() : vault.getAbstractFileByPath(path);
    const root = find(this.source);
    let folder = find(this.current);
    if (!(folder instanceof TFolder)) { this.current = this.source; folder = root; }
    const allNotes = root instanceof TFolder ? this.plugin.folderNotes(root) : [];
    this.search.show(allNotes.length);
    const searching = !!this.search.value.trim();
    const revision = this.plugin.sourceCatalog.revision;
    const listingKey = JSON.stringify([this.source, this.current, this.search.value, revision, root instanceof TFolder, folder instanceof TFolder]);
    if (listingKey !== this.listingKey) {
      this.listingKey = listingKey;
      if (searching) {
        if (this.sortedNotes?.source !== this.source || this.sortedNotes.revision !== revision) {
          this.sortedNotes = { source: this.source, revision, files: [...allNotes].sort((a, b) => compareNames(a.name, b.name)) };
        }
        this.listing = this.sortedNotes.files.filter(file => this.search.matches(file.path));
      } else this.listing = folder instanceof TFolder ? [...folder.children].sort((a, b) => Number(b instanceof TFolder) - Number(a instanceof TFolder) || compareNames(a.name, b.name)) : [];
    }
    const children = this.listing;
    const signature = JSON.stringify([listingKey, this.limit]);
    // Detail events update their own rows. Reconcile membership only when the
    // listing changes, not for unrelated settings or background refreshes.
    if (signature === this.signature) return;
    this.signature = signature;
    const active = this.list.ownerDocument.activeElement as HTMLElement | null;
    const focusedPath = active && this.list.contains(active) ? active.closest<HTMLElement>('[data-path]')?.dataset.path : undefined;
    const focusedGrip = !!active?.matches('.tod-source-grip');
    const oldRow = active?.closest('.tod-folder-row');
    const oldIndex = oldRow ? Array.from(this.list.children).indexOf(oldRow) : -1;
    const scroll = restoreScroll ?? this.list.scrollTop;
    const existing = new Map(Array.from(this.list.querySelectorAll<HTMLElement>(':scope > .tod-folder-row')).map(row => [row.dataset.path!, row] as const));
    const nested = this.current !== this.source;
    this.navigation.hidden = !nested || searching;
    const navigationKey = JSON.stringify([this.source, this.current, folder instanceof TFolder]);
    if (navigationKey !== this.navigationKey) {
      this.navigationKey = navigationKey; this.navigation.empty();
      if (nested && folder instanceof TFolder) {
        const ancestors: TFolder[] = [];
        let ancestor: TFolder | null = folder;
        while (ancestor) {
          ancestors.unshift(ancestor);
          if (ancestor.path === this.source) break;
          ancestor = ancestor.parent;
        }
        for (const [index, entry] of ancestors.entries()) {
          if (index) setIcon(this.navigation.createSpan({ cls: 'tod-folder-separator', attr: { 'aria-hidden': 'true' } }), 'chevron-right');
          const current = entry.path === this.current;
          const crumb = this.navigation.createEl('button', { cls: 'tod-folder-crumb', text: entry.isRoot() ? 'Vault' : entry.name });
          if (current) crumb.setAttribute('aria-current', 'location');
          setTooltip(crumb, entry.path === '/' ? 'Vault root' : entry.path);
          crumb.onclick = event => { if (!current) this.browse(entry.path, event.detail === 0); };
        }
        // Keep the current folder in view in a narrow widget.
        this.navigation.scrollLeft = this.navigation.scrollWidth;
      }
    }
    this.list.toggleClass('is-empty', !children.length);
    const restoreFocus = () => {
      if (!focusedPath) return;
      const rows = Array.from(this.list.querySelectorAll<HTMLElement>('.tod-folder-row'));
      const row = rows.find(row => row.dataset.path === focusedPath) || rows[Math.max(0, Math.min(oldIndex, rows.length - 1))];
      const control = row?.querySelector<HTMLButtonElement>(focusedGrip ? '.tod-source-grip' : '.tod-folder-link') || row?.querySelector<HTMLButtonElement>('button');
      (control || this.body.closest<HTMLElement>('.tod-widget, .tod-folder-popover'))?.focus({ preventScroll: true });
    };
    if (!(root instanceof TFolder)) {
      this.list.empty();
      this.details?.sync();
      new WidgetEmptyState(this.list, COPY.folderUnavailable, this.chooseSource ? {
        label: COPY.chooseFolder, run: this.chooseSource,
      } : undefined);
      restoreFocus();
      return;
    }
    if (!children.length) { this.list.empty(); this.details?.sync(); new WidgetEmptyState(this.list, searching ? COPY.noMatchingNotes : COPY.emptyFolder); restoreFocus(); return; }
    const rows: HTMLElement[] = [];
    const sorted = children;
    for (const item of sorted.slice(0, this.limit)) {
      const isFolder = item instanceof TFolder;
      const current = existing.get(item.path);
      if (current?.dataset.kind === (isFolder ? 'folder' : 'file') && current.dataset.searching === String(searching)) { rows.push(current); continue; }
      const row = this.list.createDiv({ cls: 'tod-folder-row', attr: { role: 'listitem', 'data-path': item.path, 'data-kind': isFolder ? 'folder' : 'file' } });
      row.dataset.searching = String(searching);
      rows.push(row);
      const label = item instanceof TFile && item.extension === 'md' ? item.basename : item.name;
      const button = row.createEl('button', { cls: 'tod-folder-link', attr: { 'data-path': item.path, 'aria-label': `Open ${isFolder ? 'folder ' : ''}${label}` } });
      setTooltip(button, item.path);
      const icon = button.createSpan({ cls: 'tod-recent-file-icon', attr: { 'aria-hidden': 'true' } });
      if (isFolder) setCollectionIcon(icon, 'folder', false);
      else { const type = item instanceof TFile ? fileSourceType(item.extension) : null; setIcon(icon, type ? SOURCE_TYPES[type].icon : 'file'); }
      const identity = button.createSpan('tod-list-identity');
      identity.createSpan({ cls: 'tod-recent-title', text: label });
      if (searching) identity.createSpan({ cls: 'tod-source-path', text: item.parent?.path === '/' ? 'Vault' : item.parent?.path || 'Vault' });
      button.onclick = event => {
        if (isFolder) this.browse(item.path, event.detail === 0);
        else { this.onFileOpen?.(); void this.plugin.openPath(item.path, event); }
      };
      button.addEventListener('auxclick', event => {
        if (event.button !== 1 || isFolder) return;
        const file = vault.getFileByPath(item.path);
        if (!file) return;
        event.preventDefault(); this.onFileOpen?.(); void this.plugin.openPath(item.path, event);
      });
      if (item instanceof TFile && fileSourceType(item.extension)) this.bindNote(row, button, item.path);
      else if (isFolder && this.bindFolder) this.bindFolder(row, button, item.path);
      else if (isFolder) setIcon(button.createSpan({ cls: 'tod-folder-enter', attr: { 'aria-hidden': 'true' } }), 'chevron-right');
    }
    if (sorted.length > this.limit) {
      const more = this.list.querySelector<HTMLElement>(':scope > .tod-collection-more') || this.list.createDiv({ cls: 'tod-collection-more', attr: { role: 'listitem' } });
      let button = more.querySelector<HTMLButtonElement>('button');
      if (!button) button = more.createEl('button', { attr: { type: 'button' } });
      button.setText(`Show ${Math.min(200, sorted.length - this.limit)} more`);
      button.onclick = event => {
        const previous = this.limit, scroll = this.list.scrollTop;
        this.limit += 200; if (this.settings) this.render(this.settings); this.list.scrollTop = scroll;
        if (event.detail === 0) this.list.querySelectorAll<HTMLElement>('.tod-folder-row')[previous]?.querySelector<HTMLButtonElement>('button')?.focus();
        this.remember();
      };
      rows.push(more);
    }
    reconcileChildren(this.list, rows);
    this.details?.sync();
    restoreFocus();
    this.list.scrollTop = scroll;
  }

  private remember(): void {
    if (this.source) this.plugin.collectionBrowseState.set(this.settings?.itemId || this.id, { source: this.source, current: this.current, query: this.search.value, scroll: this.list.scrollTop, limit: this.limit });
  }

  private browse(path: string, focus = false): void {
    const settings = this.settings;
    if (!settings) return;
    this.plugin.recordFolderOpen(path);
    this.current = path; this.limit = 200; this.list.scrollTop = 0;
    this.render(settings);
    if (focus) (this.list.querySelector<HTMLButtonElement>('button') || this.navigation.querySelector<HTMLButtonElement>('[aria-current]') || this.body.closest<HTMLElement>('.tod-widget, .tod-folder-popover'))?.focus({ preventScroll: true });
  }
  onunload(): void { this.remember(); this.settings = null; this.listing = []; this.sortedNotes = undefined; this.navigation.remove(); this.list.remove(); }
}
