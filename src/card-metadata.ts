/** Content metadata wraps independently of the fixed source-action column. */
export function createCardMetadata(parent: HTMLElement): { footer: HTMLElement; metadata: HTMLElement; actions: HTMLElement } {
  const footer = parent.createDiv('tod-card-footer');
  const metadata = footer.createDiv('tod-metadata-group');
  const actions = footer.createDiv('tod-metadata-actions');
  return { footer, metadata, actions };
}
