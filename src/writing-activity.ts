import { isRecord } from './validation';
import { App, editorInfoField } from 'obsidian';
import { Transaction, type Text, type Extension } from '@codemirror/state';
import { ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { noteWordCount } from './word-count';

const STORAGE = 'top-of-the-desk:writing-activity';
interface ActivityData { version: 1; startedOn: string; days: Record<string, number>; }
interface PendingWriting { before: Text; after: Text; day: string; timer: number; }

export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function calendarDate(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date, 12);
}
function validDay(day: unknown): day is string {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && localDay(calendarDate(day)) === day;
}

/** Local, signed daily changes. No note text, paths, or estimated past activity is stored. */
export class WritingActivity {
  private data: ActivityData = { version: 1, startedOn: '', days: {} };
  private pending = new Map<object, PendingWriting>();
  private listeners = new Set<() => void>();
  private counts = new WeakMap<Text, number>();
  private stopped = false;
  private readable = true;
  error = '';

  constructor(private app: App) {
    try {
      const raw: unknown = app.loadLocalStorage(STORAGE);
      if (raw == null) return;
      if (!isRecord(raw) || raw.version !== 1 || typeof raw.startedOn !== 'string' || !validDay(raw.startedOn) || !isRecord(raw.days)) throw new Error('Unrecognized activity history');
      const days: Record<string, number> = {};
      for (const [day, count] of Object.entries(raw.days)) {
        if (!validDay(day) || typeof count !== 'number' || !Number.isSafeInteger(count)) throw new Error('Invalid activity history');
        days[day] = count;
      }
      this.data = { version: 1, startedOn: raw.startedOn, days };
    } catch (error) {
      this.readable = false;
      this.error = 'Couldn’t load writing activity. Your saved history hasn’t been changed.';
      console.error('Top of the Desk: writing history could not be read', error);
    }
  }

  get startedOn(): string { return this.data.startedOn; }
  get tracking(): boolean { return !!this.startedOn && this.readable && !this.stopped; }
  total(day: string): number { return this.data.days[day] || 0; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify(): void { this.listeners.forEach(listener => listener()); }

  start(): void {
    if (this.startedOn || !this.readable || this.stopped) return;
    this.data.startedOn = localDay(); this.save(); this.notify();
  }

  capture(owner: object, before: Text, after: Text, day = localDay()): void {
    if (!this.tracking || before === after) return;
    const prior = this.pending.get(owner);
    // Midnight or an intervening reload starts a separate measurement.
    if (prior && (prior.day !== day || prior.after !== before)) this.flush(owner);
    const current = this.pending.get(owner);
    if (current) { current.after = after; return; }
    this.pending.set(owner, { before, after, day, timer: window.setTimeout(() => this.flush(owner), 800) });
  }

  flush(owner: object): void {
    const pending = this.pending.get(owner);
    if (!pending) return;
    window.clearTimeout(pending.timer); this.pending.delete(owner);
    const count = (doc: Text) => {
      let value = this.counts.get(doc);
      if (value === undefined) { value = noteWordCount(doc.toString()); this.counts.set(doc, value); }
      return value;
    };
    const difference = count(pending.after) - count(pending.before);
    if (!difference) return;
    this.data.days[pending.day] = this.total(pending.day) + difference;
    this.save(); this.notify();
  }
  flushAll(): void { for (const owner of this.pending.keys()) this.flush(owner); }
  stop(): void { this.flushAll(); this.stopped = true; this.listeners.clear(); }

  private save(): void {
    try { this.app.saveLocalStorage(STORAGE, this.data); this.error = ''; }
    catch (error) {
      this.error = 'Couldn’t save writing activity. Recent word counts haven’t been saved.';
      console.error('Top of the Desk: writing history could not be saved', error);
    }
  }

  editorExtension(onLocalEdit?: (path: string) => void): Extension {
    const tracking = () => this.tracking;
    const capture = (owner: object, before: Text, after: Text) => this.capture(owner, before, after);
    const flush = (owner: object) => this.flush(owner);
    return ViewPlugin.fromClass(class {
      update(update: ViewUpdate): void {
        if (!update.docChanged) return;
        const file = update.state.field(editorInfoField, false)?.file;
        // Desk editors report their guarded local changes directly, exactly once.
        if ((!tracking() && !onLocalEdit) || file?.extension !== 'md' || update.view.dom.closest('.tod-note-editor')) return;
        let localChange = false;
        for (const transaction of update.transactions) {
          if (!transaction.docChanged) continue;
          const userEvent = transaction.annotation(Transaction.userEvent);
          const directEdit = ['input', 'delete', 'undo', 'redo', 'move'].some(event => transaction.isUserEvent(event));
          // Obsidian's editor commands request scrollIntoView even when no user event is supplied.
          const editorCommand = !userEvent && transaction.scrollIntoView && transaction.annotation(Transaction.addToHistory) !== false;
          if (!transaction.annotation(Transaction.remote) && (directEdit || editorCommand)) {
            localChange = true;
            if (tracking()) capture(this, transaction.startState.doc, transaction.newDoc);
          } else flush(this);
        }
        if (localChange) onLocalEdit?.(file.path);
      }
      destroy(): void { flush(this); }
    });
  }
}
