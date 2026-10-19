import { Component, Keymap, MarkdownRenderer, setIcon, setTooltip } from 'obsidian';
import type DeskPlugin from './main';
import { COPY } from './copy';
import { splitFrontmatter } from './model';
import { positionCollectionPopover, watchPopover } from './collection-popover';

const PREVIEW_LIMIT = 6000;

/** A temporary look at a note. Editing and longer reading stay in Obsidian. */
export class NotePopover extends Component {
  path: string | null = null;
  private el: HTMLElement | null = null;
  private anchor: HTMLElement | null = null;
  private body: HTMLElement | null = null;
  private renderer: Component | null = null;
  private dispose: (() => void) | null = null;
  private originY = 0;
  private stamp = '';
  private request = 0;

  constructor(private plugin: DeskPlugin, private closed: (path: string, restoreFocus: boolean) => void) { super(); }

  open(path: string, anchor: HTMLElement, originY = 0): void {
    if (this.path === path) { this.close(true); return; }
    this.close(false);
    const file = this.plugin.app.vault.getFileByPath(path);
    if (!file) return;
    this.plugin.sizePicker.close();
    this.path = path; this.anchor = anchor; this.originY = originY;
    const el = this.el = anchor.ownerDocument.body.createDiv({ cls: 'tod-shell tod-note-popover', attr: {
      role: 'dialog', 'aria-modal': 'false', 'aria-label': `Preview: ${file.basename}`
    } });
    const header = el.createDiv('tod-stack-popover-header');
    const identity = header.createDiv('tod-stack-popover-identity');
    setIcon(identity.createSpan({ cls: 'tod-desk-folder-icon', attr: { 'aria-hidden': 'true' } }), 'file-text');
    const title = identity.createEl('h3', { cls: 'tod-folder-popover-title', text: file.basename });
    setTooltip(title, path);
    const actions = header.createDiv('tod-stack-popover-actions');
    const open = actions.createEl('button', { cls: 'tod-icon-button', attr: { 'aria-label': 'Open' } });
    setIcon(open, 'arrow-up-right'); setTooltip(open, 'Open');
    open.onclick = event => { this.close(false); void this.plugin.openPath(path, event); };
    const close = actions.createEl('button', { cls: 'tod-icon-button', attr: { 'aria-label': 'Close' } });
    setIcon(close, 'x'); setTooltip(close, 'Close'); close.onclick = () => this.close(true);
    const body = this.body = el.createDiv({ cls: 'tod-note-popover-body', attr: { role: 'document', tabindex: '0', 'aria-label': `${file.basename} preview` } });
    // Native Markdown keeps the vault's formatting. Controls inside rendered notes
    // must not turn a quick preview into an editor (including task checkboxes).
    const readOnly = (event: Event) => {
      if ((event.target as Element).closest('input, textarea, select, button, [contenteditable="true"]')) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    };
    for (const name of ['click', 'dblclick', 'keydown', 'beforeinput', 'change']) body.addEventListener(name, readOnly, true);
    body.addEventListener('click', event => {
      const link = (event.target as Element).closest<HTMLElement>('a.internal-link');
      const href = link?.dataset.href || link?.getAttribute('href');
      if (!href) return;
      event.preventDefault(); event.stopPropagation(); this.close(false);
      void this.plugin.app.workspace.openLinkText(href, path, Keymap.isModEvent(event));
    });
    const stopWatching = watchPopover(el, () => this.anchor, { close: restore => this.close(restore), position: () => this.position() });
    // Images and Markdown render children can finish after the initial layout.
    const observer = new ResizeObserver(() => this.position());
    observer.observe(el);
    this.dispose = () => { stopWatching(); observer.disconnect(); };
    this.update(anchor);
    body.focus({ preventScroll: true });
  }

  update(anchor?: HTMLElement): void {
    if (!this.path || !this.el) return;
    if (!anchor?.isConnected || !this.plugin.app.vault.getFileByPath(this.path)) { this.close(false); return; }
    this.anchor = anchor;
    const file = this.plugin.app.vault.getFileByPath(this.path)!;
    const stamp = this.plugin.wordCountStamp(file);
    if (stamp !== this.stamp) { this.stamp = stamp; void this.render(); }
    this.position();
  }

  private async render(): Promise<void> {
    const path = this.path, body = this.body, file = path && this.plugin.app.vault.getFileByPath(path);
    if (!file || !body || !path) return;
    const request = ++this.request;
    const current = () => this.request === request && this.body === body;
    if (this.renderer) this.removeChild(this.renderer);
    this.renderer = null;
    const scroll = body.scrollTop;
    body.empty(); body.setAttribute('aria-busy', 'true');
    const status = body.createEl('p', { cls: 'tod-note-preview-status', text: 'Loading preview…', attr: { role: 'status' } });
    try {
      const source = await this.plugin.app.vault.cachedRead(file);
      if (!current()) return;
      const text = splitFrontmatter(source).body.trim();
      if (!text) { status.setText('This note is empty.'); return; }
      const truncated = text.length > PREVIEW_LIMIT;
      // Prefer a complete line when shortening a large note. Only the beginning is
      // rendered, so opening a long manuscript does not build a second full reader.
      const end = truncated ? text.lastIndexOf('\n', PREVIEW_LIMIT) : text.length;
      const markdown = truncated ? text.slice(0, end > PREVIEW_LIMIT / 2 ? end : PREVIEW_LIMIT) : text;
      const content = body.createDiv('tod-note-preview-markdown markdown-rendered');
      const renderer = this.renderer = this.addChild(new Component());
      await MarkdownRenderer.render(this.plugin.app, markdown, content, path, renderer);
      if (!current()) { renderer.unload(); return; }
      status.remove();
      content.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement>('input, button, textarea, select').forEach(control => { control.disabled = true; });
      content.querySelectorAll<HTMLElement>('[contenteditable]').forEach(control => { control.contentEditable = 'false'; });
      if (truncated) body.createEl('p', { cls: 'tod-note-preview-status', text: 'Open the note to keep reading.' });
      body.scrollTop = scroll;
    } catch {
      if (!current()) return;
      if (this.renderer) this.removeChild(this.renderer);
      this.renderer = null; body.empty();
      body.createEl('p', { cls: 'tod-note-preview-status', text: this.plugin.app.vault.getFileByPath(path) ? 'Couldn’t load the preview. Open the note to read it.' : COPY.noteUnavailable });
    } finally {
      if (current()) { body.removeAttribute('aria-busy'); this.position(); }
    }
  }

  private position(): void {
    if (this.el && this.anchor && !positionCollectionPopover(this.el, this.anchor, this.originY)) this.close(false);
  }

  close(restoreFocus = false): void {
    const path = this.path;
    if (!path) return;
    this.path = null; ++this.request; this.stamp = '';
    this.dispose?.(); this.dispose = null;
    if (this.renderer) this.removeChild(this.renderer);
    this.renderer = null; this.el?.remove(); this.el = null;
    this.body = null; this.anchor = null;
    this.closed(path, restoreFocus);
  }

  onunload(): void { this.close(false); }
}
