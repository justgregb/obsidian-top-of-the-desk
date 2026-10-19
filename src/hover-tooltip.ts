import { Component } from 'obsidian';
import { HOVER_DELAY_MS, updateText } from './ui';

/** One reusable portal per surface. The anchor already supplies its accessible name. */
export class HoverTooltip extends Component {
  private el: HTMLElement | null = null;
  private anchor: HTMLElement | null = null;
  private label: (() => string) | null = null;
  private timer = 0;
  private stopped = false;

  constructor(private doc: Document) { super(); }

  schedule(anchor: HTMLElement, label: () => string): void {
    if (this.anchor === anchor) return;
    this.hide(); this.anchor = anchor; this.label = label;
    this.timer = this.doc.defaultView!.setTimeout(() => {
      this.timer = 0;
      if (anchor.matches(':hover')) this.show(anchor, label);
      else this.hide();
    }, HOVER_DELAY_MS);
  }

  show(anchor: HTMLElement, label: () => string): void {
    this.cancelTimer();
    if (this.stopped || !anchor.isConnected || anchor.matches(':disabled') ||
        anchor.closest('[hidden], [inert]') || !anchor.getClientRects().length) { this.hide(); return; }
    const text = label();
    if (!text) { this.hide(); return; }
    this.anchor = anchor; this.label = label;
    const el = this.el ??= this.doc.body.createDiv({ cls: 'tod-tooltip', attr: { role: 'tooltip', 'aria-hidden': 'true' } });
    updateText(el, text); el.hidden = false;
    const bounds = anchor.getBoundingClientRect(), tip = el.getBoundingClientRect();
    const width = this.doc.documentElement.clientWidth, height = this.doc.documentElement.clientHeight;
    const left = Math.max(8, Math.min(bounds.left + (bounds.width - tip.width) / 2, width - tip.width - 8));
    const preferredTop = bounds.top >= tip.height + 16 ? bounds.top - tip.height - 8 : bounds.bottom + 8;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(Math.max(8, Math.min(preferredTop, height - tip.height - 8)))}px`;
  }

  /** Refresh changed copy without restarting a pending hover or remeasuring unchanged text. */
  refresh(): void {
    if (!this.anchor) return;
    if (!this.anchor.isConnected || this.anchor.matches(':disabled') || this.anchor.closest('[hidden], [inert]') || !this.anchor.getClientRects().length) { this.hide(); return; }
    if (this.el && !this.el.hidden && this.label && this.el.textContent !== this.label()) this.show(this.anchor, this.label);
  }

  hideFor(anchor: HTMLElement): void { if (this.anchor === anchor) this.hide(); }
  hide(): void {
    this.cancelTimer(); this.anchor = null; this.label = null;
    if (this.el) this.el.hidden = true;
  }
  private cancelTimer(): void {
    if (this.timer) this.doc.defaultView!.clearTimeout(this.timer);
    this.timer = 0;
  }
  onunload(): void { this.stopped = true; this.hide(); this.el?.remove(); this.el = null; }
}
