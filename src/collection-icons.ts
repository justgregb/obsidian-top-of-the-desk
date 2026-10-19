import { addIcon, setIcon } from 'obsidian';

type CollectionKind = 'folder' | 'stack';
const STACK_ICON = 'files';

/** Keep navigation, sizing, and removal visually distinct across desk actions. */
export const DESK_ACTION_ICONS = {
  edit: 'sliders-horizontal',
  resize: 'top-of-the-desk-resize',
  more: 'ellipsis',
  showOnDesk: 'locate',
  remove: 'archive',
} as const;

// Match the native file icon's 24-unit grid, 2-unit stroke, and 20-unit major axis.
// Portrait pages and landscape folders retain their natural proportions.
const GLYPHS = {
  'resize': '<path d="M4 10V4h6M14 20h6v-6M4 4l16 16"/>',
  'folder-closed': '<path d="M2 18V6a2 2 0 0 1 2-2h4l2 2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z"/><path d="M2 10h20"/>',
  'folder-open': '<path d="M2 18V6a2 2 0 0 1 2-2h4l2 2h10a2 2 0 0 1 2 2v2"/><path d="m2 18 4-7h15a1 1 0 0 1 .9 1.45l-3.2 6.45A2 2 0 0 1 17 20H4a2 2 0 0 1-2-2Z"/>',
  'unstack': '<rect x="2" y="12" width="8" height="10" rx="1.5"/><rect x="14" y="2" width="8" height="10" rx="1.5"/><path d="M9 3H3v6M3 3l6 6M15 21h6v-6M21 21l-6-6"/>',
  'pdf': '<path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M14 2v6h6"/><g stroke-width="1.4"><path d="M6 18v-6h1.5a1.5 1.5 0 0 1 0 3H6"/><path d="M11 12v6h1a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2Z"/><path d="M18 12h-2v6m0-3h2"/></g>',
};

/** Custom glyphs share the same stroke and scale as native action icons. */
export function registerDeskIcons(): void {
  for (const [name, paths] of Object.entries(GLYPHS)) {
    // Obsidian registers custom glyphs in a 100-unit viewBox.
    addIcon(`top-of-the-desk-${name}`, `<g transform="scale(${100 / 24})" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`);
  }
}

export function setCollectionIcon(el: HTMLElement, kind: CollectionKind, open: boolean): void {
  const state = kind === 'stack' ? 'stack' : `${kind}-${open ? 'open' : 'closed'}`;
  if (el.dataset.collectionIcon === state) return;
  setIcon(el, kind === 'stack' ? STACK_ICON : `top-of-the-desk-${state}`);
  el.dataset.collectionIcon = state;
}

/** Separated cards and outward arrows describe releasing the whole stack. */
export function setUnstackIcon(el: HTMLElement): void {
  setIcon(el, 'top-of-the-desk-unstack');
}
