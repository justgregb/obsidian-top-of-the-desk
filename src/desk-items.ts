import { DeskSource, sourceWidgetId, type WidgetGrid } from './widget-layout';
import { fileSourceType, sourceWebName } from './source-types';
import { COPY, openSourceLabel, formatCount } from './copy';
import { Component, Notice, TFile, TFolder, parseLinktext, setIcon, setTooltip } from 'obsidian';
import { deskSourcesForDrag, type NativeDraggable } from './native-source-drag';
import type DeskPlugin from './main';
import { itemWidgetId, widgetStackFor, widgetStackOwners, isCoverWidget, isVisibleWidget, DeskFolder, DeskItem, DeskStack, collectionCountVisibility, deskPaths, itemPaths } from './model';
import { StackPopover } from './stack-popover';
import { PointerDrag } from './pointer-drag';
import { CoverLayout } from './cover-layout';
import { FolderPopover } from './folder-popover';
import { NotePopover } from './note-popover';
import { compareNames, updateBounds, updateText, updateTooltip } from './ui';
import { createCardMetadata } from './card-metadata';
import { UndoOrigin, undoOrigin } from './undo-notice';
import { DESK_ACTION_ICONS, setCollectionIcon } from './collection-icons';

interface DeskItemHosts { host(id: string): HTMLElement | undefined; add: HTMLButtonElement; grid: WidgetGrid; beginMove(): void; }

type Drag = DeskSource & { external?: boolean };
type Drop = { id: string; path: string; after: boolean };
type DropTarget = { intent: Drop; surface: HTMLElement };

/** The desk keeps references; grouping and dragging never move a vault file. */
export class DeskItemsView extends Component {
  private grid: HTMLElement;
  private sourceBindings = new WeakMap<HTMLElement, DeskSource>();
  private coverLayout!: CoverLayout;
  private previewObserver!: IntersectionObserver;
  private previewTasks = new Map<HTMLElement, () => void>();
  private popup!: StackPopover;
  private folderPopup!: FolderPopover;
  private notePopup!: NotePopover;
  private pointer!: PointerDrag<Drag>;
  private insertionMarker: HTMLElement | null = null;
  private drag: Drag | null = null;
  private dragSource: HTMLElement | null = null;
  private stopped = false;
  private rendered = new Map<string, { signature: string; el: HTMLElement }>();
  private signature = '';
  private lastWorkedPath: string | null = null;
  private popoverPress: { key: string; close: boolean } | null = null;
  private clearNativeDrop: () => void = () => {};
  private nativeDragging = false;

  constructor(private plugin: DeskPlugin, private body: HTMLElement, private hosts: DeskItemHosts) {
    super();
    this.grid = body;
  }

  onload(): void {
    this.coverLayout = this.addChild(new CoverLayout(this.body));
    this.previewObserver = new this.body.ownerDocument.defaultView!.IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const root = entry.target as HTMLElement, load = this.previewTasks.get(root);
        this.previewTasks.delete(root); this.previewObserver.unobserve(root);
        if (!this.stopped && root.isConnected) load?.();
      }
    }, { root: this.body.closest('.tod-view'), rootMargin: '200px 0px' });
    this.pointer = this.addChild(new PointerDrag<Drag>({
      canStart: drag => this.plugin.validDeskSource(drag),
      label: drag => this.dragLabel(drag),
      begin: (drag, source) => {
        this.hosts.beginMove(); this.notePopup.close(false);
        this.drag = drag; this.dragSource = source; source.addClass('is-dragging');
        this.body.toggleClass('is-dragging-note', drag.kind === 'note');
        this.clearNativeDrop();
        this.hosts.grid.beginSourceMove(drag);
      },
      move: (_drag, x, y) => this.movePointer(x, y),
      drop: (_drag, x, y) => {
        const target = this.dropAt(x, y);
        const origin = { doc: this.body.ownerDocument, x, y, touch: this.body.ownerDocument.defaultView!.matchMedia('(pointer: coarse)').matches };
        if (target) { this.hosts.grid.finishSourceMove(); this.applyDrop(target.intent, origin); }
        else if (!this.overPopover(x, y)) this.hosts.grid.dropSourceMove(x, y, origin);
      },
      end: () => this.finishDrag()
    }));
    this.popup = this.addChild(new StackPopover(this.plugin, {
      anchor: id => this.itemAnchor(id),
      row: (parent, path) => this.popupNote(parent, path),
      closed: (id, restoreFocus) => {
        this.markOpenItems();
        if (restoreFocus && !this.focus(`toggle:${id}`)) {
          const card = this.itemAnchor(id);
          (card?.querySelector<HTMLButtonElement>('button:not(:disabled)') || this.body.closest<HTMLElement>('.tod-view'))?.focus({ preventScroll: true });
        }
      },
      dragging: () => !!this.drag,
      finishDrag: () => this.pointer.cancel()
    }));
    this.folderPopup = this.addChild(new FolderPopover(this.plugin, {
      note: (row, link, path) => this.bindSourceFile(row, link, path),
      folder: (row, link, path) => this.bindSourceFolder(row, link, path),
      dragging: () => !!this.drag,
      closed: (id, restoreFocus) => { this.markOpenItems(); if (restoreFocus) this.focus(`folder:${id}`); }
    }));
    this.notePopup = this.addChild(new NotePopover(this.plugin, (path, restoreFocus) => {
      this.markOpenItems();
      if (restoreFocus && !this.focus(`open:${path}`)) this.body.closest<HTMLElement>('.tod-view')?.focus({ preventScroll: true });
    }));
    // A hidden title must not remove keyboard access to its note or collection preview.
    this.registerDomEvent(this.body, 'keydown', event => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target as HTMLElement;
      if (!target.matches('.tod-widget-cover.is-heading-hidden')) return;
      const title = target.querySelector<HTMLButtonElement>('.tod-card-title');
      if (!title || title.disabled) return;
      event.preventDefault(); event.stopPropagation(); title.click();
    });
    this.bindNativeSourceDrops();
  }

  onunload(): void {
    this.pointer?.cancel();
    this.stopped = true; this.rendered.clear();
    this.previewObserver?.disconnect(); this.previewTasks.clear();
    this.popup?.close(false);
    this.folderPopup?.close(false);
    this.notePopup?.close(false);
    this.drag = null;
    this.insertionMarker?.remove(); this.insertionMarker = null;
    for (const item of this.grid.querySelectorAll('.tod-desk-item')) item.remove();
    this.clearNativeDrop();
  }

  dismiss(): void { this.popoverPress = null; this.pointer?.cancel(); this.clearNativeDrop(); this.popup?.close(false); this.folderPopup?.close(false); this.notePopup?.close(false); }
  get isDragging(): boolean { return !!this.drag || this.nativeDragging; }

  private folder(path: string): TFolder | null {
    const folder = path === '/' ? this.plugin.app.vault.getRoot() : this.plugin.app.vault.getAbstractFileByPath(path);
    return folder instanceof TFolder ? folder : null;
  }

  private folderName(path: string): string { return path === '/' ? 'Vault' : this.folder(path)?.name || path.split('/').pop() || 'Folder'; }
  private dragLabel(drag: Drag): string {
    return drag.kind === 'folder' ? this.folderName(drag.path) : drag.title || (drag.kind === 'web' ? sourceWebName(drag.path) : this.noteName(drag.path));
  }

  bindSourceFolder(row: HTMLElement, link: HTMLElement, path: string, options: { showLastWorked?: boolean } = {}): void {
    row.addClass('tod-source-note'); link.addClass('tod-source-link');
    if (options.showLastWorked !== false) this.markWorkedRow(row, path, true);
    const drag: Drag = { kind: 'folder', path };
    this.pointer.bind(link, drag, row);
    const grip = this.sourceAction(row, path, true);
    this.pointer.bind(grip, drag, row, true);
  }

  private bindNativeSourceDrops(): void {
    const surface = this.body.closest<HTMLElement>('.tod-view') || this.body, doc = surface.ownerDocument;
    const manager = (this.plugin.app as unknown as { dragManager?: {
      draggable?: NativeDraggable | null;
      setAction?(text: string): void;
    } }).dragManager;
    let pending: ReturnType<typeof deskSourcesForDrag> = null;
    let sourceKey = '', blocked = false;
    let point: { x: number; y: number } | null = null, frame = 0;
    const win = doc.defaultView!;
    this.clearNativeDrop = () => {
      if (frame) win.cancelAnimationFrame(frame);
      frame = 0; point = null; pending = null; sourceKey = ''; blocked = false;
      if (!this.nativeDragging) return;
      this.nativeDragging = false;
      this.hosts.grid.finishSourceMove();
      manager?.setAction?.('');
      if (!this.stopped) this.plugin.refreshSoon({ widgets: ['items', 'recents'] });
    };
    const prepare = (candidate: NonNullable<typeof pending>): boolean => {
      const key = JSON.stringify([candidate.unsupported, candidate.sources]);
      if (sourceKey !== key || !blocked && !this.hosts.grid.hasSourceMove) {
        this.clearNativeDrop(); this.pointer.cancel();
        this.hosts.beginMove(); this.popup.close(false); this.folderPopup.close(false); this.notePopup.close(false);
        sourceKey = key; this.nativeDragging = true;
        blocked = candidate.unsupported || !this.hosts.grid.beginSourceMove(candidate.sources);
      }
      pending = candidate;
      return !blocked && this.hosts.grid.hasSourceMove;
    };
    const showTarget = () => {
      if (point && !blocked && this.nativeDragging) this.hosts.grid.previewSourceMove(point.x, point.y, false, true);
    };
    const over = (event: DragEvent) => {
      const candidate = deskSourcesForDrag(this.plugin.app, manager?.draggable);
      if (!candidate) { this.clearNativeDrop(); return; }
      // Let the event reach Obsidian's drag manager to keep its ghost and edge scroll alive.
      // Native inner drop handlers honor defaultPrevented; the actual drop is captured below.
      event.preventDefault();
      const accepted = prepare(candidate);
      if (event.dataTransfer) event.dataTransfer.dropEffect = accepted ? 'copy' : 'none';
      manager?.setAction?.(candidate.unsupported ? 'This type is not supported on the desk' : accepted ? COPY.addToDesk : 'Cannot place this selection');
      point = { x: event.clientX, y: event.clientY };
      showTarget();
    };
    this.registerDomEvent(surface, 'dragenter', over, true);
    this.registerDomEvent(surface, 'dragover', over, true);
    this.registerDomEvent(surface, 'dragleave', event => {
      if (!surface.contains(event.relatedTarget as Node | null)) this.clearNativeDrop();
    });
    this.registerDomEvent(surface, 'drop', event => {
      const candidate = deskSourcesForDrag(this.plugin.app, manager?.draggable) || pending;
      if (!candidate) return;
      event.preventDefault(); event.stopImmediatePropagation();
      try {
        if (candidate.unsupported) { new Notice('Add a note, folder, Base, canvas, PDF, audio file, image or URL. Other types are not supported on the desk.'); return; }
        if (prepare(candidate)) this.hosts.grid.dropSourceMove(event.clientX, event.clientY, undoOrigin(event, surface));
      } finally {
        this.clearNativeDrop();
      }
    }, true);
    // Native auto-scroll and layout changes must not leave an outline at old coordinates.
    this.registerDomEvent(doc, 'scroll', () => {
      if (!point || frame) return;
      frame = win.requestAnimationFrame(() => { frame = 0; showTarget(); });
    }, true);
    this.registerDomEvent(doc, 'dragstart', () => this.clearNativeDrop(), true);
    this.registerDomEvent(doc, 'dragend', () => this.clearNativeDrop(), true);
    this.registerDomEvent(doc, 'drop', () => this.clearNativeDrop());
    this.registerDomEvent(doc, 'keydown', event => { if (event.key === 'Escape') this.clearNativeDrop(); }, true);
    this.registerDomEvent(win, 'blur', () => this.clearNativeDrop());
    this.registerDomEvent(win, 'resize', () => this.clearNativeDrop());
    this.register(() => this.clearNativeDrop());
  }

  bindSourceFile(row: HTMLElement, link: HTMLElement, path: string): void {
    const type = fileSourceType(this.plugin.app.vault.getFileByPath(path)?.extension || '');
    if (type === 'note') this.bindSourceNote(row, link, path);
    else if (type) this.bindSourceWidget(row, link, { kind: type, path });
  }

  bindSourceNote(row: HTMLElement, link: HTMLElement, path: string, options: { showLastWorked?: boolean } = {}): void {
    const { showLastWorked = true } = options;
    row.addClass('tod-source-note'); link.addClass('tod-source-link');
    const drag: Drag = { kind: 'note', path, external: true };
    this.pointer.bind(link, drag, row);
    if (showLastWorked) this.markWorkedRow(row, path);
    const grip = this.sourceAction(row, path, false);
    this.pointer.bind(grip, drag, row, true);
  }

  bindSourceWidget(row: HTMLElement, link: HTMLElement, source: DeskSource): void {
    row.addClass('tod-source-note'); link.addClass('tod-source-link');
    this.sourceBindings.set(row, source);
    this.pointer.bind(link, source, row);
    const button = this.button(row, 'plus', '', `source-${source.kind}:${source.path}`, () => {
      const owner = sourceWidgetId(this.plugin.settings, source);
      if (owner) {
        const root = widgetStackFor(this.plugin.settings, owner) || owner;
        if (this.plugin.settings.widgets[root]?.enabled) { this.plugin.revealDeskWidget(owner); return; }
      }
      this.plugin.addSourceToDesk(source);
    });
    button.addClass('tod-source-grip');
    button.dataset.sourcePath = source.path; button.dataset.sourceKind = source.kind;
    this.pointer.bind(button, source, row, true);
    this.updateWidgetSourceAction(button, source);
  }
  updateSourceTitle(row: HTMLElement, title: string): void {
    const source = this.sourceBindings.get(row);
    if (source) { source.title = title; const button = row.querySelector<HTMLButtonElement>('.tod-source-grip'); if (button) this.updateWidgetSourceAction(button, source); }
  }
  private updateWidgetSourceAction(button: HTMLButtonElement, source: DeskSource): void {
    const owner = sourceWidgetId(this.plugin.settings, source);
    const root = owner && (widgetStackFor(this.plugin.settings, owner) || owner);
    const onDesk = !!root && !!this.plugin.settings.widgets[root]?.enabled;
    const state = String(onDesk);
    if (button.dataset.sourceState === state) return;
    button.dataset.sourceState = state;
    setIcon(button, onDesk ? DESK_ACTION_ICONS.showOnDesk : 'plus');
    updateTooltip(button, onDesk ? COPY.showOnDesk : COPY.addToDesk);
    button.setAttribute('aria-label', onDesk ? COPY.showOnDesk : COPY.addToDesk);
    button.setAttribute('aria-description', onDesk ? 'Drag to move it.' : 'Drag to choose a position.');
  }

  /** Read membership when activated; a reused row must never keep an old Add action. */
  private sourceAction(row: HTMLElement, path: string, folder: boolean): HTMLButtonElement {
    const owner = () => this.plugin.settings.items.find(item => folder
      ? item.type === 'folder' && item.path === path : item.type !== 'folder' && itemPaths(item).includes(path));
    const button = this.button(row, 'plus', '', `${folder ? 'source-folder' : 'source'}:${path}`, () => {
      const item = owner();
      if (item) this.plugin.revealDeskWidget(itemWidgetId(item.id));
      else if (folder) this.plugin.pinFolder(path);
      else this.plugin.pin(path);
    });
    button.addClass('tod-source-grip');
    button.dataset.sourcePath = path; button.dataset.sourceKind = folder ? 'folder' : 'note';
    this.updateSourceAction(button, !!owner());
    return button;
  }

  private updateSourceAction(button: HTMLButtonElement, onDesk: boolean): void {
    const state = String(onDesk);
    if (button.dataset.sourceState === state) return;
    button.dataset.sourceState = state;
    setIcon(button, onDesk ? DESK_ACTION_ICONS.showOnDesk : 'plus');
    updateTooltip(button, onDesk ? COPY.showOnDesk : COPY.addToDesk);
    button.setAttribute('aria-label', onDesk ? COPY.showOnDesk : COPY.addToDesk);
    button.setAttribute('aria-description', onDesk ? 'Drag to move it.' : 'Drag to choose a position.');
  }

  private refreshSourceActions(): void {
    const notes = new Set<string>(), folders = new Set<string>();
    for (const item of this.plugin.settings.items) {
      if (item.type === 'folder') folders.add(item.path);
      else for (const path of itemPaths(item)) notes.add(path);
    }
    for (const root of [this.body, this.folderPopup?.el]) root?.querySelectorAll<HTMLButtonElement>('.tod-source-grip[data-source-path]').forEach(button => {
      const row = button.closest<HTMLElement>('.tod-source-note'), source = row && this.sourceBindings.get(row);
      if (source) this.updateWidgetSourceAction(button, source);
      else this.updateSourceAction(button, (button.dataset.sourceKind === 'folder' ? folders : notes).has(button.dataset.sourcePath!));
    });
  }

  bindBaseLinks(host: HTMLElement, sourcePath: string): () => void {
    return this.pointer.delegate(host, target => {
      if (target.closest('input, textarea, [contenteditable="true"]')) return null;
      const link = target.closest<HTMLElement>('.internal-link[data-href]');
      if (!link || !host.contains(link)) return null;
      const href = link.dataset.href || '';
      const path = parseLinktext(href).path;
      const file = this.plugin.app.vault.getFileByPath(path) || this.plugin.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
      if (file?.extension !== 'md') return null;
      const source = link.closest<HTMLElement>('.bases-tr, .bases-cards-item, .bases-list-item') || link;
      return { handle: link, value: { kind: 'note', path: file.path, external: true }, source };
    });
  }

  render(force = false, affected?: ReadonlySet<string>): void {
    // Background updates must not interrupt a drag.
    if (this.isDragging || this.stopped) return;
    const owners = widgetStackOwners(this.plugin.settings);
    const items = this.plugin.settings.items.filter(item => { const config = this.plugin.settings.widgets[itemWidgetId(item.id)]; return config && isVisibleWidget(this.plugin.settings, itemWidgetId(item.id), owners) && isCoverWidget(config); });
    const updates = affected && !force ? items.filter(item => affected.has(item.id) || !this.rendered.get(item.id)?.el.isConnected) : items;
    this.lastWorkedPath = this.plugin.lastWorked.current(this.plugin.settings.items);
    const folders = updates.filter((item): item is DeskFolder => item.type === 'folder');
    const folderNotes = new Map<string, TFile[] | undefined>();
    for (const item of folders) {
      const folder = this.folder(item.path), visibility = collectionCountVisibility(item);
      folderNotes.set(item.id, folder && (visibility.showNoteCount || visibility.showWordCount || !item.description?.trim()) ? this.plugin.folderNotes(folder) : undefined);
    }
    // Retain unrelated content stamps; a targeted Edit does not inspect every folder or note.
    const stamps = new Map(items.map(item => [item.id, this.rendered.get(item.id)?.signature || '']));
    for (const item of updates) {
      const details = item.type === 'folder'
        ? [!!this.folder(item.path), folderNotes.get(item.id)?.map(file => collectionCountVisibility(item).showWordCount
          ? [file.path, this.plugin.wordCountStamp(file)] : file.path)]
        : itemPaths(item).map(path => {
          const file = this.plugin.app.vault.getFileByPath(path);
          return file ? [path, item.type === 'note' ? this.plugin.previewStamp(file) : collectionCountVisibility(item).showWordCount ? this.plugin.wordCountStamp(file) : true] : [path, null];
        });
      stamps.set(item.id, JSON.stringify([item, details, this.plugin.settings.widgets[itemWidgetId(item.id)]?.title]));
    }
    const signature = JSON.stringify([...stamps]);
    if (!force && signature === this.signature && [...this.rendered.values()].every(entry => entry.el.isConnected)) {
      if (this.popup?.id) this.popup.reanchor(this.itemAnchor(this.popup.id));
      if (this.folderPopup?.id) this.folderPopup.update(this.itemAnchor(this.folderPopup.id));
      this.updateNotePreview();
      this.markLastWorked();
      return;
    }
    this.signature = signature;
    const active = this.body.ownerDocument.activeElement as HTMLElement | null;
    const focus = active && this.body.contains(active) ? active.dataset.focusKey : undefined;
    const focusedCard = active?.closest<HTMLElement>('.tod-widget');
    const covers = Array.from(this.grid.querySelectorAll<HTMLElement>(':scope > .tod-widget:not([hidden])'));
    const focusedIndex = focusedCard ? covers.indexOf(focusedCard) : -1;
    const scroll = this.grid.scrollTop;
    // Reuse unchanged cards and their pending work. Only replaced cards lose their bindings.
    for (const [id, entry] of this.rendered) {
      if (force || !entry.el.isConnected || stamps.get(id) !== entry.signature) { this.coverLayout.unwatch(entry.el); this.previewObserver.unobserve(entry.el); this.previewTasks.delete(entry.el); entry.el.remove(); this.rendered.delete(id); }
    }
    for (const item of items) {
      const host = this.hosts.host(item.id);
      if (!host) continue;
      let card = this.rendered.get(item.id)?.el;
      if (!card) {
        if (item.type === 'stack' || item.type === 'folder') card = this.renderCollection(host, item, folderNotes.get(item.id));
        else {
          card = this.renderNote(host, item.path);
          card.addClass('tod-desk-item'); card.dataset.itemId = item.id;
        }
        this.rendered.set(item.id, { signature: stamps.get(item.id)!, el: card });
        this.coverLayout.watch(card);
      }
      if (card.parentElement !== host) host.append(card);
    }
    this.grid.scrollTop = scroll;
    if (this.popup?.id) this.popup.update(this.itemAnchor(this.popup.id));
    if (this.folderPopup?.id) this.folderPopup.update(this.itemAnchor(this.folderPopup.id));
    this.updateNotePreview();
    this.markOpenItems();
    if (focus && !this.focus(focus)) {
      const next = this.grid.querySelectorAll<HTMLElement>(':scope > .tod-widget:not([hidden])')[Math.max(0, Math.min(focusedIndex, items.length - 1))]?.querySelector<HTMLButtonElement>('button:not(:disabled)');
      (next || this.hosts.add).focus({ preventScroll: true });
    }
  }

  private whenVisible(root: HTMLElement, load: () => void): void {
    this.previewTasks.set(root, load); this.previewObserver.observe(root);
  }
  refreshMarkers(): void {
    if (this.stopped || this.isDragging) return;
    this.lastWorkedPath = this.plugin.lastWorked.current(this.plugin.settings.items);
    this.markLastWorked();
  }

  private button(parent: HTMLElement, icon: string, label: string, key: string, run: (event: MouseEvent) => void): HTMLButtonElement {
    const button = parent.createEl('button', { cls: 'tod-icon-button', attr: { 'aria-label': label, 'data-focus-key': key } });
    setIcon(button, icon); setTooltip(button, label);
    button.onclick = event => { event.stopPropagation(); run(event); };
    return button;
  }

  private renderNote(parent: HTMLElement, path: string): HTMLElement {
    const file = this.plugin.app.vault.getFileByPath(path);
    const name = this.noteName(path);
    const card = parent.createEl('article', { cls: 'tod-card tod-note-cover', attr: { 'data-note-path': path } });
    const shouldClose = this.bindPopoverToggle(card, `note:${path}`, '[data-note-preview]', () => this.notePopup.path === path);
    card.onclick = event => {
      if (file && !(event.target as HTMLElement).closest('button, input')) {
        const selection = card.ownerDocument.getSelection();
        if (selection && !selection.isCollapsed && card.contains(selection.anchorNode)) return;
        this.previewNote(path, card, event, shouldClose(event));
      }
    };
    const heading = card.createDiv('tod-card-heading');
    const title = this.noteLink(heading, path, 'tod-note-title');
    title.addClass('tod-card-title');
    title.dataset.widgetDrag = ''; title.draggable = false; title.addClass('tod-drag-handle');
    title.setAttribute('aria-haspopup', 'dialog');
    title.setAttribute('aria-expanded', 'false');
    title.dataset.notePreview = '';
    title.onclick = event => { event.stopPropagation(); this.previewNote(path, card, event, shouldClose(event)); };
    title.empty();
    setIcon(title.createSpan({ cls: 'tod-note-symbol', attr: { 'aria-hidden': 'true' } }), 'file-text');
    title.createSpan({ cls: 'tod-card-label', text: name });
    setTooltip(title, COPY.preview);
    title.setAttribute('aria-label', name);
    const preview = card.createEl('p', { cls: 'tod-preview', text: file ? '' : COPY.noteUnavailable });
    if (file) this.whenVisible(card, () => { void this.plugin.preview(file).then(text => {
      if (!this.stopped && preview.isConnected) { updateText(preview, text); this.coverLayout.queue(card); }
    }).catch(() => {
      if (!this.stopped && preview.isConnected) { updateText(preview, 'Preview unavailable. Open the note to read it.'); this.coverLayout.queue(card); }
    }); });
    const { metadata, actions } = createCardMetadata(card);
    const folder = metadata.createSpan({ cls: 'tod-folder tod-pill tod-metadata-pill', text: !file ? 'Note unavailable' : file.parent?.path === '/' ? 'Vault' : (file.parent?.path || 'Vault') });
    setTooltip(folder, path);
    if (file) {
      const open = this.button(actions, 'arrow-up-right', openSourceLabel('note'), `open-source:${path}`, () => {});
      open.addClass('tod-open-source', 'tod-open-note');
      open.onclick = event => { event.stopPropagation(); this.notePopup.close(false); void this.plugin.openPath(path, event); };
      open.addEventListener('auxclick', event => {
        if (event.button !== 1) return;
        event.preventDefault(); event.stopPropagation(); this.notePopup.close(false);
        void this.plugin.app.workspace.getLeaf('tab').openFile(file);
      });
    }
    return card;
  }

  /** Preserve toggle intent before focus or scrolling can dismiss a popover. */
  private bindPopoverToggle(root: HTMLElement, key: string, selector: string, isOpen: () => boolean): (event: MouseEvent) => boolean {
    root.addEventListener('pointerdown', event => {
      this.popoverPress = null;
      if (event.button !== 0 || !event.isPrimary) return;
      const button = (event.target as HTMLElement).closest('button');
      if (button && !button.matches(selector)) return;
      this.popoverPress = { key, close: isOpen() };
    }, true);
    root.addEventListener('pointercancel', () => { this.popoverPress = null; });
    return event => {
      const press = event.detail > 0 && this.popoverPress?.key === key ? this.popoverPress : null;
      this.popoverPress = null;
      return press?.close ?? isOpen();
    };
  }

  private previewNote(path: string, anchor: HTMLElement, event: MouseEvent, close: boolean): void {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      this.notePopup.close(false); void this.plugin.openPath(path, event); return;
    }
    if (close) { this.notePopup.close(true); this.markOpenItems(); return; }
    this.popup.close(false); this.folderPopup.close(false);
    const rect = anchor.getBoundingClientRect();
    const originY = event.detail > 0 ? Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))) : 0;
    this.notePopup.open(path, anchor, originY); this.markOpenItems();
  }

  private updateNotePreview(): void {
    const path = this.notePopup?.path;
    if (!path) return;
    const item = this.plugin.settings.items.find(item => item.type === 'note' && item.path === path);
    this.notePopup.update(item ? this.itemAnchor(item.id) : undefined);
  }

  private noteName(path: string): string { return this.plugin.app.vault.getFileByPath(path)?.basename || path.split('/').pop()!.replace(/\.md$/i, ''); }

  private noteLink(parent: HTMLElement, path: string, cls: string): HTMLButtonElement {
    const file = this.plugin.app.vault.getFileByPath(path), name = this.noteName(path);
    const button = parent.createEl('button', { cls, text: name, attr: { 'aria-label': `Open ${name}`, 'data-focus-key': `open:${path}` } });
    button.disabled = !file;
    setTooltip(button, file ? path : `${path} — note unavailable`);
    button.onclick = event => {
      event.stopPropagation();
      if (button.closest('.tod-stack-popover')) this.popup.close(false);
      void this.plugin.openPath(path, event);
    };
    button.addEventListener('auxclick', event => {
      if (event.button === 1 && file) { event.preventDefault(); event.stopPropagation(); if (button.closest('.tod-stack-popover')) this.popup.close(false); this.notePopup.close(false); void this.plugin.openPath(path, event); }
    });
    return button;
  }

  private itemAnchor(id: string): HTMLElement | undefined {
    return this.rendered.get(id)?.el || this.hosts.host(id)?.closest<HTMLElement>('.tod-widget') || undefined;
  }

  private markOpenItems(): void {
    for (const root of Array.from(this.grid.querySelectorAll<HTMLElement>('.tod-note-cover'))) {
      const opened = root.dataset.notePath === this.notePopup?.path;
      root.toggleClass('is-open', opened);
      root.querySelector('[data-note-preview]')?.setAttribute('aria-expanded', String(opened));
    }
    for (const root of Array.from(this.grid.querySelectorAll<HTMLElement>('.tod-stack, .tod-desk-folder'))) {
      const opened = root.dataset.itemId === this.popup?.id || root.dataset.itemId === this.folderPopup?.id;
      root.toggleClass('is-open', opened);
      const symbol = root.querySelector<HTMLElement>('.tod-stack-symbol');
      if (symbol) setCollectionIcon(symbol, root.hasClass('tod-desk-folder') ? 'folder' : 'stack', opened);
      root.querySelectorAll('[aria-haspopup="dialog"]').forEach(button => button.setAttribute('aria-expanded', String(opened)));
    }
    this.markLastWorked();
  }

  private workedInFolder(path: string): boolean {
    return !!this.lastWorkedPath && (path === '/' || this.lastWorkedPath.startsWith(path + '/'));
  }

  /** Update small markers in place; an edit elsewhere must not remount covers. */
  private markLastWorked(): void {
    this.refreshSourceActions();
    for (const item of this.plugin.settings.items) {
      const root = this.rendered.get(item.id)?.el;
      if (!root) continue;
      const worked = item.type === 'note' ? item.path === this.lastWorkedPath
        : item.type === 'stack' ? !!this.lastWorkedPath && item.paths.includes(this.lastWorkedPath) : this.workedInFolder(item.path);
      if (item.type === 'note') {
        const footer = root.querySelector<HTMLElement>('.tod-folder');
        if (!footer) continue;
        const file = this.plugin.app.vault.getFileByPath(item.path);
        updateText(footer, !file ? 'Note unavailable' : file.parent?.path === '/' ? 'Vault' : file.parent?.path || 'Vault');
        footer.hidden = false; updateTooltip(footer, item.path);
        this.resumeButton(footer.parentElement!, worked, false);
      } else {
        const footer = root.querySelector<HTMLElement>('.tod-metadata-group');
        if (footer) this.resumeButton(footer, worked, true);
      }
    }
    this.popup?.el?.querySelectorAll<HTMLElement>('.tod-stack-popup-note').forEach(row => this.markWorkedRow(row, row.dataset.notePath || ''));
    this.folderPopup?.el?.querySelectorAll<HTMLElement>('.tod-folder-row').forEach(row => this.markWorkedRow(row, row.dataset.path || '', row.dataset.kind === 'folder'));
    this.body.querySelectorAll<HTMLElement>('.tod-widget-folder .tod-folder-row').forEach(row => this.markWorkedRow(row, row.dataset.path || '', row.dataset.kind === 'folder'));
  }

  private resumeButton(footer: HTMLElement, visible: boolean, collection: boolean): void {
    let button = footer.querySelector<HTMLButtonElement>(':scope > .tod-resume-note');
    if (!visible || !this.lastWorkedPath) {
      if (button && !button.hidden && button === button.ownerDocument.activeElement) footer.closest('.tod-desk-item')?.querySelector<HTMLButtonElement>('.tod-card-title')?.focus({ preventScroll: true });
      if (button) button.hidden = true;
      return;
    }
    if (!button) {
      button = footer.createEl('button', { cls: 'tod-resume-note tod-pill tod-metadata-pill', attr: { type: 'button' } });
      setIcon(button.createSpan({ cls: 'tod-metadata-icon', attr: { 'aria-hidden': 'true' } }), 'history');
      button.createSpan({ cls: 'tod-resume-label', text: 'Last worked on', attr: { 'aria-hidden': 'true' } });
      button.createSpan({ cls: 'tod-resume-compact', text: 'Resume', attr: { 'aria-hidden': 'true' } });
      if (collection) button.createSpan({ cls: 'tod-resume-detail', attr: { 'aria-hidden': 'true' } });
      button.onclick = event => {
        event.stopPropagation(); this.dismiss();
        const path = button!.dataset.resumePath;
        if (path) void this.plugin.resumePath(path, event);
      };
    }
    const path = this.lastWorkedPath;
    button.hidden = false; button.dataset.resumePath = path; button.dataset.focusKey = `resume:${path}`;
    const detail = button.querySelector<HTMLElement>('.tod-resume-detail');
    if (detail) updateText(detail, this.noteName(path));
    button.setAttribute('aria-label', COPY.resume);
    updateTooltip(button, COPY.resume);
  }

  private markWorkedRow(row: HTMLElement, path: string, folder = false): void {
    this.workedMarker(row, folder ? this.workedInFolder(path) : path === this.lastWorkedPath, !folder);
  }

  private workedMarker(parent: HTMLElement, visible: boolean, showLabel: boolean): void {
    let marker = parent.querySelector<HTMLElement>(':scope > .tod-last-worked-marker');
    if (!visible || !this.lastWorkedPath) { marker?.remove(); return; }
    if (!marker) {
      marker = parent.createSpan({ cls: 'tod-last-worked-marker', attr: { role: 'img' } });
      setIcon(marker.createSpan({ attr: { 'aria-hidden': 'true' } }), 'history');
      if (showLabel) marker.createSpan({ cls: 'tod-last-worked-label', text: 'Last worked on', attr: { 'aria-hidden': 'true' } });
      parent.insertBefore(marker, parent.querySelector(':scope > .tod-icon-button'));
    }
    const label = `Last worked on: ${this.noteName(this.lastWorkedPath)}`;
    marker.setAttribute('aria-label', label);
    updateTooltip(marker, label);
  }

  private renderCollection(parent: HTMLElement, item: DeskStack | DeskFolder, folderNotes?: TFile[]): HTMLElement {
    const isStack = item.type === 'stack';
    const label = this.plugin.settings.widgets[itemWidgetId(item.id)]?.title || (isStack ? item.name || 'Stack' : this.folderName(item.path));
    const count = isStack ? item.paths.length : folderNotes?.length;
    const visibility = collectionCountVisibility(item);
    const root = parent.createEl('article', { cls: `tod-desk-item ${isStack ? 'tod-stack' : 'tod-desk-folder'}`, attr: { 'data-item-id': item.id, 'aria-label': `${isStack ? 'Stack' : 'Folder'}: ${label}` } });
    if (isStack) {
      root.dataset.layers = item.paths.length > 2 ? '2' : '1';
      const layers = root.createDiv({ cls: 'tod-stack-layers', attr: { 'aria-hidden': 'true' } });
      if (item.paths.length > 2) layers.createSpan({ cls: 'tod-stack-sheet tod-stack-sheet-back' });
      layers.createSpan({ cls: 'tod-stack-sheet tod-stack-sheet-front' });
    }
    const cover = root.createDiv('tod-card tod-collection-cover tod-stack-main');
    const isOpen = () => (isStack ? this.popup.id : this.folderPopup.id) === item.id;
    const shouldClose = this.bindPopoverToggle(root, `collection:${item.id}`, '[data-collection-toggle]', isOpen);
    const open = (event: MouseEvent) => {
      if (shouldClose(event)) {
        if (isStack && this.popup.id === item.id) this.popup.close(true);
        else if (!isStack && this.folderPopup.id === item.id) this.folderPopup.close(true);
        this.markOpenItems();
        return;
      }
      const selection = root.ownerDocument.getSelection();
      if (!((event.target as HTMLElement).closest('button')) && selection && !selection.isCollapsed && root.contains(selection.anchorNode)) return;
      const rect = root.getBoundingClientRect();
      const originY = event.detail > 0 ? Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))) : 0;
      this.notePopup.close(false);
      if (isStack) { this.folderPopup.close(false); this.popup.open(item.id, root, originY); }
      else { this.popup.close(false); this.folderPopup.open(item.id, root, originY); }
      this.markOpenItems();
    };
    const heading = cover.createDiv('tod-card-heading tod-stack-heading');
    const toggle = heading.createEl('button', { cls: 'tod-card-title tod-stack-toggle', attr: {
      'aria-haspopup': 'dialog', 'data-collection-toggle': '', 'data-focus-key': `${isStack ? 'toggle' : 'folder'}:${item.id}`,
      'aria-label': `Browse ${label}`
    } });
    const symbol = toggle.createSpan({ cls: 'tod-stack-symbol', attr: { 'aria-hidden': 'true' } });
    setCollectionIcon(symbol, item.type, false);
    toggle.createSpan({ cls: 'tod-card-label', text: label });
    setTooltip(toggle, 'Browse');
    toggle.setAttribute('aria-label', label);
    toggle.dataset.widgetDrag = ''; toggle.draggable = false; toggle.addClass('tod-drag-handle');
    toggle.onclick = event => { event.stopPropagation(); open(event); };
    if (item.description?.trim()) {
      const description = cover.createEl('p', { cls: 'tod-collection-description', text: item.description });
      setTooltip(description, item.description);
    } else {
      // Names make an otherwise blank cover recognizable without reading note contents.
      const paths = isStack ? item.paths : folderNotes?.map(file => file.path).sort(compareNames) || [];
      const names = paths.slice(0, 3).map(path => this.noteName(path));
      const text = names.length ? names.join(', ') + (paths.length > names.length ? '…' : '')
        : isStack ? 'No notes yet' : this.folder(item.path) ? 'No notes yet' : 'Folder unavailable';
      const contents = cover.createEl('p', { cls: 'tod-collection-description', text });
      setTooltip(contents, names.length ? names.join('\n') : text);
    }
    const { metadata: stats, actions } = createCardMetadata(cover);
    let summary: HTMLElement = stats;
    if (visibility.showNoteCount) {
      const formatted = count?.toLocaleString() ?? '—', unit = count === 1 ? 'note' : 'notes';
      const browseLabel = count === undefined ? COPY.folderUnavailable : `Browse ${formatted} ${unit}${isStack ? '' : ', including subfolders'}`;
      const countButton = stats.createEl('button', { cls: 'tod-pill tod-metadata-pill tod-metadata-summary tod-stack-count', attr: {
        type: 'button', 'data-browse-label': browseLabel,
        'aria-haspopup': 'dialog', 'data-collection-toggle': '', 'data-focus-key': `collection-count:${item.id}`,
        'aria-label': browseLabel
      } });
      countButton.createSpan({ cls: 'tod-stack-count-value', text: formatted });
      countButton.createSpan({ cls: 'tod-metadata-unit', text: unit });
      updateTooltip(countButton, browseLabel);
      countButton.onclick = event => { event.stopPropagation(); open(event); };
      summary = countButton;
    }
    if (visibility.showWordCount) this.collectionWords(root, summary, item, folderNotes);
    if (!isStack) { const open = this.button(actions, 'arrow-up-right', COPY.showInFiles, `folder-source:${item.id}`, () => { void this.plugin.revealFolder(item.path); }); open.addClass('tod-open-source', 'tod-open-note'); }
    root.onclick = event => {
      if ((event.target as HTMLElement).closest('button, input')) return;
      open(event);
    };
    return root;
  }

  private collectionWords(root: HTMLElement, stats: HTMLElement, item: DeskStack | DeskFolder, folderNotes: TFile[] | undefined): void {
    const combined = stats.hasClass('tod-metadata-summary');
    const words = stats.createSpan({ cls: `tod-stack-words${combined ? '' : ' tod-pill tod-metadata-pill'}` });
    const value = words.createSpan({ cls: 'tod-metadata-value', text: '—' });
    const unit = words.createSpan({ cls: 'tod-metadata-unit', text: 'words' });
    words.setAttribute('aria-label', 'Counting words');
    const files = item.type === 'stack' ? item.paths.map(path => this.plugin.app.vault.getFileByPath(path)) : folderNotes;
    const current = () => !this.stopped && stats.isConnected;
    const total = async () => {
      if (!files || files.some(file => !file)) throw new Error('Collection note unavailable');
      return this.plugin.collectionWordCount(item.id, files as TFile[], current);
    };
    this.whenVisible(root, () => { void total().then(count => {
      if (!current()) return;
      const label = formatCount(count, 'word');
      updateText(value, count.toLocaleString()); updateText(unit, count === 1 ? 'word' : 'words');
      words.setAttribute('aria-label', `${label} across all notes`);
      if (combined) {
        const description = `${stats.dataset.browseLabel}. ${label} across all notes.`;
        stats.setAttribute('aria-label', description); updateTooltip(stats, description);
      } else updateTooltip(words, `${label}. ${item.type === 'stack' ? 'Words in this stack’s notes.' : 'Words in this folder and its subfolders.'} Note properties aren’t counted.`);
    }).catch(() => {
      if (!current()) return;
      words.setAttribute('aria-label', 'Word count unavailable');
      if (combined) {
        const description = `${stats.dataset.browseLabel}. Word count unavailable.`;
        stats.setAttribute('aria-label', description); updateTooltip(stats, description);
      } else updateTooltip(words, 'Couldn’t count words in every note.');
    }); });
  }

  private popupNote(parent: HTMLElement, path: string): HTMLElement {
    const row = parent.createEl('div', { cls: 'tod-folder-row tod-stack-note-row', attr: { 'data-note-path': path } });
    const grip = this.noteGrip(row, path, row);
    grip.addClass('tod-browser-grip'); grip.empty();
    setIcon(grip.createSpan({ cls: 'tod-browser-file-symbol', attr: { 'aria-hidden': 'true' } }), 'file-text');
    setIcon(grip.createSpan({ cls: 'tod-browser-drag-symbol', attr: { 'aria-hidden': 'true' } }), 'grip-vertical');
    const title = this.noteLink(row, path, 'tod-folder-link tod-note-title');
    title.empty();
    title.createSpan({ cls: 'tod-recent-title', text: this.noteName(path) });
    this.bindDrag(title, { kind: 'note', path }, row);
    const more = this.button(row, 'ellipsis', COPY.actions, `actions:${path}`, event => this.popup.showNoteMenu(path, more, event));
    more.addClass('tod-browser-more'); more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
    this.markWorkedRow(row, path);
    return row;
  }

  private noteGrip(parent: HTMLElement, path: string, image: HTMLElement): HTMLButtonElement {
    const grip = this.button(parent, 'grip-vertical', COPY.move, `grip:${path}`, () => {});
    grip.addClass('tod-reorder-note');
    if (image.closest('.tod-stack-popover')) {
      grip.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown Shift+Enter');
      grip.setAttribute('aria-description', 'Drag or use arrow keys to reorder. Shift+Enter moves the note out of the stack.');
      updateTooltip(grip, COPY.move);
      grip.setAttribute('aria-label', COPY.move);
    }
    this.bindDrag(grip, { kind: 'note', path }, image, true);
    grip.onkeydown = event => {
      if (event.key === 'Enter' && event.shiftKey && image.closest('.tod-stack-popover')) {
        event.preventDefault(); event.stopPropagation();
        this.popup.close(false); this.plugin.detachNote(path); this.focus(`grip:${path}`);
        return;
      }
      const edge = event.key === 'Home' ? 0 : event.key === 'End' ? Infinity : null;
      const direction = this.direction(event);
      if (!direction && edge === null) return;
      event.preventDefault(); event.stopPropagation();
      const item = this.plugin.settings.items.find(item => itemPaths(item).includes(path));
      if (!item) return;
      if (item.type === 'stack') this.plugin.moveStackNote(item.id, path, edge ?? item.paths.indexOf(path) + direction);
      else this.plugin.moveDeskItem(item.id, edge ?? this.plugin.settings.items.indexOf(item) + direction);
      this.focus(`grip:${path}`);
    };
    return grip;
  }

  private direction(event: KeyboardEvent): number {
    const direction = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : 0;
    if (direction) { event.preventDefault(); event.stopPropagation(); }
    return direction;
  }

  private focus(key: string): boolean {
    const controls = [...Array.from(this.popup?.el?.querySelectorAll<HTMLElement>('[data-focus-key]') || []), ...Array.from(this.body.querySelectorAll<HTMLElement>('[data-focus-key]'))];
    const target = controls.find(el => el.dataset.focusKey === key)
      || (key.startsWith('grip:') ? controls.find(el => el.dataset.focusKey === `open:${key.slice(5)}`) : undefined);
    if (!target || target.matches(':disabled')) return false;
    const hiddenTitle = target.closest('.tod-card-heading') && target.closest<HTMLElement>('.tod-widget-cover.is-heading-hidden');
    const destination = hiddenTitle || target;
    if (destination.closest('[hidden]')) return false;
    destination.focus({ preventScroll: true });
    return destination.ownerDocument.activeElement === destination;
  }

  private bindDrag(handle: HTMLElement, drag: Drag, image: HTMLElement, touchDrag = false): void {
    this.pointer.bind(handle, drag, image, touchDrag);
  }

  private overPopover(x: number, y: number): boolean {
    const hit = this.body.ownerDocument.elementFromPoint(x, y);
    return !!hit?.closest('.tod-stack-popover, .tod-folder-popover, .tod-note-popover');
  }

  private dropAt(x: number, y: number, hit = this.body.ownerDocument.elementFromPoint(x, y)): DropTarget | null {
    const drag = this.drag;
    if (!drag || !hit) return null;
    if (this.folderPopup.el?.contains(hit)) return null;
    const popup = this.popup.el;
    if (popup?.contains(hit)) {
      if (drag.kind !== 'note' || !this.popup.id) return null;
      const grid = hit.closest<HTMLElement>('.tod-stack-popover-list');
      if (!grid) return null;
      // Gaps between rows are drop targets too; choose the nearest row.
      let card = hit.closest<HTMLElement>('.tod-stack-popup-note');
      if (!card) {
        let nearest = Infinity;
        for (const row of grid.querySelectorAll<HTMLElement>('.tod-stack-popup-note')) {
          const r = row.getBoundingClientRect();
          const distance = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
          if (distance < nearest) { nearest = distance; card = row; }
        }
      }
      if (!card || card.dataset.notePath === drag.path) return null;
      const rect = card.getBoundingClientRect();
      const after = y > rect.top + rect.height / 2;
      return { intent: { id: this.popup.id, path: card.dataset.notePath!, after }, surface: card };
    }
    return null;
  }

  private movePointer(x: number, y: number): boolean {
    let hit = this.body.ownerDocument.elementFromPoint(x, y);
    const overPopover = !!hit?.closest('.tod-stack-popover, .tod-folder-popover, .tod-note-popover');
    const gridTarget = this.hosts.grid.previewSourceMove(x, y, overPopover);
    if (!overPopover) { this.clearFeedback(); return gridTarget; }
    const scroll = hit && this.popup.el?.contains(hit) ? this.popup.el.querySelector<HTMLElement>('.tod-stack-popover-list') : null;
    if (scroll) {
      const rect = scroll.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        const edge = Math.min(28, rect.height / 4);
        const speed = y < rect.top + edge ? -10 * (1 - (y - rect.top) / edge) : y > rect.bottom - edge ? 10 * (1 - (rect.bottom - y) / edge) : 0;
        if (speed) {
          scroll.scrollTop += speed;
          // Scrolling can move another row underneath the same pointer.
          hit = this.body.ownerDocument.elementFromPoint(x, y);
        }
      }
    }
    const target = this.dropAt(x, y, hit);
    if (!target) { this.clearFeedback(); return false; }
    this.showInsertion(target.surface, target.intent.after, 'y');
    return true;
  }

  private showInsertion(surface: HTMLElement, after: boolean, axis: 'x' | 'y'): void {
    const doc = surface.ownerDocument, win = doc.defaultView!;
    const container = surface.closest<HTMLElement>('.tod-stack-popover-list') || this.grid;
    const rect = surface.getBoundingClientRect(), clip = container.getBoundingClientRect();
    const styles = win.getComputedStyle(container);
    const gap = parseFloat(axis === 'x' ? styles.columnGap : styles.rowGap) || 8;
    let left: number, top: number, width: number, height: number;
    if (axis === 'x') {
      const edge = after ? rect.right + gap / 2 : rect.left - gap / 2;
      left = Math.max(clip.left - 3, Math.min(edge, clip.right + 3)) - 1;
      top = Math.max(rect.top + 6, clip.top + 2);
      width = 2; height = Math.min(rect.bottom - 6, clip.bottom - 2) - top;
    } else {
      const edge = after ? rect.bottom + gap / 2 : rect.top - gap / 2;
      left = Math.max(rect.left + 6, clip.left + 2);
      top = Math.max(clip.top - 3, Math.min(edge, clip.bottom + 3)) - 1;
      width = Math.min(rect.right - 6, clip.right - 2) - left; height = 2;
    }
    if (width <= 0 || height <= 0) { this.clearFeedback(); return; }
    const marker = this.insertionMarker ??= doc.body.createDiv({ cls: 'tod-insertion-marker', attr: { 'aria-hidden': 'true' } });
    updateBounds(marker, { left, top, width, height });
    if (marker.hidden) marker.hidden = false;
  }

  private applyDrop(intent: Drop, origin?: UndoOrigin): void {
    const drag = this.drag;
    if (drag?.kind !== 'note' || drag.external && this.plugin.app.vault.getFileByPath(drag.path)?.extension !== 'md') return;
    const stack = this.plugin.settings.items.find(item => item.id === intent.id);
    if (stack?.type !== 'stack') return;
    const others = stack.paths.filter(path => path !== drag.path);
    const destination = others.indexOf(intent.path) + Number(intent.after);
    if (stack.paths.includes(drag.path)) this.plugin.moveStackNote(intent.id, drag.path, destination, origin);
    else this.plugin.stackNote(drag.path, intent.id, false, origin, destination);
  }

  private clearFeedback(): void {
    if (this.insertionMarker && !this.insertionMarker.hidden) this.insertionMarker.hidden = true;
  }

  private finishDrag(): void {
    this.popoverPress = null;
    if (!this.drag) return;
    this.drag = null;
    this.hosts.grid.finishSourceMove();
    this.dragSource?.removeClass('is-dragging'); this.dragSource = null;
    this.body.removeClass('is-dragging-note');
    [this.grid, this.popup?.el].forEach(surface => surface?.querySelectorAll('.is-dragging').forEach(el => el.removeClass('is-dragging')));
    this.clearFeedback();
    this.insertionMarker?.remove(); this.insertionMarker = null;
    this.plugin.refreshViews({ widgets: ['items', 'recents'] });
  }
}
