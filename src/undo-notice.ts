import { Notice } from 'obsidian';

/** Snapshot the action before its control or popover is removed. */
export interface UndoOrigin {
  doc: Document;
  x: number;
  y: number;
  touch?: boolean;
  keyboard?: boolean;
  anchor?: HTMLElement;
  fallback?: HTMLElement;
}

export function undoOrigin(event: MouseEvent | KeyboardEvent, anchor?: HTMLElement): UndoOrigin | undefined {
  anchor ??= (event.currentTarget as HTMLElement)?.getBoundingClientRect ? event.currentTarget as HTMLElement : event.target as HTMLElement;
  if (!anchor?.ownerDocument || !anchor.getBoundingClientRect) return;
  const doc = anchor.ownerDocument, rect = anchor.getBoundingClientRect();
  const pointer = 'clientX' in event && (event.detail > 0 || event.type === 'drop' || event.type.startsWith('pointer'));
  return {
    doc, anchor, keyboard: !pointer, fallback: anchor.closest<HTMLElement>('.tod-widget') || doc.querySelector<HTMLElement>('.tod-widgets') || undefined,
    x: pointer ? event.clientX : rect.left + rect.width / 2,
    y: pointer ? event.clientY : rect.bottom,
    touch: pointer && (('pointerType' in event && event.pointerType === 'touch') || !!doc.defaultView?.matchMedia('(pointer: coarse)').matches)
  };
}

/** A short-lived, single-use Undo; callers retain only the state they changed. */
export class UndoNotice {
  private dismiss: (() => void) | null = null;

  clear(): void { this.dismiss?.(); this.dismiss = null; }

  show(message: string, restore: () => void, origin?: UndoOrigin): void {
    this.clear();
    const doc = origin?.doc ?? document, win = doc.defaultView!;
    const fragment = doc.adoptNode(createFragment());
    const row = doc.adoptNode(createFragment()).createDiv();
    row.className = 'tod-undo-notice'; fragment.appendChild(row);
    row.createSpan({ text: message, attr: { role: 'status', 'aria-live': 'polite' } });
    const button = row.createEl('button', { text: 'Undo', attr: { type: 'button', 'aria-label': `Undo: ${message}` } });
    let notice: Notice | undefined;
    const position = () => {
      if (!origin) return;
      const viewport = win.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 12, topEdge = (viewport?.offsetTop ?? 0) + 12;
      const rightEdge = leftEdge + (viewport?.width ?? win.innerWidth) - 24;
      const bottomEdge = topEdge + (viewport?.height ?? win.innerHeight) - 24;
      row.style.maxWidth = `${Math.max(0, Math.min(300, rightEdge - leftEdge))}px`;
      const bounds = row.getBoundingClientRect();
      // Keep Undo itself within a short reach of the action, without covering the
      // pointer or following it. Flip above the action near the bottom or on touch.
      const left = origin.x + button.getBoundingClientRect().width / 2 + 10 - bounds.width;
      const below = origin.y + 26, above = origin.y - bounds.height - 26;
      const top = origin.touch || below + bounds.height > bottomEdge ? above : below;
      row.style.left = `${Math.max(leftEdge, Math.min(left, rightEdge - bounds.width))}px`;
      row.style.top = `${Math.max(topEdge, Math.min(top, bottomEdge - bounds.height))}px`;
    };
    if (origin) {
      row.addClass('tod-undo-popup'); doc.body.appendChild(row); position();
      win.addEventListener('resize', position);
      win.visualViewport?.addEventListener('resize', position);
      win.visualViewport?.addEventListener('scroll', position);
    } else notice = new Notice(fragment, 0);
    let timer = 0, active = true, remaining = 4000, deadline = 0;
    const pause = () => {
      if (!timer) return;
      remaining = Math.max(0, deadline - win.performance.now());
      win.clearTimeout(timer); timer = 0;
    };
    const clear = () => {
      if (!active) return;
      active = false; pause(); button.onclick = null;
      win.removeEventListener('resize', position);
      win.visualViewport?.removeEventListener('resize', position);
      win.visualViewport?.removeEventListener('scroll', position);
      doc.removeEventListener('pointerdown', outside, true);
      doc.removeEventListener('scroll', outside, true);
      doc.removeEventListener('keydown', escape);
      if (notice) notice.hide(); else row.remove();
      if (this.dismiss === clear) this.dismiss = null;
    };
    const resume = () => {
      pause();
      if (active && !button.matches(':hover') && !row.contains(doc.activeElement)) {
        deadline = win.performance.now() + remaining;
        timer = win.setTimeout(clear, remaining);
      }
    };
    const outside = (event: Event) => { if (!row.contains(event.target as Node)) clear(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') clear(); };
    doc.addEventListener('pointerdown', outside, true);
    doc.addEventListener('scroll', outside, true);
    doc.addEventListener('keydown', escape);
    // Only intentional use of Undo pauses expiry; moving across the message does not.
    button.addEventListener('pointerenter', pause);
    button.addEventListener('pointerleave', resume);
    row.addEventListener('focusin', pause);
    row.addEventListener('focusout', () => win.queueMicrotask(resume));
    const focusKey = origin?.anchor?.dataset.focusKey;
    const refocus = () => {
      const anchor = origin?.anchor;
      const restored = anchor?.isConnected ? anchor : focusKey
        ? Array.from(doc.querySelectorAll<HTMLElement>('[data-focus-key]')).find(el => el.dataset.focusKey === focusKey) : null;
      const target = restored?.getClientRects().length ? restored : origin?.fallback?.getClientRects().length ? origin.fallback : doc.querySelector<HTMLElement>('.tod-add-to-desk');
      target?.focus({ preventScroll: true });
    };
    button.onclick = event => {
      event.stopPropagation();
      if (active) { clear(); restore(); if (event.detail === 0) refocus(); }
    };
    row.onkeydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); clear(); refocus(); }
    };
    this.dismiss = clear;
    if (origin?.keyboard && !origin.anchor?.isConnected) button.focus({ preventScroll: true });
    resume();
  }
}
