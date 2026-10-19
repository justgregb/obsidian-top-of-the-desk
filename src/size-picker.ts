import { COPY, sizeLabel } from './copy';
import { Component } from 'obsidian';
import { UndoOrigin, undoOrigin } from './undo-notice';
import type { WidgetSize } from './model';
import { WIDGET_HEIGHTS, normalizeWidgetRows } from './widget-sizing';
import { updateText } from './ui';

/** One size picker for every desk item, limited to the columns currently available. */
export class WidgetSizePicker extends Component {
  private anchor: HTMLElement | null = null;
  private dismiss: ((restoreFocus: boolean) => void) | null = null;

  open(anchor: HTMLElement, current: WidgetSize, choose: (size: WidgetSize, origin?: UndoOrigin) => void, availableColumns = 4): void {
    if (this.anchor === anchor) { this.close(true); return; }
    this.close(false);
    this.anchor = anchor;
    const doc = anchor.ownerDocument, win = doc.defaultView!;
    const popup = doc.body.createDiv({ cls: 'tod-size-picker', attr: { role: 'dialog', 'aria-label': COPY.resize } });
    const maxColumns = Math.max(1, Math.min(4, availableColumns));
    const heights: number[] = WIDGET_HEIGHTS.map(size => size.rows);
    popup.style.setProperty('--tod-size-columns', String(maxColumns));
    popup.createDiv({ cls: 'tod-size-picker-title', text: COPY.resize });
    const grid = popup.createDiv({ cls: 'tod-size-picker-grid', attr: { role: 'radiogroup', 'aria-label': 'Width and height' } });
    const caption = popup.createDiv({ cls: 'tod-size-picker-caption', attr: { 'aria-live': 'polite', 'aria-atomic': 'true' } });
    const cells: { button: HTMLButtonElement; size: WidgetSize }[] = [];
    const initial: WidgetSize = { columns: Math.min(current.columns, maxColumns) as WidgetSize['columns'], rows: normalizeWidgetRows(current.rows) };
    const show = (size: WidgetSize) => {
      // The table is the preview: fill the rectangle up to the chosen cell.
      for (const cell of cells) cell.button.toggleClass('is-highlighted', cell.size.columns <= size.columns && cell.size.rows <= size.rows);
      updateText(caption, sizeLabel(size.columns, size.rows, 'compact'));
    };
    const focus = (size: WidgetSize) => {
      for (const cell of cells) cell.button.tabIndex = cell.size.columns === size.columns && cell.size.rows === size.rows ? 0 : -1;
      cells.find(cell => cell.button.tabIndex === 0)?.button.focus({ preventScroll: true });
      show(size);
    };
    for (const row of heights) {
      for (let column = 1; column <= maxColumns; column++) {
        const size = { columns: column, rows: row } as WidgetSize;
        const selected = column === initial.columns && row === initial.rows;
        const button = grid.createEl('button', { cls: 'tod-size-cell', attr: {
          type: 'button', role: 'radio', 'aria-label': sizeLabel(column, row),
          'aria-checked': String(selected), tabindex: selected ? '0' : '-1',
        } });
        cells.push({ button, size });
        button.addEventListener('pointerenter', () => show(size));
        button.addEventListener('focus', () => show(size));
        button.addEventListener('click', event => { const origin = undoOrigin(event); this.close(true); choose(size, origin); });
        button.addEventListener('keydown', event => {
          let columns = size.columns, rows = size.rows;
          if (event.key === 'ArrowLeft') columns = Math.max(1, columns - 1) as WidgetSize['columns'];
          else if (event.key === 'ArrowRight') columns = Math.min(maxColumns, columns + 1) as WidgetSize['columns'];
          else if (event.key === 'ArrowUp') rows = heights[Math.max(0, heights.indexOf(rows) - 1)];
          else if (event.key === 'ArrowDown') rows = heights[Math.min(heights.length - 1, heights.indexOf(rows) + 1)];
          else if (event.key === 'Home') { columns = 1; rows = heights[0]; }
          else if (event.key === 'End') { columns = maxColumns as WidgetSize['columns']; rows = heights[heights.length - 1]; }
          else return;
          event.preventDefault(); event.stopPropagation(); focus({ columns, rows });
        });
      }
    }
    grid.addEventListener('pointerleave', () => {
      const focused = cells.find(cell => cell.button === doc.activeElement);
      show(focused?.size ?? initial);
    });
    show(initial);
    anchor.setAttribute('aria-expanded', 'true');
    anchor.closest('.tod-widget-controls')?.addClass('has-expanded-control');

    const rect = anchor.getBoundingClientRect();
    const bounds = popup.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.right - bounds.width, win.innerWidth - bounds.width - 8));
    const below = rect.bottom + 6;
    const top = below + bounds.height <= win.innerHeight - 8 ? below : Math.max(8, rect.top - bounds.height - 6);
    popup.style.left = `${left}px`; popup.style.top = `${top}px`;

    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popup.contains(target) && !anchor.contains(target)) this.close(false);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(true); }
      else if (event.key === 'Tab') this.close(true);
    };
    const moved = (event: Event) => { if (!popup.contains(event.target as Node)) this.close(false); };
    const blurred = () => this.close(false);
    const focusOutside = (event: FocusEvent) => {
      if (!popup.contains(event.target as Node) && !anchor.contains(event.target as Node)) this.close(false);
    };
    doc.addEventListener('pointerdown', outside, true);
    doc.addEventListener('keydown', keydown, true);
    doc.addEventListener('focusin', focusOutside);
    doc.addEventListener('scroll', moved, true);
    win.addEventListener('resize', blurred);
    win.addEventListener('blur', blurred);
    this.dismiss = restoreFocus => {
      doc.removeEventListener('pointerdown', outside, true);
      doc.removeEventListener('keydown', keydown, true);
      doc.removeEventListener('focusin', focusOutside);
      doc.removeEventListener('scroll', moved, true);
      win.removeEventListener('resize', blurred);
      win.removeEventListener('blur', blurred);
      anchor.setAttribute('aria-expanded', 'false');
      anchor.closest('.tod-widget-controls')?.removeClass('has-expanded-control');
      popup.remove();
      if (restoreFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
    };
    focus(initial);
  }

  close(restoreFocus = false): void {
    const dismiss = this.dismiss;
    this.dismiss = null; this.anchor = null;
    dismiss?.(restoreFocus);
  }
  closeWithin(container: HTMLElement): void { if (this.anchor && container.contains(this.anchor)) this.close(); }
  onunload(): void { this.close(); }
}
