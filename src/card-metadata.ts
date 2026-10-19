/** Content metadata wraps independently of the fixed source-action column. */
export function createCardMetadata(parent: HTMLElement): { footer: HTMLElement; metadata: HTMLElement; actions: HTMLElement } {
  const footer = parent.createDiv('tod-card-footer');
  const metadata = footer.createDiv('tod-metadata-group');
  const actions = footer.createDiv('tod-metadata-actions');
  return { footer, metadata, actions };
}

/** Update only when metadata changes; no observer or ancestor selector is needed. */
export function syncCardMetadata(metadata: HTMLElement): void {
  const footer = metadata.parentElement;
  if (!footer?.hasClass('tod-card-footer')) return;
  const actions = footer.querySelector('.tod-metadata-actions');
  const visible = (element: Element | null) => !!element && Array.from(element.children).some(child => !child.hasAttribute('hidden'));
  footer.toggleClass('has-no-actions', !visible(actions));
  footer.toggleClass('is-empty', !visible(metadata) && !visible(actions));
}
