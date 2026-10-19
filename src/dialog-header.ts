import { Modal, setIcon, setTooltip } from 'obsidian';

/** Keep the title and close action in one row, like the collection browsers. */
export function setupDialogHeader(modal: Modal): void {
  modal.modalEl.addClass('tod-widget-dialog');
  let header = modal.titleEl.parentElement;
  if (!header?.hasClass('modal-header')) {
    header = modal.modalEl.createDiv('modal-header');
    modal.titleEl.before(header);
    header.appendChild(modal.titleEl);
  }
  header.addClass('tod-dialog-heading');
  // Obsidian uses different names for its floating close control across versions.
  for (const control of Array.from(modal.modalEl.children)) {
    if (control.matches('.modal-header-button, .modal-close-button')) control.remove();
  }
  header.querySelector('.tod-dialog-close')?.remove();
  const close = header.createEl('button', { cls: 'tod-dialog-close', attr: { type: 'button', 'aria-label': 'Close' } });
  setIcon(close, 'x'); setTooltip(close, 'Close');
  close.onclick = () => modal.close();
}
