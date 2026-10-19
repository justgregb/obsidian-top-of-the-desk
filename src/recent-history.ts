import { isRecord, isUnknownArray } from './validation';
import { TFolder, type App } from 'obsidian';
import { fileSourceType } from './source-types';
import { renamePath, safePath } from './model';

const STORAGE = 'top-of-the-desk:recents';
interface OpenedItem { kind: 'file' | 'folder'; path: string; openedAt: number | null; }
const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

interface RecentGroup { key: 'today' | 'earlier'; label: string; }

/** Compute local-calendar bounds once for a whole history/search refresh. */
export function recentWindow(now = new Date()): (openedAt: number | null) => RecentGroup | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const earliest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime(), latest = now.getTime();
  return openedAt => {
    if (openedAt === null || !Number.isSafeInteger(openedAt) || openedAt < earliest || openedAt > latest) return null;
    return openedAt >= today ? { key: 'today', label: 'Today' } : { key: 'earlier', label: 'Earlier' };
  };
}

/** One window for every source: today and the previous six local calendar days. */
export function recentGroup(openedAt: number | null, now = new Date()): RecentGroup | null {
  return recentWindow(now)(openedAt);
}

/** Opening time is recorded locally; legacy entries never borrow a modification date. */
export class RecentHistory {
  entries: OpenedItem[] = [];
  private day = dayKey(new Date());
  constructor(private app: App) {
    const stored: unknown = app.loadLocalStorage(STORAGE);
    const input = isUnknownArray(stored) ? stored : app.workspace.getLastOpenFiles();
    const seen = new Set<string>();
    for (const raw of input) {
      const value = isRecord(raw) ? raw : {};
      const kind = value?.kind === 'folder' ? 'folder' : 'file';
      const rawPath = typeof raw === 'string' ? raw : value.path;
      const path = kind === 'folder' && rawPath === '/' ? '/' : safePath(rawPath);
      if (!path || seen.has(path) || kind === 'file' && !fileSourceType(path.split('.').pop() || '')) continue;
      seen.add(path);
      this.entries.push({ path, kind, openedAt: typeof value?.openedAt === 'number' && Number.isSafeInteger(value.openedAt) && value.openedAt > 0 && value.openedAt <= 8640000000000000 ? value.openedAt : null });
      if (this.entries.length === 100) break;
    }
  }
  open(path: string): void {
    const file = this.app.vault.getFileByPath(path);
    if (!file || !fileSourceType(file.extension)) return;
    this.record({ kind: 'file', path, openedAt: Date.now() });
  }
  openFolder(path: string): boolean {
    const folder = path === '/' ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(path);
    if (!(folder instanceof TFolder)) return false;
    this.record({ kind: 'folder', path, openedAt: Date.now() });
    return true;
  }
  private record(entry: OpenedItem): void {
    this.entries = [entry, ...this.entries.filter(item => item.path !== entry.path)].slice(0, 100);
    this.save();
  }
  rename(previous: string, next: string): void {
    this.entries = this.entries.map(entry => {
      const path = renamePath(entry.path, previous, next);
      return { ...entry, path };
    }).filter(entry => entry.kind === 'folder' || !!fileSourceType(entry.path.split('.').pop() || ''));
    this.save();
  }
  dayChanged(): boolean { const day = dayKey(new Date()); if (day === this.day) return false; this.day = day; return true; }
  /** All supported sources share seven local calendar days, including today. */
  group(openedAt: number | null, now = new Date()): ReturnType<typeof recentGroup> { return recentGroup(openedAt, now); }
  private save(): void { this.app.saveLocalStorage(STORAGE, this.entries); }
}
