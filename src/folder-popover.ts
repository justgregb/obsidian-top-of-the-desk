import { Component, TFolder, setIcon, setTooltip } from 'obsidian';
import type DeskPlugin from './main';
import { itemWidgetId, widgetDefaults } from './model';
import { FolderWidget } from './source-widgets';
import { positionCollectionPopover, watchPopover } from './collection-popover';
import { setCollectionIcon } from './collection-icons';
import { updateText, updateTooltip } from './ui';
import { formatCount } from './copy';

interface FolderPopoverHooks {
  note(row: HTMLElement, link: HTMLElement, path: string): void;
  folder(row: HTMLElement, link: HTMLElement, path: string): void;
  dragging(): boolean;
  closed(id: string, restoreFocus: boolean): void;
}

/** A pinned folder remains a live folder, browsable without changing the dashboard. */
export class FolderPopover extends Component {
  id: string | null = null;
  el: HTMLElement | null = null;
  private anchor: HTMLElement | null = null;
  private originY = 0;
  private browser: FolderWidget | null = null;
  private title: HTMLElement | null = null;
  private count: HTMLElement | null = null;
  private dispose: (() => void) | null = null;

  constructor(private plugin: DeskPlugin, private hooks: FolderPopoverHooks) { super(); }

  open(id: string, anchor: HTMLElement, originY = 0): void {
    if (this.id === id) { this.close(true); return; }
    this.close(false); this.plugin.sizePicker.close();
    const item = this.plugin.settings.items.find(item => item.id === id);
    if (item?.type === 'folder') this.plugin.recordFolderOpen(item.path);
    this.id = id; this.anchor = anchor; this.originY = originY;
    const doc = anchor.ownerDocument;
    const el = this.el = doc.body.createDiv({ cls: 'tod-shell tod-folder-popover has-desk', attr: { role: 'dialog', 'aria-modal': 'false', tabindex: '-1' } });
    const header = el.createDiv('tod-stack-popover-header');
    const identity = header.createDiv('tod-stack-popover-identity');
    setCollectionIcon(identity.createSpan({ cls: 'tod-desk-folder-icon', attr: { 'aria-hidden': 'true' } }), 'folder', true);
    this.title = identity.createEl('h3', { cls: 'tod-folder-popover-title' });
    this.count = identity.createSpan('tod-pill tod-metadata-pill tod-browser-count');
    const actions = header.createDiv('tod-stack-popover-actions');
    const close = actions.createEl('button', { cls: 'tod-icon-button', attr: { 'aria-label': 'Close' } });
    setIcon(close, 'x'); setTooltip(close, 'Close'); close.onclick = () => this.close(true);
    const body = el.createDiv('tod-folder-popover-body');
    this.browser = this.addChild(new FolderWidget(this.plugin, id, body, this.hooks.note, this.hooks.folder, null, () => this.close(false), () => this.position(), true));
    const stopWatching = watchPopover(el, () => this.anchor, {
      close: restore => this.close(restore), position: () => this.position(), dragging: this.hooks.dragging
    });
    // Browsing changes the list's intrinsic height synchronously.
    const position = () => this.position();
    el.addEventListener('click', position);
    this.dispose = () => { stopWatching(); el.removeEventListener('click', position); };
    this.update(anchor);
    (this.el?.querySelector<HTMLButtonElement>('.tod-folder-link') || close).focus({ preventScroll: true });
  }

  update(anchor?: HTMLElement): void {
    if (!this.id || !this.el) return;
    if (anchor) this.anchor = anchor;
    const item = this.plugin.settings.items.find(item => item.id === this.id);
    if (item?.type !== 'folder' || !this.anchor?.isConnected) { this.close(false); return; }
    const folder = item.path === '/' ? this.plugin.app.vault.getRoot() : this.plugin.app.vault.getAbstractFileByPath(item.path);
    const name = this.plugin.settings.widgets[itemWidgetId(item.id)]?.title || (folder instanceof TFolder ? folder.isRoot() ? 'Vault' : folder.name : item.path.split('/').pop() || 'Folder');
    if (this.title) updateText(this.title, name);
    this.el.setAttribute('aria-label', `Folder: ${name}`);
    if (this.count) {
      this.count.hidden = item.showNoteCount === false;
      if (!this.count.hidden) {
        const notes = folder instanceof TFolder ? this.plugin.folderNotes(folder).length : undefined;
        updateText(this.count, notes === undefined ? '— notes' : formatCount(notes, 'note'));
        const label = notes === undefined ? 'Folder unavailable' : `${formatCount(notes, 'note')}, including subfolders`;
        this.count.setAttribute('aria-label', label); updateTooltip(this.count, label);
      }
    }
    this.browser?.render({ ...widgetDefaults('folder'), path: item.path, itemId: item.id });
    this.position();
  }

  private position(): void {
    const el = this.el, anchor = this.anchor;
    if (!el || !anchor) return;
    if (!positionCollectionPopover(el, anchor, this.originY)) this.close(false);
  }

  close(restoreFocus = false): void {
    if (!this.id) return;
    const id = this.id; this.id = null;
    this.dispose?.(); this.dispose = null;
    if (this.browser) this.removeChild(this.browser);
    this.browser = null; this.el?.remove(); this.el = null;
    this.anchor = null; this.title = null; this.count = null;
    this.hooks.closed(id, restoreFocus);
  }
  onunload(): void { this.close(false); }
}
