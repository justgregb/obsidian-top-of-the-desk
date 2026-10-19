import { setTooltip } from 'obsidian';

const tooltips = new WeakMap<HTMLElement, string>();
interface ElementBounds { left: number; top: number; width: number; height: number; }
const overlayBounds = new WeakMap<HTMLElement, ElementBounds>();
export const HOVER_DELAY_MS = 400;
export const compareNames = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;

/** Leave unchanged text and tooltip bindings alone during background refreshes. */
export function updateText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.setText(text);
}
export function updateAttribute(el: HTMLElement, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}
/** Drag feedback often stays in the same place while the pointer keeps moving. */
export function updateBounds(el: HTMLElement, bounds: ElementBounds): void {
  const previous = overlayBounds.get(el);
  for (const property of ['left', 'top', 'width', 'height'] as const) {
    // CSS serializes fractional pixels with rounding; compare our measurements
    // instead so an unchanged fractional position doesn't cause another write.
    if (previous?.[property] !== bounds[property]) el.style[property] = `${bounds[property]}px`;
  }
  overlayBounds.set(el, bounds);
}
export function updateTooltip(el: HTMLElement, text: string): void {
  if (tooltips.get(el) === text) return;
  tooltips.set(el, text); el.dataset.todTooltip = text;
  const label = el.getAttribute('aria-label');
  setTooltip(el, text);
  // Toggle names remain stable; their visual tooltip can explain the current state.
  if (el.hasAttribute('aria-pressed') && label) el.setAttribute('aria-label', label);
}

/** Reuse existing rows and their bindings; only move or remove what actually changed. */
export function reconcileChildren(parent: HTMLElement, children: HTMLElement[]): void {
  const wanted = new Set(children);
  const active = parent.ownerDocument.activeElement as HTMLElement | null;
  const focused = active && parent.contains(active) ? active : null;
  for (const child of Array.from(parent.children)) if (!wanted.has(child as HTMLElement)) child.remove();
  for (const [index, child] of children.entries()) {
    const current = parent.children[index];
    if (current !== child) parent.insertBefore(child, current || null);
  }
  if (focused?.isConnected && parent.ownerDocument.activeElement !== focused) focused.focus({ preventScroll: true });
}

/** Shared keyboard movement for folder, recent-note, and stack lists. */
export function navigateList(event: KeyboardEvent, list: HTMLElement, selector: string): void {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target as HTMLElement;
  if (!target.matches(selector)) return;
  const buttons = Array.from(list.querySelectorAll<HTMLButtonElement>(`${selector}:not(:disabled)`));
  const index = buttons.indexOf(target as HTMLButtonElement);
  if (index < 0) return;
  const next = event.key === 'ArrowDown' ? Math.min(buttons.length - 1, index + 1)
    : event.key === 'ArrowUp' ? Math.max(0, index - 1)
    : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
  if (next < 0) return;
  event.preventDefault(); event.stopPropagation(); buttons[next].focus();
}
