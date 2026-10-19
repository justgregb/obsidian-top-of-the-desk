import type { TFile } from 'obsidian';
import { noteWordCount } from './word-count';

interface CountedNote { stamp: string; count: number; }
interface CollectionTotal { notes: Map<TFile, CountedNote>; words: number; }

/** Cache by file identity; collection refreshes read only added or changed notes. */
export class CollectionWordCounts {
  private files = new WeakMap<TFile, { stamp: string; count: Promise<number> }>();
  private revisions = new WeakMap<TFile, number>();
  private totals = new Map<string, CollectionTotal>();
  private requests = new Map<string, symbol>();

  constructor(private read: (file: TFile) => Promise<string>) {}

  stamp(file: TFile): string { return `${file.stat.mtime}:${file.stat.size}:${this.revisions.get(file) ?? 0}`; }

  invalidate(file: TFile): void {
    this.files.delete(file);
    this.revisions.set(file, (this.revisions.get(file) ?? 0) + 1);
  }

  count(file: TFile): Promise<number> {
    const stamp = this.stamp(file), cached = this.files.get(file);
    if (cached?.stamp === stamp) return cached.count;
    const entry = { stamp, count: this.read(file).then(noteWordCount) };
    this.files.set(file, entry);
    void entry.count.catch(() => { if (this.files.get(file) === entry) this.files.delete(file); });
    return entry.count;
  }

  async total(id: string, files: TFile[], active: () => boolean): Promise<number> {
    const request = Symbol(id);
    this.requests.set(id, request);
    const previous = this.totals.get(id);
    const notes = new Map(previous?.notes);
    let words = previous?.words ?? 0;
    const members = new Set(files);
    for (const [file, counted] of notes) if (!members.has(file)) { words -= counted.count; notes.delete(file); }
    const changed = [...members].filter(file => notes.get(file)?.stamp !== this.stamp(file));
    let next = 0, stopped = false;
    try {
      // Bound disk reads, share in-flight file counts, and cancel detached views.
      await Promise.all(Array.from({ length: Math.min(4, changed.length) }, async () => {
        while (!stopped && active()) {
          const file = changed[next++];
          if (!file) return;
          const stamp = this.stamp(file), count = await this.count(file);
          words += count - (notes.get(file)?.count ?? 0);
          notes.set(file, { stamp, count });
        }
      }));
      if (!active()) throw new Error('Collection count cancelled');
      // An older view or a note edited during the read must not replace a newer total.
      if (this.requests.get(id) === request && [...notes].every(([file, counted]) => counted.stamp === this.stamp(file))) {
        this.totals.set(id, { notes, words });
      }
      return words;
    } catch (error) { stopped = true; throw error; }
    finally { if (this.requests.get(id) === request) this.requests.delete(id); }
  }

  retain(ids: string[]): void {
    const keep = new Set(ids);
    for (const id of this.totals.keys()) if (!keep.has(id)) this.totals.delete(id);
    for (const id of this.requests.keys()) if (!keep.has(id)) this.requests.delete(id);
  }

  clear(): void {
    this.files = new WeakMap(); this.revisions = new WeakMap();
    this.totals.clear(); this.requests.clear();
  }
}
