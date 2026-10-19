/** A shared empty state; keep its action mounted during background refreshes. */
export class WidgetEmptyState {
  readonly el: HTMLElement;
  readonly message: HTMLParagraphElement;
  readonly button: HTMLButtonElement;

  constructor(parent: HTMLElement, message: string, action?: { label: string; run: () => void }) {
    this.el = parent.createDiv('tod-empty-state');
    const copy = this.el.createDiv('tod-empty-copy');
    this.message = copy.createEl('p', { text: message });
    this.button = copy.createEl('button', { text: action?.label ?? '', attr: { type: 'button' } });
    this.button.hidden = !action;
    this.button.onclick = () => action?.run();
  }
}
