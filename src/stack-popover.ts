import { CollectionSearch } from './collection-search';
import { Component, Menu, setIcon, setTooltip } from 'obsidian';
import type DeskPlugin from './main';
import { type DeskStack, itemWidgetId } from './model';
import { positionCollectionPopover, watchPopover } from './collection-popover';
import { DESK_ACTION_ICONS, setCollectionIcon } from './collection-icons';
import { navigateList, reconcileChildren, updateTooltip } from './ui';
import { COPY, formatCount } from './copy';
import { undoOrigin } from './undo-notice';
import { CollectionPreviewDetails } from './collection-preview-details';

interface StackPopoverHooks {
  anchor(id: string): HTMLElement | undefined;
  row(parent: HTMLElement, path: string): HTMLElement;
  closed(id: string, restoreFocus: boolean): void;
  dragging(): boolean;
  finishDrag(): void;
}

/** The same compact browser as folders, with a manually arranged note list. */
export class StackPopover extends Component {
  id: string | null = null;
  el: HTMLElement | null = null;
  private anchor: HTMLElement | null = null;
  private originY = 0;
  private list: HTMLElement | null = null;
  private header: HTMLElement | null = null;
  private dispose: (() => void) | null = null;
  private search: CollectionSearch | null = null;
  private stopped = false;
  private savedScroll = 0;
  private signature = '';
  private headerSignature = '';
  private details: CollectionPreviewDetails | null = null;
  private menu: Menu | null = null;

  constructor(private plugin: DeskPlugin, private hooks: StackPopoverHooks) { super(); }
  get stack(): DeskStack | undefined {
    const item = this.plugin.settings.items.find(item => item.id === this.id);
    return item?.type === 'stack' ? item : undefined;
  }

  open(id: string, anchor: HTMLElement, originY = 0): void {
    if (this.id === id) { this.close(true); return; }
    this.close(false); this.plugin.sizePicker.close();
    this.id = id; this.anchor = anchor; this.originY = originY;
    const doc = anchor.ownerDocument;
    const el = this.el = doc.body.createDiv({ cls: 'tod-shell tod-stack-popover', attr: { role: 'dialog', 'aria-modal': 'false', tabindex: '-1' } });
    this.header = el.createDiv('tod-stack-popover-header');
    this.search = this.addChild(new CollectionSearch(el, 'Find notes in this stack…', () => {
      this.signature = ''; if (this.list) this.list.scrollTop = 0; this.update();
    }));
    const saved = this.plugin.collectionBrowseState.get(id);
    if (saved?.source === id) { this.search.set(saved.query); this.savedScroll = saved.scroll; }
    this.list = el.createDiv({ cls: 'tod-stack-popover-list', attr: { role: 'list', 'aria-label': 'Notes in this stack' } });
    this.details = this.addChild(new CollectionPreviewDetails(this.plugin, this.list, () => this.position()));
    this.dispose = watchPopover(el, () => this.anchor, {
      close: restore => this.close(restore), position: () => this.position(),
      dragging: () => this.hooks.dragging(),
      interacting: () => !!this.menu,
      escape: () => { this.hooks.finishDrag(); this.close(true); }
    });
    this.list.addEventListener('keydown', event => navigateList(event, this.list!, '.tod-note-title'));
    this.update(anchor);
    if (this.list) this.list.scrollTop = this.savedScroll;
    (this.list?.querySelector<HTMLButtonElement>('.tod-note-title:not(:disabled)') || this.el?.querySelector<HTMLButtonElement>('[data-focus-key="close-stack"]'))?.focus({ preventScroll: true });
  }

  update(anchor?: HTMLElement): void {
    if (!this.el) return;
    if (anchor) this.anchor = anchor;
    const stack = this.stack;
    if (!stack || !this.anchor?.isConnected || !this.anchor.getClientRects().length) {
      this.close(!!this.el.contains(this.el.ownerDocument.activeElement)); return;
    }
    this.search?.show(stack.paths.length);
    const signature = JSON.stringify([this.search?.value, stack.name, stack.showNoteCount, stack.paths.map(path => [path, !!this.plugin.app.vault.getFileByPath(path)])]);
    if (signature === this.signature) { this.position(); return; }
    this.signature = signature;
    const el = this.el, list = this.list!, header = this.header!;
    const active = el.ownerDocument.activeElement as HTMLElement | null;
    const focused = active && el.contains(active) ? active.dataset.focusKey : undefined;
    const focusedRow = active?.closest('.tod-stack-popup-note');
    const focusedIndex = focusedRow ? Array.from(list.children).indexOf(focusedRow) : -1;
    const scroll = list.scrollTop;
    const label = stack.name || 'Stack';
    const countLabel = formatCount(stack.paths.length, 'note');
    const headerSignature = JSON.stringify([label, stack.showNoteCount, stack.paths.length]);
    if (headerSignature !== this.headerSignature) {
      this.headerSignature = headerSignature; header.empty();
      el.setAttribute('aria-label', stack.showNoteCount === false ? label : `${label}, ${countLabel}`);
      const identity = header.createDiv('tod-stack-popover-identity');
      setCollectionIcon(identity.createSpan({ cls: 'tod-desk-folder-icon', attr: { 'aria-hidden': 'true' } }), 'stack', true);
      identity.createEl('h3', { cls: 'tod-folder-popover-title', text: label });
      if (stack.showNoteCount !== false) {
        const count = identity.createSpan({ cls: 'tod-pill tod-metadata-pill tod-browser-count', text: countLabel });
        setTooltip(count, countLabel);
      }
      const actions = header.createDiv('tod-stack-popover-actions');
      const add = actions.createEl('button', { cls: 'tod-icon-button', attr: { type: 'button', 'aria-label': COPY.addNotes, 'data-focus-key': 'add-stack-notes' } });
      setIcon(add, 'plus'); setTooltip(add, COPY.addNotes);
      add.onclick = () => {
        const id = stack.id, origin = this.originY; this.close(false);
        this.plugin.pickStackNotes(id, () => {
          const anchor = this.hooks.anchor(id);
          if (!this.stopped && anchor?.isConnected && anchor.getClientRects().length && this.plugin.settings.items.some(item => item.id === id)) this.open(id, anchor, origin);
        });
      };
      const edit = actions.createEl('button', { cls: 'tod-icon-button', attr: { type: 'button', 'data-focus-key': 'edit-stack', 'aria-label': COPY.edit, 'aria-haspopup': 'dialog' } });
      setIcon(edit, DESK_ACTION_ICONS.edit); updateTooltip(edit, COPY.edit);
      edit.onclick = () => {
        const id = stack.id, origin = this.originY; this.close(false);
        this.plugin.configureWidget(itemWidgetId(id), () => {
          const anchor = this.hooks.anchor(id);
          if (!this.stopped && anchor?.isConnected && anchor.getClientRects().length && this.plugin.settings.items.some(item => item.id === id && item.type === 'stack')) this.open(id, anchor, origin);
        });
      };
      actions.prepend(edit);
      const close = actions.createEl('button', { cls: 'tod-icon-button', attr: { 'aria-label': 'Close', 'data-focus-key': 'close-stack' } });
      setIcon(close, 'x'); setTooltip(close, 'Close'); close.onclick = () => this.close(true);
    }
    const existing = new Map(Array.from(list.querySelectorAll<HTMLElement>(':scope > .tod-stack-popup-note')).map(row => [row.dataset.notePath!, row] as const));
    const rows: HTMLElement[] = [];
    const matches = stack.paths.filter(path => this.search?.matches(path) !== false);
    const names = new Map<string, number>();
    for (const path of stack.paths) { const name = path.split('/').pop()!; names.set(name, (names.get(name) || 0) + 1); }
    for (const path of matches) {
      const duplicate = (names.get(path.split('/').pop()!) || 0) > 1;
      const available = JSON.stringify([!!this.plugin.app.vault.getFileByPath(path), duplicate]);
      const current = existing.get(path);
      if (current?.dataset.available === available) { rows.push(current); continue; }
      const row = this.hooks.row(list, path);
      if (duplicate) {
        const title = row.querySelector<HTMLElement>('.tod-recent-title');
        if (title) { const identity = title.ownerDocument.adoptNode(createFragment()).createSpan(); identity.className = 'tod-list-identity'; title.replaceWith(identity); identity.append(title);
          identity.createSpan({ cls: 'tod-source-path', text: path.split('/').slice(0, -1).join('/') || 'Vault' }); }
      }
      row.addClass('tod-stack-popup-note'); row.setAttribute('role', 'listitem');
      row.dataset.available = available; rows.push(row);
    }
    reconcileChildren(list, rows);
    this.details?.sync();
    if (!matches.length) list.createEl('p', { cls: 'tod-stack-empty', text: COPY.noMatchingNotes });
    this.position(); list.scrollTop = scroll;
    if (focused) {
      const restored = Array.from(el.querySelectorAll<HTMLElement>('[data-focus-key]:not(:disabled)')).find(control => control.dataset.focusKey === focused);
      const next = list.children[Math.max(0, Math.min(focusedIndex, stack.paths.length - 1))]?.querySelector<HTMLButtonElement>('button:not(:disabled)');
      (restored || next || header.querySelector<HTMLButtonElement>('[data-focus-key="close-stack"]'))?.focus({ preventScroll: true });
    }
  }

  reanchor(anchor?: HTMLElement): void {
    if (!this.id) return;
    if (!anchor) { this.close(false); return; }
    this.anchor = anchor; this.position();
  }

  showNoteMenu(path: string, trigger: HTMLButtonElement, event: MouseEvent): void {
    const stack = this.stack, el = this.el;
    if (!stack || !el || !stack.paths.includes(path)) return;
    this.menu?.hide();
    const menu = this.menu = new Menu().setUseNativeMenu(false).setParentElement(el);
    const doc = el.ownerDocument, index = stack.paths.indexOf(path);
    const row = trigger.closest<HTMLElement>('.tod-stack-note-row');
    let keyboard = event.detail === 0;
    trigger.setAttribute('aria-expanded', 'true'); row?.addClass('is-menu-open');
    const run = (action: () => void, input: MouseEvent | KeyboardEvent) => {
      keyboard ||= input.type === 'keydown';
      menu.hide();
      if (this.stack?.id === stack.id && this.stack.paths.includes(path)) action();
    };
    menu.addItem(item => item.setTitle('Move up').setIcon('arrow-up').setDisabled(index === 0).onClick(input => run(() => {
      this.plugin.moveStackNote(stack.id, path, this.stack!.paths.indexOf(path) - 1);
    }, input)));
    menu.addItem(item => item.setTitle('Move down').setIcon('arrow-down').setDisabled(index === stack.paths.length - 1).onClick(input => run(() => {
      this.plugin.moveStackNote(stack.id, path, this.stack!.paths.indexOf(path) + 1);
    }, input)));
    menu.addSeparator();
    menu.addItem(item => item.setTitle('Move out of stack').setIcon('arrow-up-left').onClick(input => run(() => this.plugin.detachNote(path), input)));
    menu.addItem(item => item.setTitle(COPY.removeFromDesk).setIcon(DESK_ACTION_ICONS.remove).onClick(input => {
      const origin = undoOrigin(input, trigger);
      run(() => this.plugin.unpin(path, origin), input);
    }));
    menu.onHide(() => {
      if (this.menu === menu) this.menu = null;
      trigger.setAttribute('aria-expanded', 'false'); row?.removeClass('is-menu-open');
      if (keyboard) queueMicrotask(() => {
        if (!this.el?.isConnected || this.id !== stack.id) return;
        const active = doc.activeElement;
        if (active && active !== doc.body && active !== el && active !== trigger) return;
        const rows = Array.from(this.list!.querySelectorAll<HTMLElement>(':scope > .tod-stack-popup-note'));
        const current = rows.find(candidate => candidate.dataset.notePath === path);
        const next = rows[Math.min(index, rows.length - 1)];
        (current?.querySelector<HTMLButtonElement>('.tod-browser-more') || next?.querySelector<HTMLButtonElement>('.tod-note-title') ||
          this.header?.querySelector<HTMLButtonElement>('[data-focus-key="close-stack"]'))?.focus({ preventScroll: true });
      });
    });
    const bounds = trigger.getBoundingClientRect();
    menu.showAtPosition({ x: bounds.right, y: bounds.bottom, left: true }, doc);
  }

  private position(): void {
    if (this.el && this.anchor && !positionCollectionPopover(this.el, this.anchor, this.originY)) this.close(false);
  }

  close(restoreFocus = false): void {
    if (!this.id) return;
    const id = this.id;
    this.menu?.hide(); this.menu = null;
    if (this.stack) this.plugin.collectionBrowseState.set(id, { source: id, current: id, query: this.search?.value || '', scroll: this.list?.scrollTop || 0 });
    else this.plugin.collectionBrowseState.delete(id);
    if (this.search) this.removeChild(this.search); this.search = null; this.savedScroll = 0;
    if (this.details) this.removeChild(this.details); this.details = null;
    this.id = null;
    this.dispose?.(); this.dispose = null;
    this.signature = ''; this.headerSignature = '';
    this.el?.remove(); this.el = null; this.header = null; this.list = null; this.anchor = null;
    this.hooks.closed(id, restoreFocus);
  }
  onunload(): void { this.stopped = true; this.close(false); }
}
