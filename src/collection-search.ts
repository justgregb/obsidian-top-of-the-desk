import { Component } from 'obsidian';

/** Keep the same search field mounted while collection rows change. */
export class CollectionSearch extends Component {
  readonly input: HTMLInputElement;
  private query = '';
  private terms: string[] = [];
  private frame = 0;
  constructor(parent: HTMLElement, label: string, changed: () => void) {
    super();
    this.input = parent.createEl('input', { cls: 'tod-collection-search', attr: { type: 'search', placeholder: label, 'aria-label': label.replace(/…$/, ''), autocomplete: 'off', spellcheck: 'false' } });
    this.input.hidden = true;
    this.registerDomEvent(this.input, 'input', () => { this.set(this.input.value);
      if (!this.frame) this.frame = this.input.ownerDocument.defaultView!.requestAnimationFrame(() => { this.frame = 0; changed(); }); });
  }
  get value(): string { return this.query; }
  set(value: string): void {
    this.query = value; this.terms = value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (this.input.value !== value) this.input.value = value;
  }
  show(count: number): void { this.input.hidden = count <= 8 && !this.query && this.input.ownerDocument.activeElement !== this.input; }
  matches(path: string): boolean { const text = path.toLocaleLowerCase(); return this.terms.every(term => text.includes(term)); }
  onunload(): void { if (this.frame) this.input.ownerDocument.defaultView!.cancelAnimationFrame(this.frame); this.frame = 0; this.input.remove(); }
}
