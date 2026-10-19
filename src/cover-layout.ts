import { Component } from 'obsidian';

/** Fit complete preview lines between the fixed identity and metadata rows. */
export class CoverLayout extends Component {
  private observer: ResizeObserver;
  private cards = new Map<HTMLElement, HTMLElement[]>();
  private owners = new Map<Element, HTMLElement>();
  private pending = new Set<HTMLElement>();
  private frame = 0;
  private stopped = false;
  constructor(private host: HTMLElement) {
    super();
    const win = host.ownerDocument.defaultView!;
    this.observer = new win.ResizeObserver(entries => {
      for (const entry of entries) {
        const root = this.owners.get(entry.target);
        if (root) this.queue(root);
      }
    });
  }
  watch(root: HTMLElement): void {
    if (this.cards.has(root)) return;
    const cover = root.matches('.tod-card') ? root : root.querySelector<HTMLElement>('.tod-card');
    if (!cover) return;
    const parts = [cover, ...Array.from(cover.querySelectorAll<HTMLElement>(':scope > .tod-card-heading, :scope > .tod-card-footer'))];
    this.cards.set(root, parts);
    parts.forEach(part => { this.owners.set(part, root); this.observer.observe(part); });
    this.queue(root);
  }
  unwatch(root: HTMLElement): void {
    this.cards.get(root)?.forEach(part => { this.observer.unobserve(part); this.owners.delete(part); });
    this.cards.delete(root); this.pending.delete(root);
  }
  queue(root: HTMLElement): void {
    if (this.stopped || !this.cards.has(root)) return;
    this.pending.add(root);
    if (this.frame) return;
    this.frame = this.host.ownerDocument.defaultView!.requestAnimationFrame(() => { this.frame = 0; this.fit(); });
  }
  private fit(): void {
    const win = this.host.ownerDocument.defaultView!;
    const updates: { preview: HTMLElement; lines: number; height: number }[] = [];
    const pending = [...this.pending]; this.pending.clear();
    for (const root of pending) {
      const cover = this.cards.get(root)?.[0];
      if (!cover?.isConnected || !cover.getClientRects().length) continue;
      const preview = cover.querySelector<HTMLElement>(':scope > .tod-preview, :scope > .tod-collection-description');
      if (!preview) continue;
      const style = win.getComputedStyle(cover), text = win.getComputedStyle(preview);
      const lineHeight = parseFloat(text.lineHeight) || 18;
      const siblings = Array.from(cover.children).filter((el): el is HTMLElement => {
        if (!(el.instanceOf(win.HTMLElement)) || el === preview || el.hidden) return false;
        const siblingStyle = win.getComputedStyle(el);
        return siblingStyle.display !== 'none' && siblingStyle.position !== 'absolute';
      });
      const occupied = siblings.reduce((height, el) => height + el.getBoundingClientRect().height, 0);
      const available = cover.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - occupied - (parseFloat(style.rowGap) || 0) * siblings.length;
      const max = parseInt(style.getPropertyValue('--tod-preview-lines')) || 2;
      const lines = Math.max(0, Math.min(max, Math.floor((available + .1) / lineHeight)));
      updates.push({ preview, lines, height: lines * lineHeight });
    }
    // Batch writes after all measurements to avoid layout thrashing between covers.
    for (const { preview, lines, height } of updates) {
      if (preview.dataset.lines === String(lines) && preview.style.maxHeight === `${height}px`) continue;
      preview.dataset.lines = String(lines);
      preview.style.webkitLineClamp = String(Math.max(1, lines));
      preview.style.maxHeight = `${height}px`;
      preview.style.visibility = lines ? '' : 'hidden';
    }
  }
  onunload(): void {
    this.stopped = true;
    this.observer.disconnect(); this.cards.clear(); this.owners.clear(); this.pending.clear();
    if (this.frame) this.host.ownerDocument.defaultView!.cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}
