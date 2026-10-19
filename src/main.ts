import { NoteReads } from './note-reads';
import { SourceCatalog } from './source-catalog';
import { fileSourceType, isCompactSourceType, isFileWidgetType, isSourceWidgetType, matchesSourceFile, SOURCE_TYPES, SourceType, sourceWebSite, sourceWebUrl } from './source-types';
import { SourceCardWidget } from './source-card-widget';
import { COPY, DRAFT_COPY, draftSaved, openSourceLabel } from './copy';
import { Events, ItemView, Keymap, Modal, Notice, Plugin, PluginSettingTab, SettingGroup, TFile, TFolder, WorkspaceLeaf, normalizePath, parseYaml, setIcon, setTooltip } from 'obsidian';
import { canHideWidgetHeading, canStackWidget, isFixedSizeWidget, isEnabledWidget, isRootWidget, isVisibleWidget, widgetStackFor, widgetStackOwners, widgetHeadingState, itemWidgetId, isCoverWidget, syncDeskWidgets, GridColumns, GridPosition, CollectionCountSettings, DeskItem, DeskSettings, WidgetKey, WidgetSettings, WidgetSize, WIDGET_NAMES, WIDGET_ICONS, widgetDefaults, widgetName, deskPaths, excerpt, itemPaths, normalizeDeskItems, normalizeSettings, removeDeskNote, renamePath, safePath, validRecovery } from './model';
import { ScratchConflict, ScratchStore } from './scratch';
import { DailyNoteStore } from './daily';
import { WidgetMarkdownEditor } from './editor';
import { WidgetSizePicker } from './size-picker';
import { HALF_HEIGHT, STANDARD_HEIGHT, normalizeWidgetRows } from './widget-sizing';
import { WidgetEmptyState } from './empty-state';
import { DeskItemsView } from './desk-items';
import { CollectionWordCounts } from './collection-word-counts';
import { BaseWidget, FolderWidget } from './source-widgets';
import { SourceWidgetModal } from './widget-dialogs';
import { WidgetStackModal, WidgetStackSwitcher } from './widget-stacks';
import { CollectionDetailsModal } from './collection-details';
import { ItemEditModal } from './edit-controls';
import { ControlTooltips } from './control-tooltips';
import { DESK_ACTION_ICONS, registerDeskIcons } from './collection-icons';
import { WritingActivity } from './writing-activity';
import { LastWorkedNotes } from './last-worked';
import { AddDeskModal, StackNotesModal } from './add-to-desk';
import { RecentHistory, recentWindow } from './recent-history';
import { WebHistory, webPageLabel } from './web-history';
import { ScratchSelectionModal } from './scratch-selection';
import { WritingHeatmap } from './writing-heatmap';
import { compareNames, navigateList, reconcileChildren, updateText, updateTooltip } from './ui';
import { notesInFolder } from './collection-stats';
import { UndoNotice, UndoOrigin, undoOrigin } from './undo-notice';
import { WidgetGrid, DeskSource, SourceMove, sourceMoveDraft, sourceMovesDraft, plannedSourceMoves, sourceWidgetId, rememberWidgetLayout, resolveWidgetLayout, resizeWidgetLayout, commitWidgetMove, plannedWidgetMove } from './widget-layout';

interface DeskUpdate { widgets: string[]; content?: boolean; layout?: boolean; pageHeading?: boolean; markers?: boolean; }
function mergeDeskUpdates(a?: DeskUpdate, b?: DeskUpdate): DeskUpdate | undefined {
  if (!a || !b) return undefined;
  return { widgets: [...new Set([...a.widgets, ...b.widgets])], content: a.content !== false || b.content !== false,
    layout: a.layout || b.layout, pageHeading: a.pageHeading || b.pageHeading, markers: a.markers || b.markers };
}

export const VIEW = 'top-of-the-desk-home';
const RECOVERY = 'top-of-the-desk:scratch-recovery';

export default class DeskPlugin extends Plugin {
  settings!: DeskSettings;
  recents!: RecentHistory;
  sourceCatalog!: SourceCatalog;
  webHistory!: WebHistory;
  readonly collectionBrowseState = new Map<string, { source: string; current: string; query: string; scroll: number; limit?: number }>();
  scratch!: ScratchStore;
  daily!: DailyNoteStore;
  sizePicker!: WidgetSizePicker;
  activity!: WritingActivity;
  lastWorked!: LastWorkedNotes;
  private saves: Promise<void> = Promise.resolve();
  private saveError: Error | null = null;
  private undo = new UndoNotice();
  private opening: Promise<void> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRefresh: DeskUpdate | undefined;
  private newTabTimer: ReturnType<typeof setTimeout> | null = null;
  private unloaded = false;
  private needsMigrationSave = false;
  private widgetDialogs = new Set<Modal>();
  private sourceChoicesDirty = false;
  private addChoicesDirty = false;
  private addChoicesSignature = '';
  private editDepth = 0;
  private editPending = false;
  private editUpdate?: DeskUpdate;
  private previewCache = new Map<string, { stamp: string; text: Promise<string> }>();
  private noteReads = new NoteReads(file => this.app.vault.cachedRead(file));
  private wordCounts: CollectionWordCounts = new CollectionWordCounts(file => this.noteReads.read(file, this.wordCounts.stamp(file)));
  private folderNotesCache = new WeakMap<TFolder, TFile[]>();

  async onload(): Promise<void> {
    try {
      const saved = await this.loadData();
      this.settings = normalizeSettings(saved);
      const collapsedStacks = (raw: unknown, normalized: DeskItem[]): boolean => {
        const stacks = new Set(normalized.filter(item => item.type === 'stack').map(item => item.id));
        return Array.isArray(raw) && raw.some(item => item?.type === 'stack' && !stacks.has(item.id));
      };
      this.needsMigrationSave = saved?.version !== 10 || collapsedStacks(saved?.items, this.settings.items) ||
        collapsedStacks(saved?.putAwayItems, this.settings.putAwayItems) ||
        Object.entries(this.settings.widgets).some(([id, widget]) => isCompactSourceType(widget.type) && saved?.widgets?.[id]?.showHeading === false);
    }
    catch { new Notice('Couldn’t load Top of the Desk settings. Your saved settings haven’t been changed.'); throw new Error('Desk settings unreadable'); }
    this.addChoicesSignature = this.choiceSignature();
    registerDeskIcons();
    this.sizePicker = this.addChild(new WidgetSizePicker());
    this.activity = new WritingActivity(this.app);
    this.lastWorked = new LastWorkedNotes(this.app);
    this.registerEditorExtension(this.activity.editorExtension(path => this.recordWork(path)));
    if (isEnabledWidget(this.settings, 'activity')) this.activity.start();
    this.registerDomEvent(window, 'blur', () => this.activity.flushAll());
    this.sourceCatalog = new SourceCatalog(this.app.vault);
    this.recents = new RecentHistory(this.app);
    this.webHistory = this.addChild(new WebHistory(this.app, () => {
      this.addChoicesDirty = true; this.refreshSoon({ widgets: ['recents'] });
    }));
    this.setupScratch();
    this.daily = new DailyNoteStore(this.app, path => this.sourceCatalog.note(path));
    const core = (this.app as unknown as { internalPlugins?: Events }).internalPlugins;
    if (typeof core?.on === 'function') this.registerEvent(core.on('change', () => {
      if (isEnabledWidget(this.settings, 'daily')) void this.daily.sync();
      this.refreshSoon({ widgets: ['daily'] });
    }));
    this.registerInterval(window.setInterval(() => {
      if (isEnabledWidget(this.settings, 'daily')) void this.daily.sync();
      if (this.recents.dayChanged()) { this.addChoicesDirty = true; this.refreshSoon({ widgets: ['recents'] }); }
    }, 30000));
    this.registerDomEvent(window, 'focus', () => {
      if (isEnabledWidget(this.settings, 'daily')) void this.daily.sync();
      this.refreshSoon({ widgets: ['recents'] });
    });
    this.registerView(VIEW, leaf => new DeskView(leaf, this));
    this.addRibbonIcon('panels-top-left', 'Open desk', () => { void this.openDesk(); });
    this.addCommand({ id: 'open-desk', name: 'Open desk', callback: () => { void this.openDesk(); } });
    this.addCommand({ id: 'add-note', name: COPY.addToDesk, callback: () => this.pickDesk() });
    this.addCommand({ id: 'put-on-desk', name: 'Add current file to desk', checkCallback: checking => {
      const file = this.app.workspace.getActiveFile();
      const kind = file && fileSourceType(file.extension);
      if (!file || !kind) return false;
      if (!checking) this.addSourceToDesk({ kind, path: file.path });
      return true;
    } });
    this.addCommand({ id: 'new-stack', name: 'Create a stack on the desk', callback: () => this.pickStackNotes() });
    this.addCommand({ id: 'open-scratchpad', name: COPY.openScratchpad, callback: () => { void this.openScratchpad(); } });
    this.addCommand({ id: 'choose-base', name: 'Add Base to desk', callback: () => new SourceWidgetModal(this, 'base').open() });
    this.addCommand({ id: 'add-widget', name: 'Customize desk', callback: () => this.focusDeskControls() });
    this.addSettingTab(new DeskSettingTab(this));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (file instanceof TFile && file.extension === 'md') menu.addItem(item => item
        .setTitle(this.hasNote(file.path) ? COPY.removeFromDesk : COPY.addToDesk)
        .setIcon(this.hasNote(file.path) ? DESK_ACTION_ICONS.remove : 'plus').onClick(event => this.hasNote(file.path) ? this.unpin(file.path, undoOrigin(event)) : this.pin(file.path)));
      else {
        const kind = file instanceof TFolder ? 'folder' : file instanceof TFile ? fileSourceType(file.extension) : null;
        if (!kind) return;
        const source = { kind, path: file.path }, owner = sourceWidgetId(this.settings, source);
        const root = owner && (widgetStackFor(this.settings, owner) || owner);
        const onDesk = !!root && !!this.settings.widgets[root]?.enabled;
        menu.addItem(item => item.setTitle(onDesk ? COPY.showOnDesk : COPY.addToDesk).setIcon(onDesk ? DESK_ACTION_ICONS.showOnDesk : 'plus').onClick(() => { this.addSourceToDesk(source); }));
      }
    }));
    this.registerEvent(this.app.workspace.on('file-open', file => {
      if (file && fileSourceType(file.extension)) {
        this.recents.open(file.path); this.addChoicesDirty = true;
        this.refreshSoon({ widgets: ['recents'] });
      }
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.sourceCatalog.invalidate(); this.sourceChoicesDirty = true;
      this.clearUndo();
      this.lastWorked.rename(oldPath, file.path);
      this.folderNotesCache = new WeakMap();
      this.settings.items = normalizeDeskItems(this.settings.items.map(item => item.type !== 'stack'
        ? { ...item, path: renamePath(item.path, oldPath, file.path) }
        : { ...item, paths: item.paths.map(path => renamePath(path, oldPath, file.path)) }));
      for (const widget of Object.values(this.settings.widgets)) {
        if (isFileWidgetType(widget.type) || widget.type === 'folder') widget.path = renamePath(widget.path, oldPath, file.path);
      }
      const priorScratch = this.settings.scratchPath;
      const nextScratch = renamePath(priorScratch, oldPath, file.path);
      if (nextScratch !== priorScratch) {
        this.settings.scratchPath = nextScratch; this.scratch.repath();
        this.app.saveLocalStorage(RECOVERY + ':' + priorScratch, null);
      }
      this.recents.rename(oldPath, file.path);
      this.collectionBrowseState.clear();
      this.settings.putAwayItems = this.settings.putAwayItems.flatMap(item => normalizeDeskItems([item.type === 'stack'
        ? { ...item, paths: item.paths.map(path => renamePath(path, oldPath, file.path)) }
        : { ...item, path: renamePath(item.path, oldPath, file.path) }]));
      this.daily.rename(oldPath, file.path);
      this.previewCache.clear(); this.changed();
    }));
    this.registerEvent(this.app.vault.on('delete', file => {
      this.sourceCatalog.invalidate(); this.sourceChoicesDirty = true;
      this.lastWorked.remove(file.path);
      this.folderNotesCache = new WeakMap();
      this.previewCache.delete(file.path);
      if (file instanceof TFile) this.wordCounts.invalidate(file);
      void this.daily.changed(file.path);
      if (file.path === this.settings.scratchPath) void this.scratch.refresh();
      this.refreshSoon();
    }));
    this.registerEvent(this.app.vault.on('modify', file => {
      this.previewCache.delete(file.path); this.wordCounts.invalidate(file);
      void this.daily.changed(file.path);
      if (file.path === this.settings.scratchPath) void this.scratch.refresh();
      const widgets = this.fileConsumers(file, true);
      if (widgets.length) this.refreshSoon({ widgets });
    }));
    this.registerEvent(this.app.metadataCache.on('changed', file => {
      const cached = this.previewCache.get(file.path);
      if (cached && cached.stamp !== this.previewStamp(file)) this.previewCache.delete(file.path);
      // Summary metadata can arrive after the file event. A targeted render's
      // content stamp decides whether its own cover actually needs replacing.
      const widgets = this.fileConsumers(file, false);
      if (widgets.length) this.refreshSoon({ widgets });
    }));
    this.registerEvent(this.app.vault.on('create', file => {
      this.sourceCatalog.invalidate(); this.sourceChoicesDirty = true;
      this.folderNotesCache = new WeakMap();
      void this.daily.changed(file.path);
      if (file.path === this.settings.scratchPath) void this.scratch.refresh();
      this.refreshSoon();
    }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.scheduleNewTabHome()));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.scheduleNewTabHome()));
    this.app.workspace.onLayoutReady(() => {
      if (this.unloaded) return;
      if (isEnabledWidget(this.settings, 'daily')) void this.daily.sync();
      if (this.settings.openOnStartup) void this.openDesk();
      this.scheduleNewTabHome();
    });
    if (this.needsMigrationSave) this.changed();
  }

  onunload(): void {
    this.unloaded = true; this.clearUndo();
    for (const dialog of [...this.widgetDialogs]) dialog.close();
    this.widgetDialogs.clear();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.newTabTimer) clearTimeout(this.newTabTimer);
    this.scratch?.stop();
    this.daily?.stop();
    this.activity?.stop();
    this.noteReads.stop(); this.sourceCatalog?.invalidate();
    this.previewCache.clear(); this.wordCounts.clear(); this.folderNotesCache = new WeakMap(); this.collectionBrowseState.clear();
  }

  scheduleNewTabHome(): void {
    if (this.newTabTimer) clearTimeout(this.newTabTimer);
    this.newTabTimer = null;
    const workspace = this.app.workspace;
    if (this.unloaded || !workspace.layoutReady || !this.settings.openOnNewTab) return;
    const leaf = workspace.activeLeaf;
    if (!leaf || leaf.view.getViewType() !== 'empty') return;
    // File navigation can briefly create an empty leaf. Let it settle before
    // replacing only a blank tab that is still active in the main workspace.
    this.newTabTimer = setTimeout(() => {
      this.newTabTimer = null;
      if (this.unloaded || !this.settings.openOnNewTab || workspace.activeLeaf !== leaf || leaf.view.getViewType() !== 'empty') return;
      let inMainWorkspace = false;
      workspace.iterateRootLeaves(candidate => { if (candidate === leaf) inMainWorkspace = true; });
      if (!inMainWorkspace) return;
      void leaf.setViewState({ type: VIEW, active: true }).catch(error => {
        console.error('Top of the Desk: could not open in the new tab', error);
      });
    }, 150);
  }

  setupScratch(): void {
    this.scratch = new ScratchStore({
      path: () => this.settings.scratchPath,
      read: async () => {
        const file = this.app.vault.getAbstractFileByPath(this.settings.scratchPath);
        if (!file) return null;
        if (!(file instanceof TFile)) throw new Error('Scratchpad path is a folder');
        return this.app.vault.read(file);
      },
      write: async (expected, text) => {
        const path = this.settings.scratchPath;
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          await this.app.vault.process(file, current => {
            if (current !== expected && current !== text) throw new ScratchConflict('Scratchpad changed elsewhere');
            return text;
          });
        } else {
          if (file || expected !== null) throw new ScratchConflict('Scratchpad moved or deleted');
          await this.ensureParent(path);
          try { await this.app.vault.create(path, text); }
          catch (error) {
            if (this.app.vault.getAbstractFileByPath(path)) throw new ScratchConflict('Scratchpad created elsewhere');
            throw error;
          }
        }
      },
      recovery: value => this.app.saveLocalStorage(RECOVERY + ':' + this.settings.scratchPath, value)
    });
    this.retryScratchLoad();
  }

  retryScratchLoad(): void {
    void this.scratch.load(validRecovery(this.app.loadLocalStorage(RECOVERY + ':' + this.settings.scratchPath), this.settings.scratchPath));
  }

  async ensureParent(path: string): Promise<void> {
    const parts = path.split('/').slice(0, -1);
    let folder = '';
    for (const part of parts) {
      folder = folder ? `${folder}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(folder)) {
        try { await this.app.vault.createFolder(folder); }
        catch (error) { if (!this.app.vault.getAbstractFileByPath(folder)) throw error; }
      }
    }
  }

  /** Edit dialogs apply their validated, synchronous changes as one save and refresh. */
  batchEdit<T>(edit: () => T): T {
    this.editDepth++;
    try { return edit(); }
    finally {
      this.editDepth--;
      if (!this.editDepth && this.editPending) {
        const update = this.editUpdate;
        this.editPending = false; this.editUpdate = undefined;
        this.changed(update);
      }
    }
  }
  changed(update?: DeskUpdate): void {
    if (this.editDepth) {
      this.editUpdate = this.editPending ? mergeDeskUpdates(this.editUpdate, update) : update;
      this.editPending = true; return;
    }
    syncDeskWidgets(this.settings);
    // A targeted update must not discard a pending vault/content refresh.
    if (!update && this.refreshTimer) { clearTimeout(this.refreshTimer); this.refreshTimer = null; this.pendingRefresh = undefined; }
    const snapshot = JSON.parse(JSON.stringify(this.settings)) as DeskSettings;
    this.saves = this.saves.then(async () => {
      await this.saveData(snapshot); this.saveError = null;
    }).catch(error => {
      this.saveError = error instanceof Error ? error : new Error('Couldn’t save desk changes');
      console.error('Top of the Desk: settings save failed', error);
      new Notice('Couldn’t save your desk changes. Keep the desk open and try the change again.');
    });
    const choiceSignature = this.choiceSignature();
    if (choiceSignature !== this.addChoicesSignature) { this.addChoicesSignature = choiceSignature; this.addChoicesDirty = true; }
    this.refreshViews(update);
    if (isEnabledWidget(this.settings, 'daily') && (!update || (update.content !== false && update.widgets.includes('daily')))) void this.daily.sync();
  }
  private choiceSignature(): string {
    // Order, counts, sizing, placement and visibility preferences do not change search choices.
    return JSON.stringify([
      this.settings.items.map(item => ({ id: item.id, type: item.type, ...(item.type === 'stack' ? { name: item.name, paths: item.paths } : { path: item.path }) }))
        .sort((a, b) => compareNames(a.id, b.id)),
      this.settings.putAwayItems, !this.settings.pageTitle.trim(),
      Object.entries(this.settings.widgets).map(([id, w]) => ({ id, type: w.type, enabled: w.enabled, path: w.path, title: w.title, view: w.view, members: w.members }))
        .sort((a, b) => compareNames(a.id, b.id)),
    ]);
  }
  /** Useful for tests and for waiting until an arrangement is on disk. */
  async whenSaved(): Promise<void> {
    this.activity?.flushAll(); await this.saves;
    if (this.saveError) throw this.saveError;
  }
  refreshSoon(update?: DeskUpdate): void {
    if (this.unloaded) return;
    if (this.refreshTimer) {
      this.pendingRefresh = mergeDeskUpdates(this.pendingRefresh, update);
      return;
    }
    this.pendingRefresh = update;
    this.refreshTimer = setTimeout(() => {
      const pending = this.pendingRefresh;
      this.refreshTimer = null; this.pendingRefresh = undefined; this.refreshViews(pending);
    }, 180);
  }
  refreshViews(update?: DeskUpdate): void {
    if (this.unloaded) return;
    if (this.sourceChoicesDirty || this.addChoicesDirty) {
      const filesChanged = this.sourceChoicesDirty;
      this.sourceChoicesDirty = false; this.addChoicesDirty = false;
      for (const dialog of this.widgetDialogs) {
        if (dialog instanceof AddDeskModal || filesChanged && dialog instanceof SourceWidgetModal) dialog.refresh();
      }
    }
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) if (leaf.view instanceof DeskView) leaf.view.update(update);
  }
  async openDesk(): Promise<void> {
    if (this.opening) return this.opening;
    this.opening = (async () => {
      const active = this.app.workspace.activeLeaf;
      const existing = active?.view.getViewType() === VIEW ? active : this.app.workspace.getLeavesOfType(VIEW)[0];
      if (existing) { await this.app.workspace.revealLeaf(existing); return; }
      const leaf = active?.view.getViewType() === 'empty' ? active : this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW, active: true });
      await this.app.workspace.revealLeaf(leaf);
    })();
    try { await this.opening; } finally { this.opening = null; }
  }
  pin(path: string): void {
    const file = this.app.vault.getFileByPath(path);
    if (!file || file.extension !== 'md' || this.hasNote(path)) return;
    if (deskPaths(this.settings.items).length >= 300) { new Notice('The desk can hold up to 300 notes.'); return; }
    this.setDeskItems([...this.settings.items, { id: crypto.randomUUID(), type: 'note', path }]);
  }
  hasNote(path: string): boolean { return deskPaths(this.settings.items).includes(path); }
  pinFolder(path: string): string | null {
    const folder = path === '/' ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(path);
    if (!(folder instanceof TFolder)) return null;
    const existing = this.settings.items.find(item => item.type === 'folder' && item.path === path);
    if (existing) return existing.id;
    if (this.settings.items.filter(item => item.type === 'folder').length >= 100) { new Notice('The desk can hold up to 100 folders.'); return null; }
    const id = crypto.randomUUID();
    this.setDeskItems([...this.settings.items, { id, type: 'folder', path, description: '' }]);
    return id;
  }
  removeDeskItem(id: string, origin?: UndoOrigin): void {
    const item = this.settings.items.find(item => item.id === id);
    if (!item) return;
    this.changeDeskWithUndo(`${item.type === 'folder' ? 'Folder' : item.type === 'stack' ? 'Stack' : 'Note'} removed from desk`, this.settings.items.filter(item => item.id !== id), origin, item);
  }
  private clearUndo(): void { this.undo.clear(); }
  private setDeskItems(items: DeskItem[], preserveUndo = false): void {
    if (!preserveUndo) this.clearUndo();
    this.settings.items = normalizeDeskItems(items);
    const collections = new Set([...this.settings.items.filter(item => item.type !== 'note').map(item => item.id), ...Object.keys(this.settings.widgets)]);
    for (const id of this.collectionBrowseState.keys()) if (!collections.has(id)) this.collectionBrowseState.delete(id);
    this.wordCounts.retain(this.settings.items.filter(item => item.type !== 'note').map(item => item.id));
    syncDeskWidgets(this.settings);
    this.changed({ widgets: ['items', 'recents', ...this.settings.widgetOrder.filter(id => !!this.settings.widgets[id].itemId)], layout: true });
  }
  private restoreItemSurfaces(surfaces: Record<string, WidgetSettings>, order: string[]): void {
    // Keep later appearance edits; membership and placement belong to this Undo.
    for (const [id, saved] of Object.entries(surfaces)) {
      const current = this.settings.widgets[id];
      if (current) Object.assign(saved, { showHeading: current.showHeading, showBaseControls: current.showBaseControls });
    }
    this.settings.widgets = surfaces; this.settings.widgetOrder = order;
  }
  private changeDeskWithUndo(message: string, items: DeskItem[], origin?: UndoOrigin, putAway?: DeskItem): void {
    const previous = this.settings.items, saved = this.settings.putAwayItems;
    const surfaces = structuredClone(this.settings.widgets), order = [...this.settings.widgetOrder];
    if (putAway) this.settings.putAwayItems = [putAway, ...saved.filter(item => item.id !== putAway.id &&
      !(item.type !== 'stack' && putAway.type !== 'stack' && putAway.type === item.type && item.path === putAway.path))];
    this.setDeskItems(items);
    // Another item edit cancels this Undo, so it cannot overwrite later work.
    this.undo.show(message, () => { this.settings.putAwayItems = saved; this.restoreItemSurfaces(surfaces, order); this.setDeskItems(previous); }, origin);
  }
  unpin(path: string, origin?: UndoOrigin): void {
    if (!this.hasNote(path)) return;
    const item = this.settings.items.find(item => item.type === 'note' && item.path === path) || { id: crypto.randomUUID(), type: 'note' as const, path };
    this.changeDeskWithUndo('Note removed from desk', removeDeskNote(this.settings.items, path), origin, item);
  }
  putAwayBlocker(item: DeskItem): string | null {
    const items = this.settings.items;
    if (items.some(current => current.id === item.id)) return 'Already on the desk.';
    if (item.type === 'folder') return items.some(current => current.type === 'folder' && current.path === item.path) ? 'Already on the desk.' : null;
    if (item.type === 'note') return this.hasNote(item.path) ? 'Already on the desk.' : deskPaths(items).length >= 300 ? 'The desk can hold up to 300 notes.' : null;
    const conflict = items.find(current => current.type === 'stack' && current.paths.some(path => item.paths.includes(path)));
    if (conflict?.type === 'stack') return `Some notes are in ${conflict.name || 'another stack'}. Remove that stack from the desk before restoring this one.`;
    return new Set([...deskPaths(items), ...item.paths]).size > 300 ? 'The desk can hold up to 300 notes.' : null;
  }
  restorePutAway(id: string): boolean {
    const saved = this.settings.putAwayItems.find(item => item.id === id);
    if (!saved) return false;
    const blocker = this.putAwayBlocker(saved);
    if (blocker) { new Notice(blocker); return false; }
    if (saved.type === 'folder' && this.settings.items.filter(item => item.type === 'folder').length >= 100) {
      new Notice('The desk can hold up to 100 folders.'); return false;
    }
    const items = saved.type === 'stack' ? this.settings.items.filter(item => item.type !== 'note' || !saved.paths.includes(item.path)) : this.settings.items;
    this.settings.putAwayItems = this.settings.putAwayItems.filter(item => item.id !== id);
    this.setDeskItems([...items, saved]);
    return true;
  }
  pickStackNotes(id?: string, restoreFocus?: () => void): void { new StackNotesModal(this, id, restoreFocus).open(); }
  saveStackNotes(paths: string[], name?: string, id?: string): boolean {
    const selected = [...new Set(paths)];
    const stack = id ? this.settings.items.find(item => item.id === id && item.type === 'stack') : null;
    if (id && !stack) { new Notice('This stack is no longer on the desk.'); return false; }
    if (selected.length < (id ? 1 : 2)) { new Notice(id ? 'Choose at least one note to add.' : COPY.stackMinimum); return false; }
    if (selected.some(path => this.app.vault.getFileByPath(path)?.extension !== 'md' || this.settings.items.some(item => item.type === 'stack' && item.id !== id && item.paths.includes(path)))) {
      new Notice('Some selected notes are unavailable or already in another stack. Choose them again.'); return false;
    }
    if (new Set([...deskPaths(this.settings.items), ...selected]).size > 300) { new Notice('The desk can hold up to 300 notes.'); return false; }
    const items = this.settings.items.filter(item => item.type !== 'note' || !selected.includes(item.path));
    if (stack?.type === 'stack') this.changeDeskWithUndo('Notes added to stack', items.map(item => item.id === id ? { ...stack, paths: [...new Set([...stack.paths, ...selected])] } : item));
    else {
      const first = this.settings.items.findIndex(item => item.type === 'note' && selected.includes(item.path));
      items.splice(first < 0 ? items.length : first, 0, { id: first < 0 ? crypto.randomUUID() : this.settings.items[first].id, type: 'stack', name: name?.trim() || 'Stack', paths: selected });
      this.changeDeskWithUndo('Stack created', items);
    }
    return true;
  }
  moveDeskItem(id: string, destination: number): void {
    const item = this.settings.items.find(item => item.id === id);
    if (!item) return;
    const items = this.settings.items.filter(item => item.id !== id);
    items.splice(Math.max(0, Math.min(destination, items.length)), 0, item);
    this.setDeskItems(items);
  }
  placeDeskItem(id: string, targetId: string, after: boolean): void {
    if (id === targetId) return;
    const others = this.settings.items.filter(item => item.id !== id);
    const index = others.findIndex(item => item.id === targetId);
    if (index >= 0) this.moveDeskItem(id, index + Number(after));
  }
  /** Group note references only. Folder shortcuts are never converted into stacks. */
  stackNote(path: string, targetId: string, makeMain = false, origin?: UndoOrigin, destination?: number): boolean {
    const target = this.settings.items.find(item => item.id === targetId);
    if (!target || target.type === 'folder') return false;
    if (!this.hasNote(path)) {
      if (this.app.vault.getFileByPath(path)?.extension !== 'md') return false;
      if (deskPaths(this.settings.items).length >= 300) { new Notice('The desk can hold up to 300 notes.'); return false; }
    }
    if (itemPaths(target).includes(path)) {
      if (target.type === 'stack' && makeMain) this.promoteStackNote(targetId, path);
      return false;
    }
    const paths = [...itemPaths(target)];
    paths.splice(Math.max(0, Math.min(destination ?? (makeMain ? 0 : paths.length), paths.length)), 0, path);
    const items = removeDeskNote(this.settings.items, path).map(item => item.id === targetId
      ? target.type === 'stack' ? { ...target, paths } : { id: targetId, type: 'stack' as const, name: '', paths } : item);
    this.changeDeskWithUndo(target.type === 'note' ? 'Stack created' : 'Note added to stack', items, origin);
    return target.type === 'note';
  }
  promoteStackNote(id: string, path: string): void {
    this.moveStackNote(id, path, 0);
  }
  moveStackNote(id: string, path: string, destination: number, origin?: UndoOrigin): void {
    const stack = this.settings.items.find(item => item.id === id);
    if (stack?.type !== 'stack' || !stack.paths.includes(path)) return;
    const index = Math.max(0, Math.min(destination, stack.paths.length - 1));
    if (stack.paths.indexOf(path) === index) return;
    const paths = stack.paths.filter(candidate => candidate !== path);
    paths.splice(index, 0, path);
    this.changeDeskWithUndo('Note moved in stack', this.settings.items.map(item => item.id === id ? { ...stack, paths } : item), origin);
  }
  detachNote(path: string, targetId?: string, after = true): void {
    const source = this.settings.items.find(item => itemPaths(item).includes(path));
    if (!source) return;
    if (source.type === 'note') return; // Grid placement is handled separately.
    const items = removeDeskNote(this.settings.items, path);
    const targetIndex = items.findIndex(item => item.id === (targetId || source.id));
    const index = targetIndex < 0 ? items.length : targetIndex + Number(after);
    items.splice(index, 0, { id: crypto.randomUUID(), type: 'note', path });
    this.changeDeskWithUndo('Note moved out of stack', items);
  }
  editCollection(id: string, restoreFocus?: () => void, rootId = itemWidgetId(id)): void {
    new CollectionDetailsModal(this, id, () => restoreFocus?.(), rootId).open();
  }
  updateCollection(id: string, description: string, name?: string, counts?: CollectionCountSettings): void {
    const item = this.settings.items.find(item => item.id === id);
    if (!item || item.type === 'note') return;
    const surface = this.settings.widgets[itemWidgetId(id)];
    const next = normalizeDeskItems([{ ...item, ...counts, description, ...(item.type === 'stack' ? { name: name ?? item.name } : {}) }])[0];
    const title = name === undefined ? surface?.title || '' : name.replace(/[\x00-\x1f]/g, '').trim().slice(0, 80);
    if (JSON.stringify(next) === JSON.stringify(item) && (item.type !== 'folder' || surface?.title === title)) return;
    this.clearUndo();
    if (surface?.type === 'folder') surface.title = title;
    this.settings.items = this.settings.items.map(current => current.id === id ? next : current);
    this.changed({ widgets: [itemWidgetId(id)] });
  }

  unstack(id: string, origin?: UndoOrigin): void {
    if (!this.settings.items.some(item => item.id === id && item.type === 'stack')) return;
    this.changeDeskWithUndo('Notes unstacked', this.settings.items.flatMap<DeskItem>(item => item.id === id && item.type === 'stack'
      ? item.paths.map((path, index) => ({ id: index ? crypto.randomUUID() : id, type: 'note' as const, path })) : [item]), origin);
  }
  revealDeskWidget(id: string, scroll = true): void {
    const owner = widgetStackFor(this.settings, id);
    if (!this.settings.widgets[owner || id]?.enabled) this.restoreWidget(owner || id, false);
    if (owner) this.selectStackWidget(owner, id);
    const reveal = () => this.app.workspace.getActiveViewOfType(DeskView)?.revealWidget(owner || id, scroll);
    if (this.app.workspace.getActiveViewOfType(DeskView)) reveal();
    else void this.openDesk().then(reveal);
  }
  pickWidgetStack(): void { new WidgetStackModal(this).open(); }
  /** Flatten groups while retaining every member's original configuration and size. */
  stackWidgets(ids: string[], origin?: UndoOrigin): string | null {
    const roots = [...new Set(ids)].filter(id => isRootWidget(this.settings, id) && canStackWidget(this.settings.widgets[id]));
    if (roots.length < 2) return null;
    const before = structuredClone(this.settings.widgets), order = [...this.settings.widgetOrder];
    this.clearUndo();
    const target = roots[0], destination = this.settings.widgets[target];
    const members = roots.flatMap(id => this.settings.widgets[id].type === 'widget-stack' ? this.settings.widgets[id].members || [] : [id]);
    const id = destination.type === 'widget-stack' ? target : `widgets-${crypto.randomUUID()}`;
    const active = destination.type === 'widget-stack' ? destination.activeMember : target;
    const positions = Object.fromEntries(([1, 2, 4] as const).map(columns => { const rect = resolveWidgetLayout(this.settings, columns).get(target)!; return [columns, { column: rect.column, row: rect.row }]; }));
    const compact = members.every(member => isCompactSourceType(this.settings.widgets[member].type));
    this.settings.widgets[id] = { ...widgetDefaults('widget-stack'), columns: compact ? 1 : destination.columns, rows: compact ? HALF_HEIGHT : Math.max(STANDARD_HEIGHT, destination.rows),
      positions, members, activeMember: active };
    for (const root of roots) if (root !== id && this.settings.widgets[root].type === 'widget-stack') delete this.settings.widgets[root];
    if (!this.settings.widgetOrder.includes(id)) this.settings.widgetOrder.splice(Math.max(0, this.settings.widgetOrder.indexOf(target)), 0, id);
    for (const columns of [1, 2, 4] as const) rememberWidgetLayout(this.settings, columns, resolveWidgetLayout(this.settings, columns, id));
    this.changed({ widgets: [...members, id], layout: true });
    this.undo.show('Items stacked', () => { this.restoreItemSurfaces(before, order); this.changed(); }, origin);
    return id;
  }
  selectStackWidget(id: string, member: string): void {
    const stack = this.settings.widgets[id];
    if (stack?.type !== 'widget-stack' || !stack.members?.includes(member) || stack.activeMember === member) return;
    const previous = stack.activeMember;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) if (leaf.view instanceof DeskView) leaf.view.dismissPreviews();
    stack.activeMember = member;
    // Selection changes content, not the shared frame's size or grid position.
    this.changed({ widgets: [id, member, ...(previous ? [previous] : [])] });
  }
  takeWidgetOut(id: string, member?: string, origin?: UndoOrigin): void {
    const stack = this.settings.widgets[id];
    if (stack?.type !== 'widget-stack' || !stack.members?.length || member && !stack.members.includes(member)) return;
    const before = structuredClone(this.settings.widgets), order = [...this.settings.widgetOrder];
    this.clearUndo();
    const released = member ? [member] : [...stack.members];
    const remaining = stack.members.filter(key => !released.includes(key));
    if (remaining.length < 2) { released.push(...remaining); delete this.settings.widgets[id]; }
    else { stack.members = remaining; if (!remaining.includes(stack.activeMember || '')) stack.activeMember = remaining[0]; }
    for (const [index, key] of released.entries()) {
      const widget = this.settings.widgets[key];
      // Start near the stack; collision resolution keeps other items intact.
      widget.positions = Object.fromEntries(Object.entries(stack.positions || {}).map(([columns, position]) => [columns, { column: position.column, row: position.row + (remaining.length >= 2 ? stack.rows : 0) + index * widget.rows }]));
      delete widget.resizeOrigins;
    }
    this.changed({ widgets: [...released, id], layout: true });
    this.undo.show(member ? 'Item moved out of stack' : 'Items unstacked', () => { this.restoreItemSurfaces(before, order); this.changed(); }, origin);
  }

  setWidgetSize(key: string, size: WidgetSize, columns: GridColumns = 4, origin?: UndoOrigin): void {
    size = { ...size, rows: normalizeWidgetRows(size.rows) };
    const widget = this.settings.widgets[key];
    if (!widget?.enabled || isFixedSizeWidget(this.settings, key) || (widget.columns === size.columns && widget.rows === size.rows)) return;
    const undo = this.layoutUndo();
    resizeWidgetLayout(this.settings, key, size, columns);
    this.changed({ widgets: [key], content: false, layout: true });
    this.undo.show(`${widgetName(widget)} resized`, undo, origin);
  }
  trackWidgetDialog(dialog: Modal): () => void {
    this.widgetDialogs.add(dialog);
    return () => this.widgetDialogs.delete(dialog);
  }
  focusDeskControls(): void {
    void this.openDesk().then(() => {
      const view = this.app.workspace.getActiveViewOfType(DeskView);
      view?.focusControls();
    });
  }
  configureWidget(id: string, restoreFocus?: () => void): void {
    const rootId = widgetStackFor(this.settings, id) || id;
    const root = this.settings.widgets[rootId];
    const sourceId = id === rootId && root?.type === 'widget-stack' ? root.activeMember || root.members?.[0] || id : id;
    const widget = this.settings.widgets[sourceId];
    if (!root?.enabled || !widget) return;
    if (widget.itemId && widget.type !== 'note') {
      const source = widget.path === '/' ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(widget.path);
      if (widget.type === 'folder' && !(source instanceof TFolder)) new SourceWidgetModal(this, 'folder', sourceId, restoreFocus, rootId).open();
      else this.editCollection(widget.itemId, restoreFocus, rootId);
    } else if (isSourceWidgetType(widget.type) || widget.type === 'folder') {
      new SourceWidgetModal(this, widget.type, sourceId, restoreFocus, rootId).open();
    } else new ItemEditModal(this, rootId, sourceId, restoreFocus).open();
  }
  addWidget(type: WidgetKey, source?: WidgetSettings, reveal = true): string | null {
    if (type === 'folder' && source?.path) { const item = this.pinFolder(source.path); if (item) { Object.assign(this.settings.widgets[itemWidgetId(item)], source, { itemId: item, type: 'folder', enabled: true, presentation: 'list' }); this.changed({ widgets: [itemWidgetId(item)], layout: true }); } return item ? itemWidgetId(item) : null; }
    if (!isSourceWidgetType(type) && type !== 'folder') { this.restoreWidget(type, reveal); return this.settings.widgets[type] ? type : null; }
    this.clearUndo();
    const id = `${type}-${crypto.randomUUID()}`;
    this.settings.widgets[id] = { ...(source || this.settings.widgets[id] || widgetDefaults(type)), type, enabled: true };
    this.settings.widgetOrder = [...this.settings.widgetOrder.filter(key => key !== id), id];
    this.changed({ widgets: [id], layout: true });
    if (!reveal) return id;
    void this.openDesk().then(() => {
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) if (leaf.view instanceof DeskView) leaf.view.revealWidget(id);
    });
    return id;
  }
  validDeskSource(source: DeskSource): boolean {
    if (source.kind === 'web') return !!sourceWebUrl(source.path);
    const item = source.path === '/' ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(source.path);
    return source.kind === 'folder' ? item instanceof TFolder : item instanceof TFile && matchesSourceFile(source.kind, item.extension);
  }
  addSourceToDesk(source: DeskSource, reveal = true): string | null {
    if (!this.validDeskSource(source)) return null;
    if (source.kind === 'note') {
      const owner = this.settings.items.find(item => item.type !== 'folder' && itemPaths(item).includes(source.path));
      if (!owner) this.pin(source.path);
      const item = owner || this.settings.items.find(item => item.type === 'note' && item.path === source.path);
      const id = item ? itemWidgetId(item.id) : null;
      if (id && reveal) this.revealDeskWidget(id);
      return id;
    }
    if (source.kind === 'folder') {
      const item = this.pinFolder(source.path), id = item ? itemWidgetId(item) : null;
      const root = id ? widgetStackFor(this.settings, id) || id : null;
      if (root && !this.settings.widgets[root]?.enabled) this.restoreWidget(root, false);
      if (id && reveal) this.revealDeskWidget(id);
      return root;
    }
    const existing = sourceWidgetId(this.settings, source);
    if (existing) {
      const root = widgetStackFor(this.settings, existing) || existing;
      if (!this.settings.widgets[root]?.enabled) this.restoreWidget(root, false);
      if (reveal) this.revealDeskWidget(existing);
      return root;
    }
    return this.addWidget(source.kind, { ...widgetDefaults(source.kind), path: source.path, title: (source.title || '').slice(0, 100) }, reveal);
  }
  recordFolderOpen(path: string): void {
    if (this.recents.openFolder(path)) { this.addChoicesDirty = true; this.refreshSoon({ widgets: ['recents'] }); }
  }
  restoreWidget(id: string, reveal = true): void {
    const widget = this.settings.widgets[id];
    if (!widget || widget.enabled) return;
    if (widget.itemId) { this.restorePutAway(widget.itemId); return; }
    this.clearUndo(); widget.enabled = true;
    if (widget.type === 'activity' || widget.members?.includes('activity')) this.activity.start();
    this.changed({ widgets: [id], layout: true });
    // Restoring through Add to desk or its Undo keeps the picker and keyboard focus in place.
    const choosing = [...this.widgetDialogs].some(dialog => dialog instanceof AddDeskModal);
    if (reveal && !choosing) void this.openDesk().then(() => {
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) if (leaf.view instanceof DeskView) leaf.view.revealWidget(id);
    });
  }
  updateWidget(id: string, settings: WidgetSettings): boolean {
    const current = this.settings.widgets[id];
    if (!current) return false;
    if (current.path === settings.path && current.view === settings.view && current.title === settings.title) return true;
    if (current.itemId && current.type === 'folder') {
      if (this.settings.items.some(item => item.type === 'folder' && item.id !== current.itemId && item.path === settings.path)) { new Notice('That folder is already on the desk.'); return false; }
      this.settings.items = this.settings.items.map(item => item.id === current.itemId && item.type === 'folder' ? { ...item, path: settings.path } : item);
    }
    this.clearUndo();
    this.settings.widgets[id] = { ...current, path: settings.path, view: settings.view, title: settings.title };
    this.changed({ widgets: [id], content: current.path !== settings.path || current.view !== settings.view || !!current.itemId });
    return true;
  }
  setFolderPresentation(id: string, presentation: 'cover' | 'list', origin?: UndoOrigin): void {
    const widget = this.settings.widgets[id];
    if (widget?.type !== 'folder' || !widget.itemId || (widget.presentation || 'cover') === presentation) return;
    this.clearUndo();
    const previous = structuredClone(widget);
    const toList = presentation === 'list';
    if (toList) widget.coverSize = { columns: widget.columns, rows: widget.rows };
    else widget.listSize = { columns: widget.columns, rows: widget.rows };
    widget.presentation = toList ? 'list' : 'cover';
    const size: WidgetSize = toList ? widget.listSize || { columns: widget.columns, rows: Math.max(STANDARD_HEIGHT, widget.rows) } : widget.coverSize || { columns: widget.columns, rows: HALF_HEIGHT };
    const columns = this.app.workspace.getActiveViewOfType(DeskView)?.gridColumns ?? 4;
    const layout = structuredClone(this.settings.widgets);
    resizeWidgetLayout(this.settings, id, size, columns);
    this.changed({ widgets: [id], layout: true });
    this.undo.show(toList ? 'Folder list shown' : 'Folder cover shown', () => {
      for (const [key, saved] of Object.entries(layout)) {
        const current = this.settings.widgets[key];
        if (current) Object.assign(current, { columns: saved.columns, rows: saved.rows, positions: saved.positions, resizeOrigins: saved.resizeOrigins });
      }
      const current = this.settings.widgets[id];
      if (!current) return;
      Object.assign(current, { presentation: previous.presentation, columns: previous.columns, rows: previous.rows, coverSize: previous.coverSize, listSize: previous.listSize });
      this.changed({ widgets: [id], layout: true });
    }, origin);
  }
  setWidgetHeading(id: string, shown: boolean): void {
    const widget = this.settings.widgets[id];
    const state = widgetHeadingState(this.settings, id);
    if (!widget || state === null || state === shown) return;
    const targets = widget.type === 'widget-stack' ? widget.members || [] : [id];
    for (const key of targets) {
      const member = this.settings.widgets[key];
      if (canHideWidgetHeading(member)) member.showHeading = shown;
    }
    this.changed({ widgets: [...new Set([id, ...targets])], content: false });
  }
  setBaseControls(id: string, shown: boolean): void {
    const widget = this.settings.widgets[id];
    if (widget?.type !== 'base' || (widget.showBaseControls !== false) === shown) return;
    widget.showBaseControls = shown;
    this.changed({ widgets: [id, ...(widgetStackFor(this.settings, id) ? [widgetStackFor(this.settings, id)!] : [])], content: false });
  }
  removeFromDesk(id: string, origin?: UndoOrigin): void {
    const view = this.app.workspace.getActiveViewOfType(DeskView);
    if (view) view.putAwayWidget(id, origin);
    else this.removeWidget(id, origin);
  }
  removeWidget(id: string, origin?: UndoOrigin): void {
    const widget = this.settings.widgets[id];
    if (!widget || !widget.enabled) return;
    if (widget.itemId) { this.removeDeskItem(widget.itemId, origin); return; }
    this.clearUndo(); widget.enabled = false;
    if (widget.type === 'scratchpad') void this.scratch.flush();
    if (widget.type === 'daily') void this.daily.flush();
    if (widget.type === 'widget-stack') {
      if (widget.members?.includes('scratchpad')) void this.scratch.flush();
      if (widget.members?.includes('daily')) void this.daily.flush();
    }
    this.changed({ widgets: [id], layout: true });
    this.undo.show(`${widgetName(widget)} removed from desk`, () => this.restoreWidget(id), origin);
  }
  moveWidgetTo(id: string, target: GridPosition, columns: GridColumns = 4, origin?: UndoOrigin): void {
    const widget = this.settings.widgets[id];
    if (!widget?.enabled) return;
    const layout = resolveWidgetLayout(this.settings, columns), current = layout.get(id);
    if (!current) return;
    const column = Math.max(1, Math.min(columns - current.columns + 1, Math.floor(target.column)));
    const row = Math.max(1, Math.min(20000, Math.floor(target.row)));
    if (!Number.isFinite(column) || !Number.isFinite(row) || (current.column === column && current.row === row)) return;
    const undo = this.layoutUndo();
    commitWidgetMove(this.settings, id, columns, layout, plannedWidgetMove(this.settings, id, { column, row }, columns));
    this.changed({ widgets: [], content: false, layout: true });
    this.undo.show(`${widgetName(widget)} moved`, undo, origin);
  }
  /** Source rows use the grid planner too, committing membership and placement as one Undo. */
  dropSourcesOnDesk(sources: SourceMove[], destination: GridPosition, columns: GridColumns, origin?: UndoOrigin): string | null {
    if (!sources.length || sources.some(({ source }) => !this.validDeskSource(source))) return null;
    const prepared = sourceMovesDraft(this.settings, sources, columns);
    if (!prepared) return null;
    const previous = this.settings.items, surfaces = structuredClone(this.settings.widgets), order = [...this.settings.widgetOrder];
    const draft = { ...prepared.settings, widgets: structuredClone(prepared.settings.widgets), widgetOrder: [...prepared.settings.widgetOrder] };
    const next = plannedSourceMoves(draft, prepared.ids, destination, columns);
    commitWidgetMove(draft, prepared.ids[0], columns, resolveWidgetLayout(this.settings, columns), next);
    for (const id of prepared.ids) {
      const origins = draft.widgets[id].resizeOrigins;
      if (origins) { delete origins[columns]; if (!Object.keys(origins).length) delete draft.widgets[id].resizeOrigins; }
    }
    this.settings.widgets = draft.widgets; this.settings.widgetOrder = draft.widgetOrder;
    this.setDeskItems(draft.items);
    this.undo.show(`${prepared.ids.length} ${prepared.ids.length === 1 ? 'item' : 'items'} placed on desk`, () => { this.restoreItemSurfaces(surfaces, order); this.setDeskItems(previous); }, origin);
    return prepared.ids[0];
  }
  dropSourceOnDesk(source: DeskSource, itemId: string, destination: GridPosition | { group: string }, columns: GridColumns, origin?: UndoOrigin): string | null {
    if (!this.validDeskSource(source)) return null;
    if ('group' in destination && source.kind === 'note') {
      const target = this.settings.widgets[destination.group];
      if (!target?.itemId || (target.type !== 'note' && target.type !== 'stack')) return null;
      this.stackNote(source.path, target.itemId, false, origin);
      return destination.group;
    }
    const prepared = sourceMoveDraft(this.settings, source, itemId, columns);
    if (!prepared) return null;
    const { settings: draft, id } = prepared;
    if (draft === this.settings) {
      if ('group' in destination) return this.stackWidgets([destination.group, id], origin);
      this.moveWidgetTo(id, destination, columns, origin); return id;
    }
    if ('group' in destination && (!isRootWidget(draft, destination.group) || !canStackWidget(draft.widgets[destination.group]) || !canStackWidget(draft.widgets[id]))) return null;
    const previous = this.settings.items, surfaces = structuredClone(this.settings.widgets), order = [...this.settings.widgetOrder];
    if (!('group' in destination)) {
      commitWidgetMove(draft, id, columns, resolveWidgetLayout(this.settings, columns), plannedWidgetMove(draft, id, destination, columns));
    }
    this.settings.widgets = draft.widgets; this.settings.widgetOrder = draft.widgetOrder;
    this.setDeskItems(draft.items);
    const placed = 'group' in destination ? this.stackWidgets([destination.group, id], origin) : id;
    this.undo.show('group' in destination ? 'Items stacked' : `${SOURCE_TYPES[source.kind].name} placed on desk`,
      () => { this.restoreItemSurfaces(surfaces, order); this.setDeskItems(previous); }, origin);
    return placed;
  }
  /** Restore layout fields only, keeping any later name, source, and appearance edits. */
  private layoutUndo(): () => void {
    this.clearUndo();
    const order = [...this.settings.widgetOrder];
    const snapshot = Object.fromEntries(Object.entries(this.settings.widgets).map(([id, widget]) =>
      [id, { columns: widget.columns, rows: widget.rows,
        positions: widget.positions ? { ...widget.positions } : undefined,
        resizeOrigins: widget.resizeOrigins ? { ...widget.resizeOrigins } : undefined }]));
    return () => {
      this.clearUndo();
      for (const [id, layout] of Object.entries(snapshot)) {
        const widget = this.settings.widgets[id];
        if (widget) Object.assign(widget, layout);
      }
      this.settings.widgetOrder = [...order.filter(id => this.settings.widgets[id]), ...this.settings.widgetOrder.filter(id => !order.includes(id))];
      this.changed({ widgets: Object.keys(snapshot), content: false, layout: true });
    };
  }
  openSettings(tabId = this.manifest.id): void {
    // Obsidian's settings controller is not included in the public App type.
    const settings = (this.app as unknown as { setting: { open(): void; openTabById(id: string): unknown } }).setting;
    settings.open();
    settings.openTabById(tabId);
  }
  pickDesk(): void { new AddDeskModal(this).open(); }
  private fileConsumers(file: TFile, contentChanged: boolean): string[] {
    const ids = new Set<string>();
    if (file.extension.toLowerCase() === 'md') for (const item of this.settings.items) {
      if (item.type === 'note' ? item.path === file.path : item.type === 'stack' ? item.paths.includes(file.path)
        : contentChanged && item.showWordCount === true && (item.path === '/' || file.path.startsWith(item.path + '/'))) ids.add(itemWidgetId(item.id));
    }
    if (contentChanged) for (const [id, widget] of Object.entries(this.settings.widgets)) {
      if (widget.type === 'image' && widget.path === file.path) ids.add(id);
    }
    return [...ids];
  }
  recordWork(path: string): void {
    if (this.lastWorked.record(path)) this.refreshSoon({ widgets: [], content: false, markers: true });
  }
  async openPath(path: string, event?: MouseEvent | KeyboardEvent): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) { new Notice('This file is no longer available.'); return; }
    try { await this.app.workspace.getLeaf(event && 'button' in event && event.button === 1 ? 'tab' : event ? Keymap.isModEvent(event) : false).openFile(file); }
    catch (error) {
      console.error('Top of the Desk: could not open file', error);
      new Notice('Couldn’t open this file. Try again.');
    }
  }
  async resumePath(path: string, event?: MouseEvent | KeyboardEvent): Promise<void> {
    if (event && Keymap.isModEvent(event)) { await this.openPath(path, event); return; }
    const leaf = this.app.workspace.getLeavesOfType('markdown').find(leaf => (leaf.view as { file?: TFile }).file?.path === path);
    if (leaf) { await this.app.workspace.revealLeaf(leaf); return; }
    await this.openPath(path, event);
  }
  async revealFolder(path: string): Promise<void> {
    const folder = path === '/' ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(path);
    if (!(folder instanceof TFolder)) { new Notice(COPY.folderUnavailable); return; }
    // Use the same native action as Obsidian's folder breadcrumbs, including sidebar reveal.
    const files = (this.app as unknown as {
      internalPlugins?: { getEnabledPluginById(id: string): { revealInFolder?(folder: TFolder): Promise<void> } | null };
    }).internalPlugins?.getEnabledPluginById('file-explorer');
    if (!files?.revealInFolder) { new Notice('Turn on Files in Obsidian’s core plugin settings to show this folder.'); return; }
    try { await files.revealInFolder(folder); this.recordFolderOpen(path); }
    catch (error) { console.error('Top of the Desk: folder reveal failed', error); new Notice('Couldn’t show this folder in the file explorer.'); }
  }
  async openScratchpad(): Promise<void> {
    await this.scratch.flush();
    const path = this.settings.scratchPath;
    if (!this.app.vault.getAbstractFileByPath(path)) {
      if (this.scratch.dirty || this.scratch.conflict) { new Notice('Save your scratchpad draft as a new note before opening the original.'); return; }
      try { await this.ensureParent(path); await this.app.vault.create(path, ''); }
      catch { new Notice('Couldn’t create the scratchpad note. Try again.'); return; }
    }
    await this.openPath(path);
  }
  async saveScratchCopy(): Promise<void> {
    const text = this.scratch.text, original = this.settings.scratchPath.replace(/\.md$/i, '');
    const suffix = new Date().toISOString().replace(/[:.]/g, '-');
    let path = `${original} — recovered ${suffix}.md`, n = 1;
    while (this.app.vault.getAbstractFileByPath(path)) path = `${original} — recovered ${suffix} ${n++}.md`;
    try {
      await this.ensureParent(path);
      await this.app.vault.create(path, text);
      await this.scratch.copiedDraft(text);
      new Notice(draftSaved(path));
    } catch { new Notice(DRAFT_COPY.copyError); }
  }
  async setScratchPath(path: string): Promise<boolean> {
    const next = safePath(path, 'md');
    if (!next) { new Notice('Enter a note path inside this vault, such as Desk/Scratchpad.md.'); return false; }
    await this.scratch.flush();
    if (this.scratch.dirty) { new Notice('Save your scratchpad draft before choosing a different note.'); return false; }
    if (next === this.settings.scratchPath) return true;
    this.scratch.stop(); this.settings.scratchPath = next;
    this.setupScratch(); this.changed({ widgets: ['scratchpad', 'recents'] }); return true;
  }
  previewStamp(file: TFile): string {
    const summary = this.app.metadataCache.getFileCache(file)?.frontmatter?.summary;
    return JSON.stringify([this.wordCounts.stamp(file), typeof summary === 'string' ? summary : '']);
  }
  folderNotes(folder: TFolder): TFile[] {
    let notes = this.folderNotesCache.get(folder);
    if (!notes) { notes = notesInFolder(folder); this.folderNotesCache.set(folder, notes); }
    return notes;
  }
  async preview(file: TFile): Promise<string> {
    const path = file.path, stamp = this.previewStamp(file), cached = this.previewCache.get(path);
    if (cached?.stamp === stamp) return cached.text;
    const summary = this.app.metadataCache.getFileCache(file)?.frontmatter?.summary;
    const entry = { stamp, text: typeof summary === 'string' && summary.trim()
      ? Promise.resolve(excerpt('', summary))
      : this.noteReads.read(file, this.wordCounts.stamp(file)).then(text => excerpt(text.slice(0, 16000))) };
    if (this.previewCache.size >= 300) this.previewCache.delete(this.previewCache.keys().next().value!);
    this.previewCache.set(path, entry);
    try { return await entry.text; }
    catch (error) { if (this.previewCache.get(path) === entry) this.previewCache.delete(path); throw error; }
  }
  wordCountStamp(file: TFile): string { return this.wordCounts.stamp(file); }
  noteWordCount(file: TFile): Promise<number> { return this.wordCounts.count(file); }
  collectionWordCount(id: string, files: TFile[], active: () => boolean): Promise<number> {
    return this.wordCounts.total(id, files, active);
  }
  async baseViews(path: string): Promise<string[]> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return [];
    try {
      const data = parseYaml(await this.app.vault.cachedRead(file));
      return Array.isArray(data?.views) ? data.views.map((v: { name?: unknown }) => v?.name).filter((n: unknown): n is string => typeof n === 'string') : [];
    } catch { return []; }
  }
}

function iconButton(parent: HTMLElement, icon: string, label: string, action: (event: MouseEvent) => void): HTMLButtonElement {
  const button = parent.createEl('button', { cls: 'tod-icon-button', attr: { 'aria-label': label } });
  setIcon(button, icon); updateTooltip(button, label); button.addEventListener('click', action); return button;
}

interface WidgetControls {
  sizeButton: HTMLButtonElement;
  gripButton: HTMLButtonElement;
  editButton: HTMLButtonElement;
  stackButton?: HTMLButtonElement;
}
interface DeskWidget {
  kind: string;
  el: HTMLElement;
  heading: HTMLElement;
  title: HTMLElement;
  titleButton?: HTMLButtonElement;
  openButton?: HTMLButtonElement;
  toolsToggle: HTMLButtonElement;
  body: HTMLElement;
  arrangement: { el: HTMLElement; controls: WidgetControls };
  source?: BaseWidget | FolderWidget | SourceCardWidget;
  activity?: WritingHeatmap;
  switcher?: WidgetStackSwitcher;
}
interface NoteEditor {
  input: WidgetMarkdownEditor;
  openButton: HTMLButtonElement;
  status: HTMLElement;
  actions: HTMLElement;
  empty?: WidgetEmptyState;
}

class DeskView extends ItemView {
  private shell!: HTMLElement;
  private pageHeader!: HTMLElement;
  private pageTitle!: HTMLElement;
  private widgetsEl!: HTMLElement;
  private widgets = new Map<string, DeskWidget>();
  private quickActions = new Map<string, { button: HTMLButtonElement; label: string }>();
  private headingEdited = false;
  private addDeskButton!: HTMLButtonElement;
  private editingTitle = false;
  private addDeskDialog: AddDeskModal | null = null;
  private deskItems!: DeskItemsView;
  private recentsEl!: HTMLElement;
  private recentsSignature: string | null = null;
  private scratchEditor: NoteEditor | null = null;
  private dailyEditor: NoteEditor | null = null;
  private dailyDate: HTMLTimeElement | null = null;
  private dailyCreateLabel: HTMLElement | null = null;
  private dailyCreateIcon: HTMLElement | null = null;
  private scratchUnsubscribe: (() => void) | null = null;
  private dailyUnsubscribe: (() => void) | null = null;
  private currentScratch: ScratchStore | null = null;
  private widgetGrid!: WidgetGrid;
  private controlTooltips!: ControlTooltips;
  private closed = false;

  constructor(leaf: WorkspaceLeaf, private plugin: DeskPlugin) { super(leaf); }
  getViewType(): string { return VIEW; }
  getDisplayText(): string { return 'Top of the Desk'; }
  getIcon(): string { return 'panels-top-left'; }

  async onOpen(): Promise<void> {
    this.closed = false; this.editingTitle = false;
    this.contentEl.empty(); this.contentEl.addClass('tod-view');
    this.shell = this.contentEl.createDiv('tod-shell has-desk');
    this.controlTooltips = this.addChild(new ControlTooltips(this.contentEl));
    this.pageHeader = this.shell.createEl('header', { cls: 'tod-header' });
    this.pageTitle = this.pageHeader.createEl('h1');
    this.pageTitle.oninput = () => {
      this.headingEdited = true;
      this.pageTitle.toggleClass('is-empty', !this.pageTitle.textContent?.trim());
    };
    this.pageTitle.onkeydown = event => {
      if (event.isComposing) return;
      if (!this.editingTitle && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault(); this.editPageTitle(); return;
      }
      if (!this.editingTitle || (event.key !== 'Enter' && event.key !== 'Escape')) return;
      event.preventDefault(); event.stopPropagation(); this.finishTitleEdit(event.key === 'Enter');
    };
    this.pageTitle.onclick = () => this.editPageTitle();
    this.pageTitle.onblur = () => this.finishTitleEdit(true);
    this.createQuickActions();
    this.widgetsEl = this.shell.createDiv('tod-widgets');
    this.widgetGrid = this.addChild(new WidgetGrid(this.plugin, this.widgetsEl, () => { this.controlTooltips.hide(); this.deskItems?.dismiss(); }));
    this.registerDomEvent(this.contentEl.ownerDocument, 'pointerdown', event => {
      const target = event.target as HTMLElement;
      for (const widget of this.widgets.values()) if (!widget.el.contains(target)) this.closeItemControls(widget);
    }, true);
    this.registerDomEvent(this.contentEl, 'keydown', event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const widget = (event.target as HTMLElement).closest<HTMLElement>('.tod-widget.is-controls-open');
      if (!widget) return;
      event.preventDefault(); event.stopPropagation();
      const current = this.widgets.get(widget.dataset.widget!);
      if (current) { this.closeItemControls(current); current.toolsToggle.focus({ preventScroll: true }); }
    });

    this.deskItems = this.addChild(new DeskItemsView(this.plugin, this.widgetsEl, {
      host: id => this.widgets.get(itemWidgetId(id))?.body,
      add: this.addDeskButton,
      grid: this.widgetGrid,
      beginMove: () => this.controlTooltips.hide(),
    }));
    for (const id of this.plugin.settings.widgetOrder) this.mountWidget(id);
    this.recentsEl = this.widgets.get('recents')!.body.createDiv('tod-recents');
    this.recentsEl.addEventListener('keydown', event => navigateList(event, this.recentsEl, '.tod-recent-link'));
    this.recentsSignature = null;
    this.dailyUnsubscribe = this.plugin.daily.subscribe(() => this.renderDaily());
    this.update();
    if (isEnabledWidget(this.plugin.settings, 'daily')) void this.plugin.daily.sync();
  }

  private createQuickActions(): void {
    const app = this.app as unknown as {
      commands: { commands: Record<string, unknown>; executeCommandById(id: string, event?: MouseEvent): boolean };
      hotkeyManager: { printHotkeyForCommand(id: string): string };
    };
    const row = this.shell.createEl('nav', { cls: 'tod-quick-actions', attr: { 'aria-label': 'Desk actions' } });
    const actions = [
      ['file-explorer:new-file', 'New note', 'square-pen'],
      ['bases:new-file', 'New Base', SOURCE_TYPES.base.icon],
      ['canvas:new-file', 'New canvas', SOURCE_TYPES.canvas.icon],
      ['switcher:open', 'Find file', 'search'],
      ['webviewer:open', 'Open Web viewer', SOURCE_TYPES.web.icon]
    ];
    for (const [id, label, icon] of actions) {
      const button = row.createEl('button', { cls: 'tod-quick-action', attr: { type: 'button' } });
      setIcon(button.createSpan({ attr: { 'aria-hidden': 'true' } }), icon);
      button.createSpan({ text: label });
      this.quickActions.set(id, { button, label });
      button.onclick = event => {
        this.app.workspace.setActiveLeaf(this.leaf, { focus: true });
        app.commands.executeCommandById(id, event);
      };
    }
    this.addDeskButton = row.createEl('button', { cls: 'tod-quick-action tod-add-to-desk',
      attr: { type: 'button', 'aria-label': COPY.addToDesk, 'aria-haspopup': 'dialog' } });
    setIcon(this.addDeskButton.createSpan({ attr: { 'aria-hidden': 'true' } }), 'plus');
    this.addDeskButton.createSpan({ text: COPY.addToDesk });
    updateTooltip(this.addDeskButton, COPY.addToDesk);
    this.addDeskButton.onclick = () => this.openAddPicker();
    this.refreshQuickActions();
  }

  private refreshQuickActions(): void {
    const app = this.app as unknown as {
      commands: { commands: Record<string, unknown> };
      hotkeyManager: { printHotkeyForCommand(id: string): string };
    };
    for (const [id, { button, label }] of this.quickActions) {
      const available = !!app.commands.commands[id];
      if (!available && button === button.ownerDocument.activeElement) this.addDeskButton.focus({ preventScroll: true });
      button.hidden = !available;
      if (available) {
        const shortcut = app.hotkeyManager.printHotkeyForCommand(id);
        updateTooltip(button, shortcut ? `${label} · ${shortcut}` : label);
      }
    }
  }

  focusControls(): void {
    const first = [...this.widgets.values()].find(widget => !widget.el.hidden);
    (first?.el || this.addDeskButton).focus({ preventScroll: true });
  }

  private editPageTitle(): void {
    if (this.closed || this.editingTitle) return;
    this.pageHeader.hidden = false;
    const height = this.pageTitle.getBoundingClientRect().height || 30;
    this.pageTitle.style.setProperty('--tod-title-height', `${height}px`);
    this.editingTitle = true; this.headingEdited = false;
    this.pageTitle.addClass('is-editing'); this.pageTitle.contentEditable = 'plaintext-only';
    this.pageTitle.setAttribute('role', 'textbox');
    this.pageTitle.setAttribute('aria-multiline', 'false');
    this.pageTitle.setAttribute('aria-placeholder', 'Add a title');
    updateTooltip(this.pageTitle, COPY.rename);
    this.pageTitle.setAttribute('aria-label', 'Desk title');
    this.pageTitle.setAttribute('aria-description', 'Leave blank to hide the title.');
    this.pageTitle.focus({ preventScroll: true });
  }

  private finishTitleEdit(save: boolean): void {
    if (!this.editingTitle) return;
    this.editingTitle = false;
    this.pageTitle.removeClass('is-editing'); this.pageTitle.removeAttribute('contenteditable');
    this.pageTitle.removeAttribute('aria-multiline'); this.pageTitle.removeAttribute('aria-placeholder');
    this.pageTitle.style.removeProperty('--tod-title-height');
    if (save && this.headingEdited) {
      const heading = (this.pageTitle.textContent || '').replace(/[\r\n\t]/g, ' ').replace(/[\x00-\x1f]/g, '').trim().slice(0, 100);
      if (heading !== this.plugin.settings.pageTitle) {
        this.plugin.settings.pageTitle = heading;
        this.plugin.changed({ widgets: [], content: false, pageHeading: true });
      }
    }
    this.renderPageHeading();
    if (!this.closed && this.pageHeader.hidden) this.addDeskButton.focus({ preventScroll: true });
  }

  private renderPageHeading(): void {
    if (this.editingTitle) return;
    updateText(this.pageTitle, this.plugin.settings.pageTitle);
    this.pageTitle.toggleClass('is-empty', !this.plugin.settings.pageTitle);
    this.pageHeader.hidden = !this.plugin.settings.pageTitle.trim();
    this.pageTitle.tabIndex = 0; this.pageTitle.setAttribute('role', 'button');
    updateTooltip(this.pageTitle, COPY.rename);
    this.pageTitle.removeAttribute('aria-label');
    this.pageTitle.removeAttribute('aria-description');
  }

  private closeItemControls(widget: DeskWidget): void {
    widget.el.removeClass('is-controls-open'); widget.toolsToggle.setAttribute('aria-expanded', 'false');
  }

  private openAddPicker(): void {
    if (this.closed || this.addDeskDialog) return;
    const dialog = new AddDeskModal(this.plugin, (restoreTitle, handledFocus) => {
      if (this.addDeskDialog === dialog) this.addDeskDialog = null;
      if (this.closed || handledFocus) return;
      if (restoreTitle) {
        this.editPageTitle();
        this.pageHeader.hidden = false;
        this.pageTitle.scrollIntoView({ block: 'nearest' });
        this.pageTitle.focus({ preventScroll: true });
      } else if (this.addDeskButton.isConnected) this.addDeskButton.focus({ preventScroll: true });
    });
    this.addDeskDialog = dialog;
    dialog.open();
  }

  putAwayWidget(id: string, origin?: UndoOrigin): void {
    const cards = Array.from(this.widgetsEl.querySelectorAll<HTMLElement>(':scope > .tod-widget:not([hidden])'));
    const index = cards.findIndex(card => card.dataset.widget === id);
    const next = cards[index + 1] ?? cards[index - 1];
    this.widgetGrid.cancelDrag();
    this.plugin.removeWidget(id, origin);
    const focus = next || this.addDeskButton;
    focus.focus({ preventScroll: true });
  }

  private mountWidget(id: string): void {
    const config = this.plugin.settings.widgets[id];
    const widget = this.createWidget(id);
    this.widgets.set(id, widget);
    if (config.type === 'base') widget.source = this.addChild(new BaseWidget(this.plugin, id, widget.body,
      (host, path) => this.deskItems.bindBaseLinks(host, path)));
    if (isCompactSourceType(config.type) || config.type === 'image') widget.source = this.addChild(new SourceCardWidget(this.plugin, id, widget.body));
    if (config.type === 'folder' && !isCoverWidget(config)) widget.source = this.addChild(new FolderWidget(this.plugin, id, widget.body,
      (row, link, path) => this.deskItems.bindSourceFile(row, link, path),
      (row, link, path) => this.deskItems.bindSourceFolder(row, link, path)));
  }

  dismissPreviews(): void { this.deskItems.dismiss(); }

  get gridColumns(): GridColumns { return this.widgetGrid.columns; }

  revealWidget(id: string, scroll = true): void {
    const widget = this.widgets.get(id);
    if (!widget || widget.el.hidden) return;
    if (scroll) widget.el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    widget.el.focus({ preventScroll: true });
  }

  private openWidgetSource(id: string, event?: MouseEvent | KeyboardEvent): void {
    const config = this.plugin.settings.widgets[id];
    if (!config) return;
    if (config.type === 'web') {
      if (config.path) void this.plugin.webHistory.open(config.path, event); else this.plugin.configureWidget(id);
    } else if (isFileWidgetType(config.type)) {
      if (config.path) void this.plugin.openPath(config.path, event);
      else this.plugin.configureWidget(id);
    } else if (config.type === 'folder') void this.plugin.revealFolder(config.path);
    else if (config.type === 'daily') void this.plugin.daily.open();
    else if (config.type === 'scratchpad') void this.plugin.openScratchpad();
  }

  private createOpenSourceButton(parent: HTMLElement, id: string, label: string): HTMLButtonElement {
    const button = iconButton(parent, 'arrow-up-right', label, event => this.openWidgetSource(id, event));
    button.addClass('tod-open-source');
    button.type = 'button';
    button.onauxclick = event => {
      const type = this.plugin.settings.widgets[id]?.type;
      if (event.button === 1 && type && isSourceWidgetType(type)) {
        event.preventDefault(); this.openWidgetSource(id, event);
      }
    };
    return button;
  }

  private createWidget(id: string): DeskWidget {
    const config = this.plugin.settings.widgets[id], key = config.type;
    const sourceCard = isCompactSourceType(key) || key === 'image';
    const el = this.widgetsEl.createEl('section', { cls: `tod-widget tod-widget-${key}${isCoverWidget(config) ? ' tod-widget-cover' : ''}`, attr: { 'data-widget': id, 'aria-label': widgetName(config), tabindex: '0' } });
    el.toggleClass('tod-widget-compact', isCompactSourceType(key));
    el.toggleClass('tod-widget-source-card', sourceCard);
    const controls = el.createDiv({ cls: 'tod-widget-controls tod-pill tod-pill-actions', attr: { role: 'group', 'aria-label': COPY.actions } });
    controls.id = `tod-controls-${crypto.randomUUID()}`;
    const actions = this.createItemControls(id, controls);
    const toolsToggle = iconButton(el, DESK_ACTION_ICONS.more, COPY.actions, () => {
      const opening = !el.hasClass('is-controls-open');
      for (const other of this.widgets.values()) this.closeItemControls(other);
      el.toggleClass('is-controls-open', opening); toolsToggle.setAttribute('aria-expanded', String(opening));
    });
    toolsToggle.addClass('tod-item-tools-toggle'); toolsToggle.type = 'button';
    toolsToggle.setAttribute('aria-expanded', 'false'); toolsToggle.setAttribute('aria-controls', controls.id);
    const header = el.createDiv('tod-section-heading tod-drag-handle');
    header.dataset.widgetDrag = ''; header.draggable = false;
    setIcon(header.createSpan({ cls: 'tod-widget-symbol', attr: { 'aria-hidden': 'true' } }), WIDGET_ICONS[key]);
    const h2 = header.createEl('h2');
    let title = h2 as HTMLElement;
    let titleButton: HTMLButtonElement | undefined;
    if (isSourceWidgetType(key) || ['scratchpad', 'daily'].includes(key)) {
      h2.addClass('tod-linked-heading');
      titleButton = h2.createEl('button', { cls: 'tod-widget-title' });
      if (key === 'daily') {
        title = this.dailyDate = titleButton.createEl('time', { cls: 'tod-daily-date' });
      } else title = titleButton.createSpan({ text: WIDGET_NAMES[key] });
      if (!sourceCard) setIcon(titleButton.createSpan({ cls: 'tod-open-icon', attr: { 'aria-hidden': 'true' } }), 'arrow-up-right');
      titleButton.onclick = event => this.openWidgetSource(id, event);
      if (sourceCard) titleButton.onauxclick = event => {
        if (event.button === 1) { event.preventDefault(); this.openWidgetSource(id, event); }
      };
      setTooltip(titleButton, openSourceLabel(key));
      titleButton.removeAttribute('aria-label');
    } else title.setText(widgetName(config));

    // Keep the source action outside renderers' scrolling/replaced content.
    const sourceFrame = isSourceWidgetType(key) || key === 'folder' && !isCoverWidget(config) ? el.createDiv('tod-source-frame') : null;
    const body = (sourceFrame || el).createDiv('tod-widget-body');
    const openButton = sourceFrame ? this.createOpenSourceButton(sourceFrame, id,
      openSourceLabel(key)) : undefined;
    const widget: DeskWidget = { kind: `${key}:${isCoverWidget(config)}`, el, heading: header, title, titleButton, openButton, toolsToggle, body,
      arrangement: { el: controls, controls: actions } };
    if (sourceCard) {
      const plainTarget = (event: MouseEvent) => !(event.target as HTMLElement).closest('button, a, input, select, textarea, audio, .tod-audio-player, .tod-widget-controls');
      el.onclick = event => { if (plainTarget(event)) this.openWidgetSource(id, event); };
      el.onauxclick = event => { if (event.button === 1 && plainTarget(event)) { event.preventDefault(); this.openWidgetSource(id, event); } };
      el.onkeydown = event => {
        if (event.target === el && !event.repeat && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault(); event.stopPropagation(); this.openWidgetSource(id, event);
        }
      };
    }
    if (key === 'widget-stack') widget.switcher = this.addChild(new WidgetStackSwitcher(this.plugin, id, el));
    return widget;
  }

  private createMoveButton(id: string, parent: HTMLElement): HTMLButtonElement {
    const grip = iconButton(parent, 'grip-vertical', COPY.move, () => {
      this.controlTooltips.hide();
      this.widgetGrid.togglePlacement(id, grip);
    });
    grip.type = 'button';
    grip.addClasses(['tod-widget-action', 'tod-widget-grip']); grip.draggable = false; grip.addClasses(['tod-drag-handle', 'tod-touch-drag-handle']); grip.dataset.widgetDrag = '';
    grip.setAttribute('aria-pressed', 'false');
    grip.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown');
    return grip;
  }

  private createSizeButton(id: string, parent: HTMLElement): HTMLButtonElement {
    const sizeButton = iconButton(parent, DESK_ACTION_ICONS.resize, COPY.resize, () => {
      const current = this.plugin.settings.widgets[id];
      if (!current?.enabled || isFixedSizeWidget(this.plugin.settings, id)) return;
      this.controlTooltips.hide();
      this.widgetGrid.cancelDrag();
      this.plugin.sizePicker.open(sizeButton, current, (size, origin) => this.plugin.setWidgetSize(id, size, this.widgetGrid.columns, origin), this.widgetGrid.columns);
    });
    sizeButton.type = 'button'; sizeButton.hidden = isFixedSizeWidget(this.plugin.settings, id);
    sizeButton.addClasses(['tod-widget-action', 'tod-widget-size']);
    sizeButton.setAttribute('aria-haspopup', 'dialog');
    sizeButton.setAttribute('aria-expanded', 'false');
    return sizeButton;
  }

  /** Every floating bar uses Move, Resize, Edit, then Add notes where available. */
  private createItemControls(id: string, controls: HTMLElement): WidgetControls {
    const config = this.plugin.settings.widgets[id];
    const gripButton = this.createMoveButton(id, controls);
    const sizeButton = this.createSizeButton(id, controls);
    const action = (icon: string, label: string, run: () => void) => {
      const button = iconButton(controls, icon, label, run);
      button.type = 'button'; button.addClass('tod-widget-action');
      return button;
    };
    const editButton = action(DESK_ACTION_ICONS.edit, COPY.edit, () => {
      this.controlTooltips.hide(); this.widgetGrid.cancelDrag(); this.plugin.sizePicker.close(); this.dismissPreviews();
      this.plugin.configureWidget(id, () => {
        if (!this.closed && this.plugin.settings.widgets[id]?.enabled) this.widgets.get(id)?.arrangement.controls.editButton.focus({ preventScroll: true });
      });
    });
    editButton.setAttribute('aria-haspopup', 'dialog');
    const stackButton = config.type === 'stack' ? action('plus', COPY.addNotes, () => this.plugin.pickStackNotes(config.itemId)) : undefined;
    return { gripButton, sizeButton, editButton, stackButton };
  }

  private createEditor(key: 'scratchpad' | 'daily', placeholder: string): NoteEditor {
    const body = this.widgets.get(key)!.body;
    const empty = key === 'daily' ? new WidgetEmptyState(body, '', {
      label: 'Create today’s note',
      run: () => {
        if (this.plugin.daily.available) void this.plugin.daily.ensure();
        else this.plugin.openSettings('core-plugins');
      },
    }) : undefined;
    if (empty) {
      empty.el.hidden = true;
      empty.el.addClass('tod-daily-empty');
      empty.button.empty();
      this.dailyCreateIcon = empty.button.createSpan({ cls: 'tod-daily-create-icon', attr: { 'aria-hidden': 'true' } });
      this.dailyCreateLabel = empty.button.createSpan();
    }
    const activityOwner = {};
    let selectionButton: HTMLButtonElement | undefined;
    const input = this.addChild(new WidgetMarkdownEditor(this.app, body, WIDGET_NAMES[key], placeholder,
      (text, update) => {
        this.plugin.activity.capture(activityOwner, update.startState.doc, update.state.doc);
        this.plugin.recordWork(key === 'daily' ? this.plugin.daily.path : this.plugin.settings.scratchPath);
        if (key === 'daily') this.plugin.daily.store?.editBody(text);
        else this.plugin.scratch.editBody(text);
      },
      () => { this.plugin.activity.flush(activityOwner); void (key === 'daily' ? this.plugin.daily.flush() : this.plugin.scratch.flush()); },
      selected => { if (selectionButton) selectionButton.hidden = !selected; }
    ));
    input.register(() => this.plugin.activity.flush(activityOwner));
    const openButton = this.createOpenSourceButton(input.el, key, COPY.open);
    if (key === 'scratchpad') {
      selectionButton = input.el.createEl('button', { cls: 'tod-scratch-selection', text: 'Create note', attr: { type: 'button', 'aria-label': 'Create note from selection' } });
      selectionButton.hidden = true; updateTooltip(selectionButton, 'Create note from selection');
      selectionButton.onmousedown = event => event.preventDefault();
      selectionButton.onclick = () => {
        const text = input.selectedText();
        if (text.trim()) new ScratchSelectionModal(this.plugin, text, this.plugin.settings.scratchPath, () => input.focus()).open();
      };
    }
    const status = body.createDiv({ cls: 'tod-note-status', attr: { role: 'status', 'aria-live': 'polite' } });
    const actions = body.createDiv('tod-note-actions');
    return { input, openButton, status, actions, empty };
  }

  private releaseEditor(key: 'scratchpad' | 'daily'): void {
    const editor = key === 'scratchpad' ? this.scratchEditor : this.dailyEditor;
    if (key === 'scratchpad') {
      this.scratchEditor = null;
      this.scratchUnsubscribe?.(); this.scratchUnsubscribe = null; this.currentScratch = null;
    } else {
      this.dailyEditor = null; this.dailyCreateLabel = null; this.dailyCreateIcon = null;
    }
    if (!editor) return;
    this.removeChild(editor.input);
    editor.status.remove(); editor.actions.remove(); editor.empty?.el.remove();
  }

  update(change?: DeskUpdate): void {
    if (!this.shell || this.closed) return;
    this.refreshQuickActions();
    const settings = this.plugin.settings;
    const owners = widgetStackOwners(settings);
    const requested = change ? new Set(change.widgets) : null;
    if (requested) {
      for (const id of change!.widgets) for (const member of settings.widgets[id]?.members || []) requested.add(member);
      for (const id of [...requested]) { const owner = owners.get(id); if (owner) requested.add(owner); }
    }
    const content = change?.content !== false;
    if (!change || change.pageHeading) this.renderPageHeading();
    if (!change || change.layout) {
      for (const [id, widget] of this.widgets) {
        const current = settings.widgets[id];
        if (current && widget.kind === `${current.type}:${isCoverWidget(current)}`) continue;
        this.plugin.sizePicker.closeWithin(widget.el);
        if (widget.source) this.removeChild(widget.source);
        if (widget.activity) this.removeChild(widget.activity);
        if (widget.switcher) this.removeChild(widget.switcher);
        widget.el.remove(); this.widgets.delete(id);
      }
      for (const id of settings.widgetOrder) if (!this.widgets.has(id)) this.mountWidget(id);
    }
    // Reparent only when membership changes; switching keeps editors and scroll positions intact.
    if (!change || change.layout) for (const [id, widget] of this.widgets) {
      const owner = owners.get(id);
      const parent = owner ? this.widgets.get(owner)?.body : this.widgetsEl;
      if (parent && widget.el.parentElement !== parent) parent.appendChild(widget.el);
      widget.el.toggleClass('is-stack-member', !!owner);
    }
    for (const id of !change || change.layout ? settings.widgetOrder : requested || settings.widgetOrder) {
      const widget = this.widgets.get(id), config = settings.widgets[id];
      if (!widget || !config) continue;
      const visible = isVisibleWidget(settings, id, owners);
      widget.el.hidden = !visible;
      widget.switcher?.render();
      widget.heading.hidden = config.type === 'widget-stack' || isCoverWidget(config) || config.showHeading === false;
      // Covers own their heading inside the body; the same preference hides that whole row.
      widget.el.toggleClass('is-heading-hidden', config.showHeading === false);
      if (isCoverWidget(config) && config.showHeading === false) {
        widget.el.setAttribute('aria-description', config.type === 'note'
          ? 'Press Enter or Space to preview this note.' : 'Press Enter or Space to browse this collection.');
        widget.el.setAttribute('aria-keyshortcuts', 'Enter Space');
      } else if (isCompactSourceType(config.type) || config.type === 'image') {
        widget.el.setAttribute('aria-description', `Press Enter or Space to open this ${SOURCE_TYPES[config.type].name.toLowerCase()}.`);
        widget.el.setAttribute('aria-keyshortcuts', 'Enter Space');
      } else {
        widget.el.removeAttribute('aria-description'); widget.el.removeAttribute('aria-keyshortcuts');
      }
      // Compact metadata can change without new content; its renderer preserves media.
      if (widget.source && visible && (content || widget.source instanceof SourceCardWidget)) widget.source.render(config);
      const owner = owners.get(id);
      if (!config.enabled || owner && !settings.widgets[owner]?.enabled) {
        this.plugin.sizePicker.closeWithin(widget.el);
        // Removed source previews must release their native watchers. Stack members
        // that are merely inactive stay mounted for seamless switching.
        if (widget.source instanceof BaseWidget || widget.source instanceof SourceCardWidget) widget.source.render({ ...config, enabled: false });
        if (config.type === 'scratchpad' || config.type === 'daily') this.releaseEditor(config.type);
        if (widget.activity) { this.removeChild(widget.activity); widget.activity = undefined; }
      } else if (config.type === 'activity' && visible && !widget.activity) {
        widget.activity = this.addChild(new WritingHeatmap(this.plugin.activity, widget.body, () => this.plugin.daily.dateFormat));
      }
      widget.el.dataset.columns = String(config.columns);
      widget.el.dataset.rows = String(config.rows);
      const name = widgetName(config);
      widget.el.setAttribute('aria-label', name);
      updateTooltip(widget.toolsToggle, COPY.actions);
      widget.arrangement.el.setAttribute('aria-label', COPY.actions);
      const controls = widget.arrangement.controls;
      controls.sizeButton.hidden = isFixedSizeWidget(settings, id);
      updateTooltip(controls.sizeButton, COPY.resize);
      const appearanceConfig = config.type === 'widget-stack' ? settings.widgets[config.activeMember!] || config : config;
      // The active member's title also drags its parent stack.
      widget.el.toggleClass('has-drag-heading', appearanceConfig.type !== 'widget-stack' && appearanceConfig.showHeading !== false);
      controls.gripButton.setAttribute('aria-label', COPY.move);
      updateTooltip(controls.gripButton, COPY.move);
      updateTooltip(controls.editButton, COPY.edit);
      if (isSourceWidgetType(config.type) || config.type === 'folder') {
        updateText(widget.title, name); widget.el.setAttribute('aria-label', name);
        if (widget.titleButton) { updateTooltip(widget.titleButton, openSourceLabel(config.type)); widget.titleButton.removeAttribute('aria-label'); }
        if (widget.openButton) {
          const source = config.path === '/' ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(config.path);
          widget.openButton.hidden = config.type === 'web' ? !sourceWebUrl(config.path) : config.type === 'folder' ? !(source instanceof TFolder) : !(source instanceof TFile && matchesSourceFile(config.type, source.extension));
          updateTooltip(widget.openButton, openSourceLabel(config.type));
        }
        if (config.type === 'base') widget.body.toggleClass('tod-base-controls-hidden', config.showBaseControls === false);
      }
      if (content && visible) widget.activity?.refresh();
    }
    if (!change || change.layout) this.widgetGrid.render();
    if (change?.markers) this.deskItems.refreshMarkers();
    if (!content) { this.controlTooltips.refresh(); return; }
    if (!requested || change?.layout || requested.has('items')) this.deskItems.render();
    else {
      const items = new Set([...requested].flatMap(id => settings.widgets[id]?.itemId ? [settings.widgets[id].itemId!] : []));
      if (items.size) this.deskItems.render(false, items);
    }
    if (!requested || change?.layout || requested.has('recents')) this.renderRecents();
    if (!requested || change?.layout || requested.has('scratchpad')) this.bindScratch();
    if (!requested || change?.layout || requested.has('daily')) this.renderDaily();
    // Content reconciliation may detach the hovered control. Validate after it,
    // so a removed card cannot leave its tooltip floating over the next one.
    this.controlTooltips.refresh();
  }

  private renderRecents(): void {
    if (this.deskItems.isDragging || !isVisibleWidget(this.plugin.settings, 'recents')) return;
    const local = this.plugin.recents.entries.flatMap(entry => {
      const source = entry.kind === 'folder' ? entry.path === '/' ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(entry.path) : this.app.vault.getFileByPath(entry.path);
      const sourceKind: SourceType | null = entry.kind === 'folder' && source instanceof TFolder ? 'folder' : source instanceof TFile ? fileSourceType(source.extension) : null;
      if (!source || !sourceKind) return [];
      return [{ ...entry, sourceKind, name: source.path === '/' ? 'Vault' : source instanceof TFile ? source.basename : source.name, icon: SOURCE_TYPES[sourceKind].icon }];
    });
    const groupAt = recentWindow();
    const entries = [...local, ...this.plugin.webHistory.entries].flatMap(entry => {
      const group = groupAt(entry.openedAt);
      return group ? [{ entry, group }] : [];
    }).sort((a, b) => (b.entry.openedAt ?? 0) - (a.entry.openedAt ?? 0)).slice(0, 100);
    const signature = JSON.stringify(entries);
    if (signature === this.recentsSignature) return;
    this.recentsSignature = signature;
    const names = new Map<string, number>();
    for (const { entry } of entries) { if (entry.kind === 'web') continue; names.set(entry.name, (names.get(entry.name) || 0) + 1); }
    const active = this.recentsEl.ownerDocument.activeElement as HTMLElement | null;
    const focused = active && this.recentsEl.contains(active) ? active : null;
    const focusKey = focused?.dataset.focusKey;
    const scroll = this.recentsEl.scrollTop;
    const existing = new Map(Array.from(this.recentsEl.querySelectorAll<HTMLElement>(':scope > .tod-recent')).map(row => [row.dataset.recentKey!, row] as const));
    const headings = new Map(Array.from(this.recentsEl.querySelectorAll<HTMLElement>(':scope > .tod-recents-date')).map(row => [row.dataset.day!, row] as const));
    this.recentsEl.toggleClass('is-empty', !entries.length);
    if (!entries.length) {
      this.recentsEl.removeAttribute('role'); this.recentsEl.empty(); new WidgetEmptyState(this.recentsEl, COPY.emptyRecents);
      if (focused) this.widgets.get('recents')?.el.focus({ preventScroll: true }); return;
    }
    this.recentsEl.setAttribute('role', 'list');
    const rows: HTMLElement[] = [];
    let lastGroup = '';
    for (const { entry, group } of entries) {
      if (lastGroup !== group.key) {
        const heading = headings.get(group.key) || this.recentsEl.createDiv({ cls: 'tod-recents-date', attr: { 'data-day': group.key, role: 'presentation' } });
        updateText(heading, group.label); rows.push(heading); lastGroup = group.key;
      }
      if (entry.kind === 'web') {
        const key = `web:${entry.url}`, label = webPageLabel(entry);
        let row = existing.get(key);
        if (!row) {
          row = this.recentsEl.createDiv({ cls: 'tod-recent tod-recent-web', attr: { role: 'listitem', 'data-recent-key': key } });
          const button = row.createEl('button', { cls: 'tod-recent-link', attr: { 'data-focus-key': `recent:${key}` } });
          setIcon(button.createSpan({ cls: 'tod-recent-file-icon', attr: { 'aria-hidden': 'true' } }), 'globe-2');
          button.createSpan({ cls: 'tod-recent-title' });
          button.createSpan({ cls: 'tod-recent-domain', attr: { 'aria-hidden': 'true' } });
          button.onclick = event => { void this.plugin.webHistory.open(entry.url, event); };
          button.addEventListener('auxclick', event => {
            if (event.button === 1) { event.preventDefault(); void this.plugin.webHistory.open(entry.url, event); }
          });
          this.deskItems.bindSourceWidget(row, button, { kind: 'web', path: entry.url, title: label.title });
        }
        const button = row.querySelector<HTMLButtonElement>('.tod-recent-link')!;
        updateText(button.querySelector<HTMLElement>('.tod-recent-title')!, label.title);
        const domain = button.querySelector<HTMLElement>('.tod-recent-domain')!;
        const site = sourceWebSite(entry.url, label.title);
        updateText(domain, site); domain.hidden = !site;
        updateTooltip(button, entry.url);
        button.setAttribute('aria-label', `${label.title}, ${label.domain}`);
        this.deskItems.updateSourceTitle(row, label.title);
        rows.push(row); continue;
      }
      const { path } = entry, source = path === '/' ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(path)!, key = `${entry.kind}:${path}`;
      const ambiguous = (names.get(entry.name) || 0) > 1;
      const rowKey = JSON.stringify([ambiguous, entry.name, entry.sourceKind, entry.icon]);
      let row = existing.get(key);
      if (!row || row.dataset.state !== rowKey) {
        row = this.recentsEl.createDiv({ cls: 'tod-recent', attr: { role: 'listitem', 'data-path': path, 'data-recent-key': key, 'data-state': rowKey } });
        const button = row.createEl('button', { cls: 'tod-recent-link', attr: { 'aria-label': `Open ${entry.name}, ${SOURCE_TYPES[entry.sourceKind].name}${ambiguous ? ', ' + source.parent?.path : ''}`, 'data-focus-key': `recent:${path}` } });
        setTooltip(button, `${SOURCE_TYPES[entry.sourceKind].name} · ${path}`);
        const symbol = button.createSpan({ cls: 'tod-recent-file-icon', attr: { 'aria-hidden': 'true' } });
        setIcon(symbol, entry.icon);
        if (!symbol.firstElementChild) setIcon(symbol, 'file');
        const identity = button.createSpan('tod-list-identity'); identity.createSpan({ text: entry.name, cls: 'tod-recent-title' });
        if (ambiguous) identity.createSpan({ text: `${SOURCE_TYPES[entry.sourceKind].name} · ${source.parent?.path === '/' ? 'Vault' : source.parent?.path || 'Vault'}`, cls: 'tod-source-path' });
        button.onclick = event => { if (entry.kind === 'folder') void this.plugin.revealFolder(path); else void this.plugin.openPath(path, event); };
        button.addEventListener('auxclick', event => {
          const current = this.app.vault.getFileByPath(path);
          if (event.button === 1 && current) { event.preventDefault(); void this.plugin.openPath(path, event); }
        });
        if (entry.sourceKind === 'note') this.deskItems.bindSourceNote(row, button, path, { showLastWorked: false });
        else if (entry.sourceKind === 'folder') this.deskItems.bindSourceFolder(row, button, path, { showLastWorked: false });
        else this.deskItems.bindSourceWidget(row, button, { kind: entry.sourceKind, path });
      }
      rows.push(row);
    }
    reconcileChildren(this.recentsEl, rows);
    if (focusKey && !focused?.isConnected) {
      const restored = Array.from(this.recentsEl.querySelectorAll<HTMLButtonElement>('button')).find(button => button.dataset.focusKey === focusKey);
      (restored || this.recentsEl.querySelector<HTMLButtonElement>('button'))?.focus({ preventScroll: true });
    }
    this.recentsEl.scrollTop = scroll;
  }

  private bindScratch(): void {
    if (this.closed || !isVisibleWidget(this.plugin.settings, 'scratchpad')) return;
    if (this.currentScratch !== this.plugin.scratch) {
      this.scratchUnsubscribe?.(); this.currentScratch = this.plugin.scratch;
      this.scratchUnsubscribe = this.plugin.scratch.subscribe(() => this.renderScratch());
    }
    this.renderScratch();
  }
  private renderScratch(): void {
    if (this.closed || !isVisibleWidget(this.plugin.settings, 'scratchpad')) return;
    const store = this.plugin.scratch, editor = this.scratchEditor ??= this.createEditor('scratchpad', 'Write a thought or paste a link…');
    editor.input.sync(store.body, this.plugin.settings.scratchPath, !store.loaded);
    updateText(editor.status, store.error || (store.conflict ? DRAFT_COPY.conflict : !store.loaded ? DRAFT_COPY.opening : store.dirty ? DRAFT_COPY.saving : ''));
    editor.status.toggleClass('has-error', store.conflict || !!store.error);
    if (store.conflict) {
      this.editorAction(editor, DRAFT_COPY.saveAsNewNote, () => { void this.plugin.saveScratchCopy(); });
    } else if (store.error && store.loaded) {
      this.editorAction(editor, DRAFT_COPY.retry, () => { void this.plugin.scratch.flush(); });
    } else if (store.error) {
      this.editorAction(editor, DRAFT_COPY.retry, () => this.plugin.retryScratchLoad());
    } else this.editorAction(editor);
    const title = this.widgets.get('scratchpad')!.titleButton!;
    updateTooltip(title, COPY.open); title.removeAttribute('aria-label');
  }
  private editorAction(editor: NoteEditor, label = '', run?: () => void): void {
    if (editor.actions.dataset.action !== label) {
      editor.actions.dataset.action = label; editor.actions.empty();
      if (run) editor.actions.createEl('button', { text: label, attr: { type: 'button' } });
    }
    // The same retry label can recover either reading or saving; keep its action current.
    const button = editor.actions.firstElementChild as HTMLButtonElement | null;
    if (button) button.onclick = run ?? null;
  }
  private renderDaily(): void {
    if (this.closed || !isVisibleWidget(this.plugin.settings, 'daily')) return;
    const daily = this.plugin.daily, store = daily.store, editor = this.dailyEditor ??= this.createEditor('daily', 'Write in today’s note…');
    if (this.dailyDate) {
      const dateLabel = daily.displayName;
      if (daily.displayDateTime) this.dailyDate.dateTime = daily.displayDateTime;
      else this.dailyDate.removeAttribute('datetime');
      updateText(this.dailyDate, dateLabel);
      this.dailyDate.setAttribute('aria-label', dateLabel);
      const openLabel = openSourceLabel('daily');
      updateTooltip(this.widgets.get('daily')!.titleButton!, openLabel);
      this.widgets.get('daily')!.titleButton!.removeAttribute('aria-label');
      editor.openButton.setAttribute('aria-label', openLabel); updateTooltip(editor.openButton, openLabel);
    }
    const empty = editor.empty!;
    empty.el.hidden = !!store;
    editor.input.el.hidden = !store;
    if (!store) {
      this.editorAction(editor);
      editor.input.sync('', daily.path, true);
      empty.message.hidden = daily.available;
      updateText(empty.message, daily.available ? '' : 'Turn on Daily notes to write here.');
      if (this.dailyCreateLabel) updateText(this.dailyCreateLabel, daily.available ? (daily.busy ? 'Creating…' : 'Create today’s note') : 'Open settings');
      const icon = daily.available ? 'plus' : 'settings-2';
      if (this.dailyCreateIcon && this.dailyCreateIcon.dataset.icon !== icon) {
        setIcon(this.dailyCreateIcon, icon); this.dailyCreateIcon.dataset.icon = icon;
      }
      empty.button.disabled = daily.busy;
      empty.el.setAttribute('aria-busy', String(daily.busy));
      const error = daily.error === COPY.enableDailyNotes ? '' : daily.error;
      updateText(editor.status, error);
      editor.status.toggleClass('has-error', !!error);
    } else {
      editor.input.sync(store.body, daily.path, !store.loaded);
      updateText(editor.status, store.error || (store.conflict ? DRAFT_COPY.conflict : daily.error || (!store.loaded ? DRAFT_COPY.opening : store.dirty ? DRAFT_COPY.saving : '')));
      editor.status.toggleClass('has-error', store.conflict || !!store.error || !!daily.error);
      if (store.conflict || (daily.error && store.dirty)) {
        this.editorAction(editor, DRAFT_COPY.saveAsNewNote, () => { void daily.saveCopy(); });
      } else if (store.error) {
        this.editorAction(editor, DRAFT_COPY.retry, () => { void daily.retry(); });
      } else this.editorAction(editor);
    }
  }
  async onClose(): Promise<void> {
    this.closed = true;
    this.finishTitleEdit(true); this.addDeskDialog?.close(); this.addDeskDialog = null;
    if (this.controlTooltips) this.removeChild(this.controlTooltips);
    if (this.widgetGrid) this.removeChild(this.widgetGrid);
    if (this.deskItems) this.removeChild(this.deskItems);
    this.dailyUnsubscribe?.(); this.dailyUnsubscribe = null;
    this.plugin.sizePicker.closeWithin(this.contentEl);
    this.releaseEditor('scratchpad'); this.releaseEditor('daily');
    for (const widget of this.widgets.values()) {
      if (widget.source) this.removeChild(widget.source);
      if (widget.activity) this.removeChild(widget.activity);
      if (widget.switcher) this.removeChild(widget.switcher);
    }
    await Promise.all([this.plugin.scratch.flush(), this.plugin.daily.flush()]);
    this.dailyDate = null; this.dailyCreateLabel = null; this.dailyCreateIcon = null;
    this.widgets.clear(); this.quickActions.clear(); this.contentEl.empty();
  }
}

class DeskSettingTab extends PluginSettingTab {
  constructor(private desk: DeskPlugin) {
    super(desk.app, desk);
    this.icon = 'panels-top-left';
  }
  display(): void { renderSettings(this.containerEl, this.desk); }
}

function renderSettings(container: HTMLElement, plugin: DeskPlugin): void {
  container.empty();
  // Let Obsidian and the user's theme own the settings layout and controls.
  container.removeClass('tod-settings');
  container.addClass('tod-settings-page');

  new SettingGroup(container).setHeading('Open desk')
    .addSetting(setting => setting.setName('On startup')
      .addToggle(toggle => toggle.setValue(plugin.settings.openOnStartup).onChange(value => {
        plugin.settings.openOnStartup = value; plugin.changed({ widgets: [], content: false });
      })))
    .addSetting(setting => setting.setName('In new tabs')
      .addToggle(toggle => toggle.setValue(plugin.settings.openOnNewTab).onChange(value => {
        plugin.settings.openOnNewTab = value; plugin.changed({ widgets: [], content: false }); plugin.scheduleNewTabHome();
      })));

  new SettingGroup(container).setHeading('Scratchpad')
    .addSetting(setting => setting.setName('Note path')
      .setDesc('Created if needed when you write or open it.')
      .addText(text => {
        text.setValue(plugin.settings.scratchPath).setPlaceholder('Desk/Scratchpad.md');
        text.inputEl.addEventListener('change', () => {
          const path = normalizePath(text.getValue().trim());
          if (path === plugin.settings.scratchPath) return;
          text.setDisabled(true);
          void plugin.setScratchPath(path).catch(() => {
            new Notice('Couldn’t change the scratchpad note. The current note is still selected.');
          }).finally(() => {
            text.setValue(plugin.settings.scratchPath).setDisabled(false);
          });
        });
        text.inputEl.addEventListener('keydown', event => {
          if (event.key === 'Enter') { event.preventDefault(); text.inputEl.blur(); }
        });
      }));

  new SettingGroup(container).setHeading('Daily notes')
    .addSetting(setting => setting.setName(plugin.daily.available ? 'Settings' : 'Core plugins')
      .setDesc(plugin.daily.available ? 'Uses Obsidian’s folder, date format, and template.' : COPY.enableDailyNotes)
      .addButton(button => button.setButtonText(COPY.open).onClick(() => plugin.openSettings(plugin.daily.available ? 'daily-notes' : 'core-plugins'))));
}

