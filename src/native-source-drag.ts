import { TFile, TFolder, type App } from 'obsidian';
import type { DeskSource } from './widget-layout';
import { fileSourceType, sourceWebUrl } from './source-types';

/** Obsidian's explorer and bookmarks drag payloads refer to existing vault sources. */
export interface NativeDraggable {
  type?: string;
  file?: { path?: string };
  files?: { path?: string }[];
  linktext?: string;
  title?: string;
  items?: { item: { type?: string; path?: string; url?: string; title?: string } }[];
}

export function deskSourcesForDrag(app: App, drag?: NativeDraggable | null): { sources: DeskSource[]; unsupported: boolean } | null {
  if (!drag) return null;
  const fileSource = (path?: string): DeskSource | null => {
    if (typeof path !== 'string') return null;
    const file = path === '/' ? app.vault.getRoot() : app.vault.getAbstractFileByPath(path);
    const kind = file instanceof TFolder ? 'folder' : file instanceof TFile ? fileSourceType(file.extension) : null;
    return kind ? { kind, path } : null;
  };
  const webSource = (value?: string, title?: string): DeskSource | null => {
    const path = sourceWebUrl(value);
    return path ? { kind: 'web', path, title: typeof title === 'string' ? title.replace(/[\x00-\x1f]/g, '').trim().slice(0, 100) : '' } : null;
  };
  let candidates: (DeskSource | null)[];
  if (drag.type === 'file' || drag.type === 'folder') candidates = [fileSource(drag.file?.path)];
  else if (drag.type === 'files') candidates = (drag.files || []).map(file => fileSource(file.path));
  else if (drag.type === 'link') candidates = [drag.file ? fileSource(drag.file.path) : webSource(drag.linktext, drag.title)];
  else if (drag.type === 'bookmarks') candidates = (drag.items || []).map(({ item }) =>
    item.type === 'file' || item.type === 'folder' ? fileSource(item.path) : item.type === 'url' ? webSource(item.url, item.title) : null);
  else return null;
  if (!candidates.length) return null;
  // Reject a mixed unsupported selection as a whole; never silently drop only part of it.
  if (candidates.some(source => !source)) return { sources: [], unsupported: true };
  const unique = new Map<string, DeskSource>();
  for (const source of candidates) if (source) unique.set(`${source.kind}:${source.path}`, source);
  return { sources: [...unique.values()], unsupported: false };
}
