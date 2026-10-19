import { ControlTooltips } from './control-tooltips';

/** Keep browsers beside their cover, always leaving the activation point exposed. */
export function positionCollectionPopover(el: HTMLElement, anchor: HTMLElement, originY = 0): boolean {
  if (!anchor.isConnected || !anchor.getClientRects().length) return false;
  const win = anchor.ownerDocument.defaultView!, rect = anchor.getBoundingClientRect();
  const visual = win.visualViewport;
  const sheet = win.innerWidth <= 600;
  el.toggleClass('is-sheet', sheet);
  el.setAttribute('aria-modal', String(sheet));
  if (sheet) {
    const width = visual?.width || win.innerWidth, height = visual?.height || win.innerHeight;
    const offsetLeft = visual?.offsetLeft || 0, offsetTop = visual?.offsetTop || 0;
    const panelHeight = Math.min(640, Math.max(0, height - 16), height * 0.8);
    el.style.width = `${Math.max(0, width - 16)}px`; el.style.height = `${panelHeight}px`;
    el.style.maxHeight = `${Math.max(0, height - 16)}px`;
    el.style.left = `${offsetLeft + 8}px`; el.style.top = `${offsetTop + height - panelHeight - 8}px`;
    return true;
  }
  el.style.removeProperty('height');
  const viewportWidth = Math.max(0, win.innerWidth - 32), viewportHeight = Math.max(0, win.innerHeight - 32);
  const above = rect.top - 26, below = win.innerHeight - rect.bottom - 26;
  const before = rect.left - 26, after = win.innerWidth - rect.right - 26;
  let width = Math.min(460, viewportWidth), room: number, placement: 'above' | 'below' | 'left' | 'right';
  let edge: number;
  if (Math.max(above, below) >= 112) {
    placement = above > below ? 'above' : 'below';
    room = Math.max(above, below); edge = placement === 'above' ? rect.top - 10 : rect.bottom + 10;
  } else if (Math.max(before, after) >= 240) {
    placement = before > after ? 'left' : 'right';
    width = Math.min(width, Math.max(before, after)); room = viewportHeight;
    edge = placement === 'left' ? rect.left - 10 : rect.right + 10;
  } else {
    // On a small window, overlap the cover only away from the spot that opened it.
    const point = Math.max(16, Math.min(win.innerHeight - 16, rect.top + rect.height * originY));
    const pointAbove = point - 26, pointBelow = win.innerHeight - point - 26;
    placement = pointAbove > pointBelow ? 'above' : 'below';
    room = Math.max(pointAbove, pointBelow); edge = placement === 'above' ? point - 10 : point + 10;
  }
  el.style.width = `${width}px`;
  el.style.maxHeight = `${Math.max(0, Math.min(380, room, viewportHeight))}px`;
  const bounds = el.getBoundingClientRect();
  const horizontal = placement === 'left' || placement === 'right';
  const left = horizontal ? placement === 'left' ? edge - bounds.width : edge : rect.left + rect.width / 2 - bounds.width / 2;
  const top = horizontal ? rect.top + rect.height / 2 - bounds.height / 2 : placement === 'above' ? edge - bounds.height : edge;
  el.style.left = `${Math.max(16, Math.min(left, win.innerWidth - bounds.width - 16))}px`;
  el.style.top = `${Math.max(16, Math.min(top, win.innerHeight - bounds.height - 16))}px`;
  return true;
}

/** Temporary desk browsers share dismissal and release every global listener on close. */
export function watchPopover(el: HTMLElement, anchor: () => HTMLElement | null, hooks: {
  close(restoreFocus: boolean): void;
  position(): void;
  dragging?(): boolean;
  interacting?(): boolean;
  escape?(): void;
}): () => void {
  const doc = el.ownerDocument, win = doc.defaultView!;
  // Detached browsers sit outside the desk's tooltip surface. Own one shared
  // controller while open, and release its tooltip and listeners on close.
  const tooltips = new ControlTooltips(el);
  tooltips.load();
  hooks.position();
  const backdrop = doc.createElement('div'); backdrop.className = 'tod-browser-backdrop'; backdrop.hidden = !el.hasClass('is-sheet');
  el.before(backdrop);
  const outside = (event: Event) => {
    // A child menu owns focus and outside dismissal until it closes.
    if (hooks.interacting?.()) return;
    if (!hooks.dragging?.() && !el.contains(event.target as Node) && !anchor()?.contains(event.target as Node)) hooks.close(event.target === backdrop);
  };
  const key = (event: KeyboardEvent) => {
    if (event.defaultPrevented || hooks.interacting?.()) return;
    if (event.key === 'Tab' && el.hasClass('is-sheet')) {
      const controls = Array.from(el.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"], a[href]')).filter(control => control.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (first && event.shiftKey && (doc.activeElement === first || !el.contains(doc.activeElement))) { event.preventDefault(); last.focus(); }
      else if (first && !event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    if (event.key !== 'Escape' || (!hooks.escape && hooks.dragging?.())) return;
    event.preventDefault(); event.stopPropagation();
    if (hooks.escape) hooks.escape(); else hooks.close(true);
  };
  const scroll = (event: Event) => { if (!hooks.dragging?.() && !el.contains(event.target as Node)) hooks.close(false); };
  const dragBackdrop = () => { backdrop.hidden = !el.hasClass('is-sheet') || !!hooks.dragging?.(); };
  const resize = () => { hooks.position(); dragBackdrop(); };
  const blur = () => { if (!hooks.dragging?.()) hooks.close(false); };
  doc.addEventListener('pointerdown', outside, true);
  doc.addEventListener('pointermove', dragBackdrop, { passive: true });
  doc.addEventListener('pointerup', dragBackdrop);
  doc.addEventListener('focusin', outside);
  doc.addEventListener('keydown', key);
  doc.addEventListener('scroll', scroll, true);
  win.addEventListener('resize', resize);
  win.visualViewport?.addEventListener('resize', resize);
  win.visualViewport?.addEventListener('scroll', resize);
  win.addEventListener('blur', blur);
  return () => {
    tooltips.unload(); backdrop.remove();
    doc.removeEventListener('pointerdown', outside, true);
    doc.removeEventListener('pointermove', dragBackdrop);
    doc.removeEventListener('pointerup', dragBackdrop);
    doc.removeEventListener('focusin', outside);
    doc.removeEventListener('keydown', key);
    doc.removeEventListener('scroll', scroll, true);
    win.removeEventListener('resize', resize);
    win.visualViewport?.removeEventListener('resize', resize);
    win.visualViewport?.removeEventListener('scroll', resize);
    win.removeEventListener('blur', blur);
  };
}
