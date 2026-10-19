import { DRAFT_COPY } from './copy';
import { splitFrontmatter, type Recovery } from './model';

export class ScratchConflict extends Error {}
export interface ScratchIO {
  path(): string;
  read(): Promise<string | null>;
  write(expected: string | null, text: string): Promise<void>;
  recovery(value: Recovery | null): void;
}

/** One shared draft across every desk view; writes are compare-and-set, never blind. */
export class ScratchStore {
  text = '';
  baseline: string | null = null;
  loaded = false;
  conflict = false;
  error = '';
  dirty = false;
  private revision = 0;
  private writing: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private stopped = false;
  private prefix = '';
  private lineEnding = '\n';

  constructor(private io: ScratchIO) {}
  /** The widgets edit only the body; persistence and recovery still use the full note. */
  get body(): string { return this.text.slice(this.prefix.length).replace(/\r\n?/g, '\n'); }
  private projectBody(): void {
    this.prefix = splitFrontmatter(this.text).prefix;
    this.lineEnding = this.text.includes('\r\n') ? '\r\n' : '\n';
  }
  editBody(body: string): void {
    if (!this.loaded || body === this.body) return;
    // A closing delimiter at EOF needs a line break before the first body text.
    if (this.prefix && !this.prefix.endsWith('\n') && body) this.prefix += this.lineEnding;
    this.editDraft(this.prefix + body.replace(/\r\n?|\n/g, this.lineEnding));
  }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private notify(): void { this.listeners.forEach(fn => fn()); }
  private recover(): void {
    try { this.io.recovery(this.dirty ? { path: this.io.path(), text: this.text, baseline: this.baseline } : null); }
    catch { this.error = DRAFT_COPY.recoveryError; }
  }
  async load(saved: Recovery | null): Promise<void> {
    try {
      this.error = '';
      const disk = await this.io.read();
      this.baseline = disk;
      this.text = disk ?? '';
      if (saved && saved.text !== (disk ?? '')) {
        this.text = saved.text;
        this.baseline = saved.baseline;
        this.dirty = true;
        this.conflict = disk !== saved.baseline;
      }
      this.projectBody();
      this.loaded = true;
      this.recover(); this.notify();
      if (this.dirty && !this.conflict) this.schedule();
    } catch { this.error = DRAFT_COPY.readError; this.notify(); }
  }
  edit(text: string): void {
    if (!this.loaded) return;
    this.text = text; this.projectBody();
    this.editDraft(text);
  }
  private editDraft(text: string): void {
    this.text = text; this.revision++;
    this.dirty = text !== (this.baseline ?? '');
    this.error = '';
    this.recover(); this.notify();
    if (!this.conflict) this.schedule();
  }
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    if (!this.stopped) this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 550);
  }
  async refresh(): Promise<void> {
    if (!this.loaded || this.writing) return;
    const revision = this.revision;
    try {
      const disk = await this.io.read();
      if (revision !== this.revision || this.writing) return;
      if (disk === this.text) { this.baseline = disk; this.dirty = false; this.conflict = false; this.error = ''; this.recover(); }
      else if (this.dirty) { this.conflict = disk !== this.baseline; }
      else { this.baseline = disk; this.text = disk ?? ''; this.projectBody(); this.conflict = false; this.error = ''; }
      this.notify();
    } catch { this.error = DRAFT_COPY.refreshError; this.notify(); }
  }
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.writing) return this.writing;
    if (!this.loaded || !this.dirty || this.conflict) return;
    this.writing = this.writeLoop();
    try { await this.writing; } finally { this.writing = null; this.notify(); }
  }
  private async writeLoop(): Promise<void> {
    while (this.dirty && !this.conflict) {
      const text = this.text, baseline = this.baseline;
      try {
        await this.io.write(baseline, text);
        this.baseline = text;
        this.dirty = this.text !== text;
        this.error = '';
        this.recover(); this.notify();
      } catch (error) {
        if (error instanceof ScratchConflict) this.conflict = true;
        else this.error = DRAFT_COPY.saveError;
        this.recover(); this.notify(); return;
      }
    }
  }
  async copiedDraft(copied: string): Promise<void> {
    if (this.text !== copied) return;
    const revision = this.revision, disk = await this.io.read();
    if (this.revision !== revision) return;
    this.baseline = disk; this.text = disk ?? ''; this.dirty = false; this.conflict = false; this.error = '';
    this.projectBody();
    this.recover(); this.notify();
  }
  repath(): void { this.recover(); }
  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.recover();
    void this.flush();
  }
}
