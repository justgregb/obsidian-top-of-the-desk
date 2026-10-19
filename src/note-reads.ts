import type { TFile } from 'obsidian';

interface ReadJob {
  file: TFile;
  stamp: string;
  promise: Promise<string>;
  resolve(text: string): void;
  reject(error: unknown): void;
}

/** Share in-flight note reads across previews and counts, with one global limit. */
export class NoteReads {
  private jobs = new WeakMap<TFile, ReadJob>();
  private waiting: (ReadJob | null)[] = [];
  private head = 0;
  private active = 0;
  private stopped = false;
  constructor(private readText: (file: TFile) => Promise<string>) {}
  read(file: TFile, stamp: string): Promise<string> {
    if (this.stopped) return Promise.reject(new Error('Desk closed'));
    const cached = this.jobs.get(file);
    if (cached?.stamp === stamp) return cached.promise;
    let resolve!: ReadJob['resolve'], reject!: ReadJob['reject'];
    const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
    const job = { file, stamp, promise, resolve, reject };
    this.jobs.set(file, job); this.waiting.push(job); this.drain();
    return promise;
  }
  private drain(): void {
    while (!this.stopped && this.active < 4 && this.head < this.waiting.length) {
      const job = this.waiting[this.head]!;
      this.waiting[this.head++] = null;
      this.active++;
      void Promise.resolve().then(() => this.readText(job.file)).then(job.resolve, job.reject).finally(() => {
        this.active--;
        if (this.jobs.get(job.file) === job) this.jobs.delete(job.file);
        this.drain();
      });
    }
    // Dequeue without shifting every pending read. Release consumed jobs at
    // once, and compact the empty slots only occasionally.
    if (this.head === this.waiting.length) { this.waiting = []; this.head = 0; }
    else if (this.head >= 64 && this.head * 2 >= this.waiting.length) { this.waiting = this.waiting.slice(this.head); this.head = 0; }
  }
  stop(): void {
    this.stopped = true;
    for (const job of this.waiting) job?.reject(new Error('Desk closed'));
    this.waiting = []; this.head = 0; this.jobs = new WeakMap();
  }
}
