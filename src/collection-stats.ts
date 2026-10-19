import { TFile, TFolder } from 'obsidian';

/** Collect references from the loaded folder tree without reading note contents. */
export function notesInFolder(folder: TFolder): TFile[] {
  const folders = [folder], notes: TFile[] = [];
  while (folders.length) {
    for (const child of folders.pop()!.children) {
      if (child instanceof TFolder) folders.push(child);
      else if (child instanceof TFile && child.extension.toLowerCase() === 'md') notes.push(child);
    }
  }
  return notes;
}
