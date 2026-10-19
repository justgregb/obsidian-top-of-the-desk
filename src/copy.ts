import type { WidgetKey } from './model';
import { COMPACT_HEIGHT, WIDGET_HEIGHTS, normalizeWidgetRows } from './widget-sizing';

/** Shared wording for actions and states that appear in more than one place. */
export const COPY = {
  addToDesk: 'Add to desk',
  add: 'Add',
  create: 'Create',
  rename: 'Rename',
  name: 'Name',
  deskOnly: 'Changes apply only to the desk.',
  edit: 'Edit',
  resize: 'Resize',
  move: 'Move',
  open: 'Open',
  actions: 'Actions',
  showInFiles: 'Show in Files',
  preview: 'Preview',
  resume: 'Resume',
  addWebsite: 'Add website',
  showOnDesk: 'Show on desk',
  removeFromDesk: 'Remove from desk',
  removedFromDesk: 'Removed from desk',
  restoreToDesk: 'Restore to desk',
  chooseFolder: 'Choose folder',
  openScratchpad: 'Open scratchpad',
  tryAgain: 'Try again',
  hideHeading: 'Hide heading',
  hideBaseControls: 'Hide Base toolbar',
  enableDailyNotes: 'Turn on Daily notes in Obsidian’s core plugin settings.',
  noteUnavailable: 'This note is no longer available.',
  folderUnavailable: 'This folder is no longer available.',
  stack: 'Stack',
  newStack: 'New stack',
  addNotes: 'Add notes',
  addToStack: 'Add to stack',
  unstack: 'Unstack',
  stackMinimum: 'Choose at least two notes.',
  emptyFolder: 'This folder is empty.',
  noMatchingNotes: 'No matching notes.',
  emptyRecents: 'Files, folders, and websites opened in the last 7 days appear here.',
} as const;

export const DRAFT_COPY = {
  conflict: 'This note changed elsewhere. Save your draft as a new note to keep both versions.',
  opening: 'Opening note…',
  saving: 'Saving…',
  saveAsNewNote: 'Save draft as new note',
  retry: COPY.tryAgain,
  recoveryError: 'Couldn’t save a backup of your draft. Keep the desk open until the note is saved.',
  readError: 'Couldn’t open this note. Try again.',
  refreshError: 'Couldn’t check for changes to this note. Your draft is still here.',
  saveError: 'Couldn’t save this note. Your draft is still here. Try again.',
  copyError: 'Couldn’t finish saving your draft. It’s still here.',
} as const;

export function draftSaved(path: string): string { return `Draft saved to ${path}`; }
export function formatCount(count: number, unit: 'note' | 'word'): string { return `${count.toLocaleString()} ${Math.abs(count) === 1 ? unit : unit + 's'}`; }
/** The card identifies its source; the action only needs its destination when revealing a folder. */
export function openSourceLabel(type: WidgetKey): string {
  return type === 'folder' ? COPY.showInFiles : COPY.open;
}
export function sizeLabel(columns: number, rows: number, style: 'full' | 'compact' = 'full'): string {
  if (rows === COMPACT_HEIGHT) return `${columns} ${columns === 1 ? 'column' : 'columns'} · compact`;
  const height = WIDGET_HEIGHTS.find(size => size.rows === normalizeWidgetRows(rows))!;
  const label = style === 'compact' ? height.label.replace(/ height$/, '') : height.label;
  return `${columns} ${columns === 1 ? 'column' : 'columns'} · ${label.toLowerCase()}`;
}
