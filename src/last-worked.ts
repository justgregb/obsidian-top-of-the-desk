import { isUnknownArray } from './validation';
import type { App } from 'obsidian';
import { DeskItem, deskPaths, renamePath, safePath } from './model';

const STORAGE = 'top-of-the-desk:last-worked';

/** Local edit order only. Opening, previewing, or syncing a file is not work. */
export class LastWorkedNotes {
  private paths: string[] = [];

  constructor(private app: App) {
    try {
      const stored: unknown = app.loadLocalStorage(STORAGE);
      if (isUnknownArray(stored)) this.paths = [...new Set(stored.filter((path): path is string => typeof path === 'string' && !!safePath(path, 'md')))].slice(0, 300);
    } catch (error) { console.error('Top of the Desk: could not load the last-worked marker', error); }
  }

  record(path: string): boolean {
    if (!safePath(path, 'md') || this.paths[0] === path) return false;
    this.paths = [path, ...this.paths.filter(previous => previous !== path)].slice(0, 300);
    this.save(); return true;
  }

  current(items: DeskItem[]): string | null {
    const notes = new Set(deskPaths(items));
    const folders = items.filter(item => item.type === 'folder');
    return this.paths.find(path => (notes.has(path) || folders.some(folder => folder.path === '/' || path.startsWith(folder.path + '/'))) && !!this.app.vault.getFileByPath(path)) ?? null;
  }

  rename(previous: string, next: string): void {
    const paths = [...new Set(this.paths.map(path => renamePath(path, previous, next)))];
    if (paths.every((path, index) => path === this.paths[index])) return;
    this.paths = paths; this.save();
  }

  remove(path: string): void {
    const paths = this.paths.filter(entry => entry !== path && !entry.startsWith(path + '/'));
    if (paths.length === this.paths.length) return;
    this.paths = paths; this.save();
  }

  private save(): void {
    try { this.app.saveLocalStorage(STORAGE, this.paths); }
    catch (error) { console.error('Top of the Desk: could not save the last-worked marker', error); }
  }
}
