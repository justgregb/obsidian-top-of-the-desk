import { COPY, DRAFT_COPY, draftSaved } from './copy';
import { App, Notice, TFile, moment, normalizePath } from 'obsidian';
import { renamePath, safePath, validRecovery } from './model';
import { ScratchConflict, ScratchStore } from './scratch';
import { formatDeskDate } from './date-format';

const RECOVERY = 'top-of-the-desk:daily-recovery';
const PENDING = RECOVERY + ':pending';
interface DailyCore {
  options: { folder?: string; format?: string; template?: string };
  getFormat(): string;
  getDailyNote(date?: ReturnType<typeof moment>): Promise<TFile | null | undefined>;
}

/** Uses the core plugin to create notes; editing shares the scratchpad's conflict-safe store. */
export class DailyNoteStore {
  store: ScratchStore | null = null;
  path = '';
  error = '';
  available = false;
  busy = false;
  private binding: { path: string } | null = null;
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;
  private syncing: Promise<void> | null = null;
  private creating: Promise<TFile | null> | null = null;
  private stopped = false;
  private noteDateTime = '';
  private status = '';
  private statusStore: ScratchStore | null = null;

  constructor(private app: App, private findNote: (path: string) => TFile | null) {}
  get dateFormat(): string { return this.core()?.getFormat() || 'YYYY-MM-DD'; }
  get displayName(): string {
    return this.store ? this.path.split('/').pop()!.replace(/\.md$/i, '') : formatDeskDate(new Date(), this.dateFormat);
  }
  get displayDateTime(): string { return this.store ? this.noteDateTime : moment().format('YYYY-MM-DD'); }
  private dateForPath(path: string, core: DailyCore): string {
    const folder = core.options.folder || this.app.fileManager.getNewFileParent('').path;
    const prefix = folder && folder !== '/' ? normalizePath(folder) + '/' : '';
    const name = (prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path).replace(/\.md$/i, '');
    const parsed = moment(name, core.getFormat(), true);
    return parsed.isValid() ? parsed.format('YYYY-MM-DD') : '';
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private statusKey(): string { return JSON.stringify([this.path, this.displayDateTime, this.available, this.error, this.busy, this.dateFormat]); }
  private notify(): void {
    this.status = this.statusKey(); this.statusStore = this.store;
    this.listeners.forEach(listener => listener());
  }
  private notifyStatus(): void { if (this.status !== this.statusKey() || this.statusStore !== this.store) this.notify(); }
  private core(): DailyCore | null {
    const app = this.app as unknown as { internalPlugins: { getEnabledPluginById(id: string): DailyCore | null } };
    return app.internalPlugins.getEnabledPluginById('daily-notes');
  }
  private file(path: string): TFile | null {
    return this.findNote(path);
  }
  sync(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.syncing) return this.syncing;
    this.syncing = this.reconcile().catch(() => {
      this.error = 'Couldn’t open today’s note. Check the Daily notes settings.';
      this.notify();
    }).finally(() => { this.syncing = null; });
    return this.syncing;
  }
  private async reconcile(): Promise<void> {
    const core = this.core();
    this.available = !!core;
    if (!core) { this.error = COPY.enableDailyNotes; this.notifyStatus(); return; }
    const today = moment(), name = today.format(core.getFormat());
    const folder = core.options.folder || this.app.fileManager.getNewFileParent('').path;
    const expected = normalizePath((folder && folder !== '/' ? folder + '/' : '') + name + '.md');
    // A draft from yesterday must remain reachable after a restart after midnight.
    const pending = safePath(this.app.loadLocalStorage(PENDING), 'md');
    const recoveredPath = !this.store && pending && validRecovery(this.app.loadLocalStorage(RECOVERY + ':' + pending), pending) ? pending : null;
    const file = this.file(recoveredPath || expected);
    const path = file?.path || recoveredPath || expected;
    this.error = '';
    if (this.store && this.path === path && file) { this.notifyStatus(); return; }
    if (this.store) {
      await this.store.flush();
      if (this.store.dirty) {
        this.error = 'Save this draft as a new note before switching to today’s note.';
        this.notifyStatus(); return;
      }
      this.unsubscribe?.(); this.unsubscribe = null;
      this.store.stop(); this.store = null;
    }
    if (this.stopped) return;
    this.path = path;
    this.noteDateTime = path.toLowerCase() === expected.toLowerCase() ? today.format('YYYY-MM-DD') : this.dateForPath(path, core);
    const recovery = validRecovery(this.app.loadLocalStorage(RECOVERY + ':' + path), path);
    if (!file && !recovery) { this.notifyStatus(); return; }
    const binding = this.binding = { path };
    const store = new ScratchStore({
      path: () => binding.path,
      read: async () => {
        const file = this.app.vault.getFileByPath(binding.path);
        return file ? this.app.vault.read(file) : null;
      },
      write: async (expected, text) => {
        const file = this.app.vault.getFileByPath(binding.path);
        if (!file) throw new ScratchConflict('Daily note moved or deleted');
        await this.app.vault.process(file, current => {
          if (current !== expected && current !== text) throw new ScratchConflict('Daily note changed elsewhere');
          return text;
        });
      },
      recovery: value => {
        this.app.saveLocalStorage(RECOVERY + ':' + binding.path, value);
        if (value) this.app.saveLocalStorage(PENDING, binding.path);
        else if (this.app.loadLocalStorage(PENDING) === binding.path) this.app.saveLocalStorage(PENDING, null);
      }
    });
    this.store = store;
    this.unsubscribe = store.subscribe(() => this.notify());
    await store.load(recovery);
    if (recoveredPath && recoveredPath !== expected && store.dirty) {
      this.error = 'This draft is from an earlier daily note. Save it as a new note before switching to today’s note.';
    }
    if (this.stopped) store.stop();
    this.notifyStatus();
  }
  async ensure(): Promise<TFile | null> {
    if (this.creating) return this.creating;
    this.creating = this.create().finally(() => { this.creating = null; });
    return this.creating;
  }
  private async create(): Promise<TFile | null> {
    this.busy = true; this.notify();
    try {
      await this.sync();
      if (this.store?.dirty) { await this.store.flush(); if (this.store.dirty) return null; }
      const core = this.core();
      if (!core) { new Notice(COPY.enableDailyNotes); return null; }
      const file = await core.getDailyNote(moment());
      if (!file) { this.error = 'Couldn’t create today’s note. Check the Daily notes settings.'; return null; }
      await this.sync();
      return file;
    } catch {
      this.error = 'Couldn’t create today’s note. Check the Daily notes settings and try again.';
      return null;
    } finally { this.busy = false; this.notify(); }
  }
  async open(): Promise<void> {
    // Open the note the user is looking at, even when an earlier draft delays rollover.
    const store = this.store, path = this.path;
    if (store) {
      await store.flush();
      if (store.dirty) { new Notice('Save this draft as a new note before opening the original.'); return; }
      const file = this.app.vault.getFileByPath(path);
      if (file) await this.app.workspace.getLeaf('tab').openFile(file);
      else new Notice(COPY.noteUnavailable);
      return;
    }
    const file = await this.ensure();
    if (file) await this.app.workspace.getLeaf('tab').openFile(file);
  }
  async changed(path: string): Promise<void> {
    if (path !== this.path) return;
    await this.store?.refresh();
    await this.sync();
  }
  rename(oldPath: string, nextPath: string): void {
    const path = renamePath(this.path, oldPath, nextPath);
    if (path === this.path) return;
    const prior = this.path; this.path = path;
    const core = this.core();
    this.noteDateTime = core ? this.dateForPath(path, core) : '';
    if (this.binding) this.binding.path = path;
    this.store?.repath(); this.app.saveLocalStorage(RECOVERY + ':' + prior, null);
    this.notify();
  }
  async saveCopy(): Promise<void> {
    const store = this.store;
    if (!store) return;
    const text = store.text;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const stem = this.path.replace(/\.md$/i, '') + ' — recovered ' + stamp;
    let path = stem + '.md', count = 1;
    while (this.app.vault.getAbstractFileByPath(path)) path = `${stem} ${count++}.md`;
    try {
      await this.app.vault.create(path, text);
      await store.copiedDraft(text);
      new Notice(draftSaved(path));
      await this.sync();
    } catch { new Notice(DRAFT_COPY.copyError); }
  }
  async flush(): Promise<void> { await this.store?.flush(); }
  async retry(): Promise<void> {
    if (this.store && !this.store.loaded) {
      await this.store.load(validRecovery(this.app.loadLocalStorage(RECOVERY + ':' + this.path), this.path));
    } else await this.store?.flush();
    await this.sync();
  }
  stop(): void { this.stopped = true; this.unsubscribe?.(); this.store?.stop(); this.listeners.clear(); }
}
