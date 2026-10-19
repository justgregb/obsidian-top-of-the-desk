import { Component, Modal, setIcon } from 'obsidian';
import { COPY } from './copy';
import type DeskPlugin from './main';
import { canStackWidget, isRootWidget, widgetName, WIDGET_ICONS } from './model';
import { setupDialogHeader } from './dialog-header';
import { updateText, updateTooltip } from './ui';
import { UndoOrigin, undoOrigin } from './undo-notice';
import { StackWheelGesture } from './stack-wheel';

/** A non-drag alternative uses the same grouping operation as dropping on a widget. */
export class WidgetStackModal extends Modal {
  private release: () => void;
  private createdId: string | null = null;
  constructor(private plugin: DeskPlugin) { super(plugin.app); this.release = plugin.trackWidgetDialog(this); }
  onOpen(): void {
    this.setTitle(COPY.newStack); setupDialogHeader(this);
    const form = this.contentEl.createEl('form', { cls: 'tod-widget-form' });
    form.createEl('p', { cls: 'tod-form-help', text: 'Choose at least two items.' });
    const selected = new Set<string>();
    const list = form.createDiv({ cls: 'tod-note-choices', attr: { role: 'group', 'aria-label': 'Choose items' } });
    const choices = this.plugin.settings.widgetOrder.filter(id => isRootWidget(this.plugin.settings, id) && canStackWidget(this.plugin.settings.widgets[id]));
    const actions = form.createDiv('tod-dialog-actions');
    actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } }).onclick = () => this.close();
    const save = actions.createEl('button', { text: COPY.create, cls: 'mod-cta', attr: { type: 'submit' } });
    save.disabled = true;
    for (const id of choices) {
      const widget = this.plugin.settings.widgets[id];
      const row = list.createEl('label', { cls: 'tod-note-choice' });
      const checkbox = row.createEl('input', { attr: { type: 'checkbox' } });
      setIcon(row.createSpan({ attr: { 'aria-hidden': 'true' } }), WIDGET_ICONS[widget.type]);
      row.createSpan({ cls: 'tod-choice-text', text: widgetName(widget) });
      checkbox.onchange = () => { if (checkbox.checked) selected.add(id); else selected.delete(id); save.disabled = selected.size < 2; };
    }
    if (choices.length < 2) list.createEl('p', { cls: 'tod-form-help', text: 'Add at least two items to the desk first. For notes, choose New note stack.' });
    let origin: UndoOrigin | undefined;
    form.addEventListener('pointerdown', event => { origin = undoOrigin(event, save); });
    form.addEventListener('keydown', event => { if (event.key === 'Enter') origin = undoOrigin(event, save); });
    form.onsubmit = event => {
      event.preventDefault();
      if (save.disabled) return;
      this.createdId = this.plugin.stackWidgets([...selected], origin);
      if (this.createdId) this.close();
    };
    list.querySelector<HTMLInputElement>('input')?.focus();
  }
  onClose(): void { this.contentEl.empty(); this.release(); if (this.createdId) queueMicrotask(() => this.plugin.revealDeskWidget(this.createdId!)); }
}

interface StackSwipe {
  id: number;
  x: number;
  y: number;
  horizontal: boolean;
  member: string;
}

/** A persistent overlay keeps the gesture target stable while the visible widget changes. */
export class WidgetStackSwitcher extends Component {
  readonly el: HTMLElement;
  private indicators: HTMLElement;
  private buttons: HTMLButtonElement[] = [];
  private icons: HTMLElement[] = [];
  private status: HTMLElement;
  private swipe: StackSwipe | null = null;
  private suppressClickUntil = 0;
  private wheel: StackWheelGesture;
  private signature = '';

  constructor(private plugin: DeskPlugin, private id: string, parent: HTMLElement) {
    super();
    this.el = parent.createEl('nav', { cls: 'tod-widget-stack-switcher', attr: {
      'aria-label': 'Items in stack',
      'aria-description': 'Choose an icon, swipe here, or use Left and Right arrow keys to switch items. Home and End select the first and last item.'
    } });
    this.indicators = this.el.createDiv('tod-widget-stack-indicators tod-pill tod-pill-actions');
    this.status = this.el.createSpan({ cls: 'tod-layout-announcement', attr: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' } });
    const doc = this.el.ownerDocument, win = doc.defaultView!;
    this.wheel = new StackWheelGesture(win);
    // Keep the same physical targets, including when a long stack's window shifts.
    for (let index = 0; index < 5; index++) {
      const button = this.indicators.createEl('button', { cls: 'tod-widget-stack-indicator', attr: { type: 'button' } });
      this.icons.push(button.createSpan({ cls: 'tod-widget-stack-icon', attr: { 'aria-hidden': 'true' } }));
      button.hidden = true;
      button.onclick = () => {
        this.wheel.reset();
        if (button.dataset.member) this.plugin.selectStackWidget(this.id, button.dataset.member);
      };
      this.buttons.push(button);
    }

    this.registerDomEvent(this.indicators, 'keydown', event => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (!(event.target as HTMLElement).matches('button.tod-widget-stack-indicator')) return;
      const members = this.members(), index = this.activeIndex();
      const next = event.key === 'ArrowLeft' ? (index - 1 + members.length) % members.length
        : event.key === 'ArrowRight' ? (index + 1) % members.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? members.length - 1 : -1;
      if (next < 0 || !members[next]) return;
      event.preventDefault(); event.stopPropagation();
      this.wheel.reset();
      this.plugin.selectStackWidget(this.id, members[next]);
      this.buttons.find(button => button.dataset.member === members[next])?.focus({ preventScroll: true });
    });

    // A second finger, cancelled gesture or lost capture must never switch a widget.
    this.registerDomEvent(doc, 'pointerdown', event => {
      if (this.swipe && event.pointerId !== this.swipe.id) this.cancelSwipe();
    }, true);
    this.registerDomEvent(this.el, 'pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      this.suppressClickUntil = 0; this.wheel.reset();
      if (!['touch', 'pen'].includes(event.pointerType) || this.members().length < 2) return;
      this.swipe = { id: event.pointerId, x: event.clientX, y: event.clientY, horizontal: false, member: this.members()[this.activeIndex()] };
      this.el.addClass('is-swiping');
    });
    this.registerDomEvent(doc, 'pointermove', event => {
      const swipe = this.swipe;
      if (!swipe || event.pointerId !== swipe.id) return;
      const x = event.clientX - swipe.x, y = event.clientY - swipe.y;
      if (!swipe.horizontal) {
        if (Math.abs(y) > 10 && Math.abs(y) >= Math.abs(x)) { this.cancelSwipe(); return; }
        if (Math.abs(x) <= 10 || Math.abs(x) < Math.abs(y) * 1.4) return;
        swipe.horizontal = true;
        this.el.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
    }, { passive: false });
    this.registerDomEvent(doc, 'pointerup', event => {
      const swipe = this.swipe;
      if (!swipe || event.pointerId !== swipe.id) return;
      const x = event.clientX - swipe.x, y = event.clientY - swipe.y;
      this.cancelSwipe();
      if (!swipe.horizontal) return;
      event.preventDefault();
      if (Math.abs(x) >= 32 && Math.abs(x) > Math.abs(y) * 1.4 && swipe.member === this.members()[this.activeIndex()]) this.advance(x < 0 ? 1 : -1);
    }, { passive: false });
    this.registerDomEvent(doc, 'pointercancel', event => { if (event.pointerId === this.swipe?.id) this.cancelSwipe(); });
    this.registerDomEvent(this.el, 'lostpointercapture', event => { if (event.pointerId === this.swipe?.id) this.cancelSwipe(); });
    this.registerDomEvent(this.el, 'click', event => {
      if (event.detail > 0 && Date.now() < this.suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    this.registerDomEvent(this.el, 'wheel', event => {
      if (event.ctrlKey || this.swipe || this.members().length < 2) { this.wheel.reset(); return; }
      // Vertical scrolling and pinch-to-zoom stay native and cannot prolong a swipe.
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.4) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.el.clientWidth : 1;
      const step = this.wheel.accept(event.deltaX * unit);
      if (step) this.advance(step);
    }, { passive: false });
    this.registerDomEvent(win, 'blur', () => { this.cancelSwipe(); this.wheel.reset(); });
  }

  private members(): string[] { return this.plugin.settings.widgets[this.id]?.members || []; }
  private activeIndex(): number { return Math.max(0, this.members().indexOf(this.plugin.settings.widgets[this.id]?.activeMember || '')); }

  private cancelSwipe(): void {
    const swipe = this.swipe;
    this.swipe = null;
    this.el.removeClass('is-swiping');
    if (!swipe) return;
    if (swipe.horizontal) this.suppressClickUntil = Date.now() + 500;
    if (this.el.hasPointerCapture(swipe.id)) this.el.releasePointerCapture(swipe.id);
  }

  private advance(step: number): void {
    const members = this.members();
    if (members.length < 2) return;
    this.plugin.selectStackWidget(this.id, members[(this.activeIndex() + step + members.length) % members.length]);
  }

  render(): void {
    const members = this.members(), index = this.activeIndex();
    const hidden = members.length < 2 || !this.plugin.settings.widgets[this.id]?.enabled;
    const names = members.map(member => {
      const widget = this.plugin.settings.widgets[member];
      return widget ? widgetName(widget) + (widget.view ? ` · ${widget.view}` : '') : 'Item';
    });
    const icons = members.map(member => {
      const widget = this.plugin.settings.widgets[member];
      return WIDGET_ICONS[widget?.type || 'widget-stack'];
    });
    const signature = JSON.stringify([members, names, icons, index, hidden]);
    if (signature === this.signature) return;
    this.signature = signature;
    const focused = this.indicators.contains(this.el.ownerDocument.activeElement);
    this.el.hidden = hidden;
    if (this.el.hidden) { this.cancelSwipe(); this.wheel.reset(); }
    // A sliding window keeps even a large stack within the smallest grid slot.
    const start = Math.max(0, Math.min(index - 2, members.length - 5));
    this.buttons.forEach((button, offset) => {
      const member = members[start + offset];
      button.hidden = !member;
      if (!member) { delete button.dataset.member; button.tabIndex = -1; return; }
      button.dataset.member = member;
      const position = start + offset, current = position === index;
      const name = names[position], icon = this.icons[offset];
      if (icon.dataset.icon !== icons[position]) {
        setIcon(icon, icons[position]);
        icon.dataset.icon = icons[position];
      }
      updateTooltip(button, `${name} · ${position + 1} of ${members.length}`);
      button.setAttribute('aria-label', `Show ${name}, ${position + 1} of ${members.length}`);
      if (current) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
      button.tabIndex = current ? 0 : -1;
      button.toggleClass('is-continuation', !current && ((offset === 0 && start > 0) || (offset === 4 && start + 5 < members.length)));
    });
    if (!hidden && focused && members[index]) this.buttons.find(button => button.dataset.member === members[index])?.focus({ preventScroll: true });
    updateText(this.status, !hidden ? `${names[index]}, ${index + 1} of ${members.length}` : '');
  }
  onunload(): void { this.cancelSwipe(); this.wheel.reset(); this.buttons = []; this.icons = []; this.el.remove(); }
}
