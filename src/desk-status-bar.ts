import { App, Component } from 'obsidian';

/** Track the active desk per window without a document-wide relational selector. */
export class DeskStatusBar extends Component {
  private documents = new Set<Document>();
  private frame = 0;
  private stopped = false;
  constructor(private app: App, private viewType: string) { super(); }
  onload(): void {
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.queue()));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.queue()));
    this.app.workspace.onLayoutReady(() => this.queue());
  }
  private queue(): void {
    if (this.stopped || this.frame) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      const current = new Set<Document>();
      this.app.workspace.iterateAllLeaves(leaf => { current.add(leaf.view.containerEl.ownerDocument); });
      for (const doc of this.documents) if (!current.has(doc)) doc.body.removeClass('tod-desk-active');
      for (const doc of current) {
        doc.body.toggleClass('tod-desk-active', !!doc.querySelector(`.workspace-leaf.mod-active > .workspace-leaf-content[data-type="${this.viewType}"]`));
      }
      this.documents = current;
    });
  }
  onunload(): void {
    this.stopped = true;
    if (this.frame) window.cancelAnimationFrame(this.frame);
    for (const doc of this.documents) doc.body.removeClass('tod-desk-active');
    this.documents.clear();
  }
}
