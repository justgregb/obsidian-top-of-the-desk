import { Component } from 'obsidian';
import { HoverTooltip } from './hover-tooltip';

const CONTROLS = '.tod-widget-controls button, button.tod-icon-button, button.tod-open-source, button.tod-add-to-desk, button.tod-resume-note, button.tod-scratch-selection, button.tod-widget-stack-indicator';

/** One owned tooltip for the view's controls, outside clipped card content. */
export class ControlTooltips extends Component {
  private tooltip: HoverTooltip;

  constructor(private root: HTMLElement) {
    super();
    root.addClass('tod-control-tooltip-surface');
    this.register(() => root.removeClass('tod-control-tooltip-surface'));
    const doc = root.ownerDocument, win = doc.defaultView!;
    this.tooltip = this.addChild(new HoverTooltip(doc));
    this.registerDomEvent(root, 'pointerover', event => {
      if (event.pointerType === 'touch') return;
      const button = this.button(event.target);
      if (button) this.tooltip.schedule(button, () => this.label(button));
    });
    this.registerDomEvent(root, 'pointerout', event => {
      const button = this.button(event.target);
      if (button && !button.contains(event.relatedTarget as Node | null)) this.tooltip.hideFor(button);
    });
    this.registerDomEvent(root, 'focusin', event => {
      const button = this.button(event.target);
      if (button?.matches(':focus-visible')) this.tooltip.show(button, () => this.label(button));
    });
    this.registerDomEvent(root, 'focusout', event => {
      const button = this.button(event.target);
      if (button) this.tooltip.hideFor(button);
    });
    this.registerDomEvent(root, 'dragstart', () => this.hide());
    this.registerDomEvent(doc, 'pointerdown', () => this.hide(), true);
    this.registerDomEvent(doc, 'keydown', event => { if (event.key === 'Escape') this.hide(); }, true);
    this.registerDomEvent(doc, 'scroll', () => this.hide(), true);
    this.registerDomEvent(root, 'wheel', () => this.hide(), { passive: true });
    this.registerDomEvent(win, 'resize', () => this.hide());
    this.registerDomEvent(win, 'blur', () => this.hide());
  }

  private button(target: EventTarget | null): HTMLButtonElement | null {
    const button = (target as Element | null)?.closest?.<HTMLButtonElement>(CONTROLS);
    return button && this.root.contains(button) && !button.ownerDocument.body.hasClass('tod-pointer-dragging') && !button.closest('.is-widget-placing, .is-widget-dragging') ? button : null;
  }

  private label(button: HTMLButtonElement): string { return button.dataset.todTooltip || button.getAttribute('aria-label') || ''; }
  refresh(): void { this.tooltip.refresh(); }
  hide(): void { this.tooltip.hide(); }
}
