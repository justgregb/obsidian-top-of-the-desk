import { SourceType, isSourceWidgetType } from './source-types';
import { UndoOrigin, undoOrigin } from './undo-notice';
import { Component, Notice } from 'obsidian';
import { COPY } from './copy';
import type DeskPlugin from './main';
import type { DeskSettings, GridColumns, GridPosition, WidgetSettings, WidgetSize } from './model';
import { canStackWidget, deskPaths, isRootWidget, itemWidgetId, removeDeskNote, syncDeskWidgets, widgetDefaults, widgetName, widgetStackFor, widgetStackOwners } from './model';
import { PointerDrag } from './pointer-drag';
import { normalizeWidgetRows } from './widget-sizing';
import { updateBounds } from './ui';

export interface WidgetRect extends GridPosition { columns: number; rows: number; }
export type WidgetLayout = Map<string, WidgetRect>;

/** Honor saved positions first; use the former dense placement for unsaved cards. */
export function resolveWidgetLayout(settings: DeskSettings, columns: GridColumns, priority?: string | string[]): WidgetLayout {
  const owners = widgetStackOwners(settings);
  const ids = settings.widgetOrder.filter(id => isRootWidget(settings, id, owners));
  const first = (Array.isArray(priority) ? priority : priority ? [priority] : []).filter(id => ids.includes(id));
  const ordered = first.length ? [...first, ...ids.filter(id => !first.includes(id))] : ids;
  const layout: WidgetLayout = new Map();
  const pending: { id: string; rect: WidgetRect }[] = [];
  // Each column contains disjoint occupied intervals, ordered by row. Search
  // those intervals instead of comparing every candidate with every item.
  const occupied: { start: number; end: number }[][] = Array.from({ length: columns }, () => []);
  const firstAfter = (intervals: { end: number }[], row: number): number => {
    let low = 0, high = intervals.length;
    while (low < high) { const middle = (low + high) >>> 1; if (intervals[middle].end <= row) low = middle + 1; else high = middle; }
    return low;
  };
  const blockedUntil = (rect: WidgetRect): number => {
    let until = rect.row;
    for (let column = rect.column - 1; column < rect.column + rect.columns - 1; column++) {
      const intervals = occupied[column], next = intervals[firstAfter(intervals, rect.row)];
      if (next && next.start < rect.row + rect.rows) until = Math.max(until, next.end);
    }
    return until;
  };
  const place = (id: string, rect: WidgetRect) => {
    layout.set(id, rect);
    for (let column = rect.column - 1; column < rect.column + rect.columns - 1; column++) {
      const intervals = occupied[column];
      intervals.splice(firstAfter(intervals, rect.row), 0, { start: rect.row, end: rect.row + rect.rows });
    }
  };
  for (const id of ordered) {
    const widget = settings.widgets[id], saved = widget.positions?.[columns];
    const width = Math.min(columns, widget.columns);
    const rect = { column: Math.max(1, Math.min(saved?.column ?? 1, columns - width + 1)), row: saved?.row ?? 1, columns: width, rows: widget.rows };
    if (saved && blockedUntil(rect) === rect.row) place(id, rect);
    else pending.push({ id, rect });
  }
  for (const { id, rect } of pending) {
    let placed = false, row = rect.row;
    while (!placed) {
      let nextRow = Infinity;
      for (let column = 1; column <= columns - rect.columns + 1; column++) {
        const next = { ...rect, row, column }, until = blockedUntil(next);
        if (until === row) { place(id, next); placed = true; break; }
        nextRow = Math.min(nextRow, until);
      }
      // No column can fit before its current blocker ends. Keep the same
      // first available row/column while skipping provably occupied rows.
      if (!placed) row = nextRow;
    }
  }

  return layout;
}

/** Store each responsive layout independently; hidden cards keep their saved slot. */
export function rememberWidgetLayout(settings: DeskSettings, columns: GridColumns, layout: WidgetLayout): void {
  for (const [id, rect] of layout) {
    const widget = settings.widgets[id];
    widget.positions = { ...widget.positions, [columns]: { column: rect.column, row: rect.row } };
  }
  const visible = [...layout].sort((a, b) => a[1].row - b[1].row || a[1].column - b[1].column).map(([id]) => id);
  let index = 0;
  const owners = widgetStackOwners(settings);
  settings.widgetOrder = settings.widgetOrder.map(id => isRootWidget(settings, id, owners) ? visible[index++] : id);
}

function samePosition(a: GridPosition, b: GridPosition): boolean { return a.column === b.column && a.row === b.row; }

function setResizeOrigin(widget: WidgetSettings, columns: GridColumns, origin?: GridPosition): void {
  const origins = { ...widget.resizeOrigins };
  if (origin) origins[columns] = { column: origin.column, row: origin.row };
  else delete origins[columns];
  if (Object.keys(origins).length) widget.resizeOrigins = origins;
  else delete widget.resizeOrigins;
}

/** Resize from preferred slots, remembering only the positions that could not be restored. */
export function resizeWidgetLayout(settings: DeskSettings, id: string, size: WidgetSize, columns: GridColumns): void {
  const current = resolveWidgetLayout(settings, columns);
  const origins = new Map<string, GridPosition>();
  for (const [key, rect] of current) {
    const widget = settings.widgets[key], origin = widget.resizeOrigins?.[columns] ?? rect;
    const position = { column: origin.column, row: origin.row };
    origins.set(key, position);
    widget.positions = { ...widget.positions, [columns]: position };
  }
  settings.widgets[id].columns = size.columns;
  settings.widgets[id].rows = normalizeWidgetRows(size.rows);
  const next = resolveWidgetLayout(settings, columns, id);
  rememberWidgetLayout(settings, columns, next);
  for (const [key, rect] of next) {
    const origin = origins.get(key)!;
    setResizeOrigin(settings.widgets[key], columns, samePosition(rect, origin) ? undefined : origin);
  }
}

/** A deliberate move replaces the remembered slot for every widget that move relocates. */
export function commitWidgetMove(settings: DeskSettings, id: string, columns: GridColumns, current: WidgetLayout, next: WidgetLayout): void {
  for (const [key, rect] of next) {
    const before = current.get(key);
    if (key === id || !before || !samePosition(before, rect)) setResizeOrigin(settings.widgets[key], columns);
  }
  rememberWidgetLayout(settings, columns, next);
}

/** Preview and commit use exactly the same collision resolution, without mutating settings. */
export function plannedWidgetMove(settings: DeskSettings, id: string, target: GridPosition, columns: GridColumns): WidgetLayout {
  const layout = resolveWidgetLayout(settings, columns), current = layout.get(id);
  if (!current) return layout;
  const draft: DeskSettings = { ...settings, widgetOrder: [...settings.widgetOrder],
    widgets: Object.fromEntries(Object.entries(settings.widgets).map(([key, widget]) => [key, { ...widget, positions: { ...widget.positions } }])) };
  rememberWidgetLayout(draft, columns, layout);
  draft.widgets[id].positions = { ...draft.widgets[id].positions, [columns]: {
    column: Math.max(1, Math.min(columns - current.columns + 1, Math.floor(target.column))),
    row: Math.max(1, Math.min(20000, Math.floor(target.row))),
  } };
  return resolveWidgetLayout(draft, columns, id);
}

export interface DeskSource { kind: SourceType; path: string; title?: string; }
export interface SourceMove { source: DeskSource; itemId: string; }

export function sourceWidgetId(settings: DeskSettings, source: DeskSource): string | undefined {
  if (source.kind === 'note' || source.kind === 'folder') {
    const item = settings.items.find(item => item.type === source.kind && 'path' in item && item.path === source.path);
    return item ? itemWidgetId(item.id) : undefined;
  }
  const ids = settings.widgetOrder.filter(id => settings.widgets[id]?.type === source.kind && settings.widgets[id].path === source.path);
  return ids.find(id => settings.widgets[widgetStackFor(settings, id) || id]?.enabled) || ids[0];
}

/** A source drag is a prospective grid item until release; cancellation changes nothing. */
export function sourceMoveDraft(settings: DeskSettings, source: DeskSource, itemId: string, columns: GridColumns): { settings: DeskSettings; id: string } | null {
  const existingId = sourceWidgetId(settings, source);
  const id = existingId || (isSourceWidgetType(source.kind) ? `${source.kind}-${itemId}` : itemWidgetId(itemId));
  const root = widgetStackFor(settings, id) || id;
  if (existingId && isRootWidget(settings, root)) return { settings, id: root };
  if (!existingId && (source.kind === 'note' && !deskPaths(settings.items).includes(source.path) && deskPaths(settings.items).length >= 300
    || source.kind === 'folder' && settings.items.filter(item => item.type === 'folder').length >= 100)) return null;
  const draft = { ...settings, items: [...settings.items], widgets: structuredClone(settings.widgets), widgetOrder: [...settings.widgetOrder] };
  rememberWidgetLayout(draft, columns, resolveWidgetLayout(settings, columns));
  if (!existingId) {
    if (source.kind === 'note' || source.kind === 'folder') {
      if (source.kind === 'note') draft.items = removeDeskNote(draft.items, source.path);
      draft.items.push({ id: itemId, type: source.kind, path: source.path });
    } else {
      draft.widgets[id] = { ...widgetDefaults(source.kind), path: source.path, title: (source.title || '').slice(0, 100) };
      draft.widgetOrder.push(id);
    }
  }
  syncDeskWidgets(draft);
  draft.widgets[root].enabled = true;
  return { settings: draft, id: root };
}

/** A sidebar selection stays an isolated draft until the whole drop can succeed. */
export function sourceMovesDraft(settings: DeskSettings, moves: SourceMove[], columns: GridColumns): { settings: DeskSettings; ids: string[] } | null {
  let draft = settings;
  const ids: string[] = [];
  for (const { source, itemId } of moves) {
    const prepared = sourceMoveDraft(draft, source, itemId, columns);
    if (!prepared) return null;
    draft = prepared.settings;
    if (!ids.includes(prepared.id)) ids.push(prepared.id);
  }
  return ids.length ? { settings: draft, ids } : null;
}

/** Place selected sources together; reserve all their slots before shifting neighbors. */
export function plannedSourceMoves(settings: DeskSettings, ids: string[], target: GridPosition, columns: GridColumns): WidgetLayout {
  if (ids.length === 1) return plannedWidgetMove(settings, ids[0], target, columns);
  const draft = { ...settings, widgetOrder: [...settings.widgetOrder], widgets: structuredClone(settings.widgets) };
  rememberWidgetLayout(draft, columns, resolveWidgetLayout(settings, columns));
  let row = Math.max(1, Math.min(20000, Math.floor(target.row)));
  for (const id of ids) {
    const widget = draft.widgets[id];
    const column = Math.max(1, Math.min(columns - Math.min(columns, widget.columns) + 1, Math.floor(target.column)));
    widget.positions = { ...widget.positions, [columns]: { column, row } };
    row += widget.rows;
  }
  return resolveWidgetLayout(draft, columns, ids);
}

interface Geometry { columns: GridColumns; width: number; cellWidth: number; rowHeight: number; columnGap: number; rowGap: number; left: number; top: number; }

/** Spatial placement, with one delegated set of handlers and a non-interactive drop outline. */
export class WidgetGrid extends Component {
  private layout: WidgetLayout = new Map();
  private geometry: Geometry | null = null;
  private preview: HTMLElement;
  private previewLabel: HTMLElement;
  private announcement: HTMLElement;
  private moving: { id: string; lastRow: number; mode: 'drag' | 'place'; anchor: HTMLButtonElement | null; card: HTMLElement | null; sources?: SourceMove[]; ids?: string[]; draft?: DeskSettings } | null = null;
  private frame = 0;
  private targetFrame = 0;
  private pointer: { x: number; y: number } | null = null;
  private targetKey = '';
  private shifts = new Map<string, HTMLElement>();
  private gesture!: PointerDrag<string>;

  constructor(private plugin: DeskPlugin, private grid: HTMLElement, private beforeMove: () => void) {
    super();
    this.preview = grid.createDiv({ cls: 'tod-widget-drop-preview', attr: { 'aria-hidden': 'true' } });
    this.previewLabel = this.preview.createSpan('tod-widget-drop-label');
    this.announcement = grid.createDiv({ cls: 'tod-layout-announcement', attr: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' } });
    this.preview.hidden = true;
  }
  get columns(): GridColumns { return this.measure()?.columns ?? this.geometry?.columns ?? 4; }
  cancelDrag(): void { this.gesture?.cancel(); this.finishMove(); }

  get hasSourceMove(): boolean { return !!this.moving?.sources; }
  beginSourceMove(input: DeskSource | DeskSource[]): boolean {
    this.cancelDrag(); this.render();
    const sources = (Array.isArray(input) ? input : [input]).map(source => ({ source, itemId: crypto.randomUUID() }));
    const prepared = sourceMovesDraft(this.plugin.settings, sources, this.columns);
    if (!prepared) { new Notice('The desk can hold up to 300 notes and 100 folders. Remove an item before adding more.'); return false; }
    if (!this.geometry) return false;
    this.plugin.sizePicker.close();
    const id = prepared.ids[0], card = this.grid.querySelector<HTMLElement>(`:scope > [data-widget="${id}"]`);
    this.moving = { id, anchor: null, card, mode: 'drag', sources, ids: prepared.ids, draft: prepared.settings,
      lastRow: Math.max(0, ...[...this.layout.values()].map(rect => rect.row + rect.rows - 1)) };
    card?.addClass('is-dragging'); this.grid.addClass('is-widget-dragging');
    this.reserveMoveSpace(prepared.ids.reduce((rows, id) => rows + prepared.settings.widgets[id].rows, 0));
    return true;
  }
  previewSourceMove(x: number, y: number, blocked = false, nativeScroll = false): boolean {
    if (!this.moving?.sources) return false;
    if (blocked || !this.withinDesk(x, y)) { this.hideTarget(); return false; }
    if (!nativeScroll) this.scrollAt(x, y);
    this.showTarget(x, y); return true;
  }
  dropSourceMove(x: number, y: number, origin: UndoOrigin): void {
    if (this.moving?.sources && this.withinDesk(x, y)) this.placeAt(x, y, origin);
  }
  finishSourceMove(): void { if (this.moving?.sources) this.finishMove(); }
  private get moveSettings(): DeskSettings { return this.moving?.draft || this.plugin.settings; }

  togglePlacement(id: string, anchor: HTMLButtonElement): void {
    if (this.moving?.mode === 'place' && this.moving.anchor === anchor) { this.finishMove(true); return; }
    this.beforeMove();
    const card = this.startMove(id, anchor, 'place');
    if (!card) return;
    const bounds = card.getBoundingClientRect();
    this.showTarget(bounds.left + 1, bounds.top + 1);
    this.announcement.setText(`Move ${widgetName(this.plugin.settings.widgets[id])}. Select a destination or use arrow keys. Press Escape to cancel.`);
  }

  onload(): void {
    const doc = this.grid.ownerDocument, win = doc.defaultView!;
    const observer = new win.ResizeObserver(() => {
      if (!this.frame) this.frame = win.requestAnimationFrame(() => {
        this.frame = 0;
        const next = this.measure(), previous = this.geometry;
        // Drop-preview clearance changes height, not the grid's tracks. It must
        // not rebuild source drafts and clear the current drop target.
        if (next && (!previous || next.columns !== previous.columns || next.width !== previous.width ||
          next.rowHeight !== previous.rowHeight || next.columnGap !== previous.columnGap || next.rowGap !== previous.rowGap)) this.render(next);
      });
    });
    observer.observe(this.grid);
    this.register(() => { observer.disconnect(); if (this.frame) win.cancelAnimationFrame(this.frame); this.frame = 0; this.finishMove(); this.preview.remove(); this.announcement.remove(); });
    this.gesture = this.addChild(new PointerDrag<string>({
      label: id => widgetName(this.plugin.settings.widgets[id]),
      canStart: id => isRootWidget(this.plugin.settings, id),
      begin: (id, source) => {
        this.beforeMove();
        const grip = source.querySelector<HTMLButtonElement>(':scope > .tod-widget-controls .tod-widget-grip');
        if (grip) this.startMove(id, grip, 'drag');
      },
      move: (_id, x, y) => {
        this.scrollAt(x, y);
        if (!this.withinDesk(x, y)) { this.hideTarget(); return false; }
        this.showTarget(x, y); return !!this.moving;
      },
      drop: (_id, x, y) => { if (this.withinDesk(x, y)) this.placeAt(x, y, { doc, x, y, touch: win.matchMedia('(pointer: coarse)').matches }); },
      end: () => this.finishMove(),
    }));
    this.register(this.gesture.delegate(this.grid, target => {
      const handle = target.closest<HTMLElement>('[data-widget-drag]');
      let source = handle?.closest<HTMLElement>('.tod-widget');
      while (source && source.parentElement !== this.grid) source = source.parentElement?.closest<HTMLElement>('.tod-widget');
      const id = source?.dataset.widget;
      return handle && source?.parentElement === this.grid && id ? { handle, source, value: id } : null;
    }));
    this.registerDomEvent(this.grid, 'pointermove', event => {
      if (this.moving?.mode === 'place') this.queueTarget(event.clientX, event.clientY);
    });
    this.registerDomEvent(this.grid, 'pointerleave', () => { if (this.moving?.mode === 'place') this.hideTarget(); });
    this.registerDomEvent(doc, 'pointerdown', event => {
      if (this.moving?.mode !== 'place') return;
      const target = event.target as HTMLElement;
      if (!this.grid.contains(target) || event.button !== 0) { this.finishMove(); return; }
      // Mouse placement must not select underlying text. Touch still needs to pan to a destination.
      if (event.pointerType === 'mouse' && !target.closest('.tod-widget-controls')) event.preventDefault();
    }, true);
    this.registerDomEvent(this.grid, 'click', event => {
      const moving = this.moving;
      if (moving?.mode !== 'place') return;
      const target = event.target as HTMLElement;
      if (moving.anchor?.contains(target)) {
        event.preventDefault(); event.stopImmediatePropagation(); this.finishMove(true); return;
      }
      if (target.closest('.tod-widget-controls')) { this.finishMove(); return; }
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.detail > 0) this.placeAt(event.clientX, event.clientY, undoOrigin(event, event.target as HTMLElement));
      else {
        // Assistive activation may provide a target element without pointer coordinates.
        const destination = target.closest<HTMLElement>('.tod-widget');
        if (destination) {
          const bounds = destination.getBoundingClientRect();
          this.placeAt(bounds.left + 1, bounds.top + 1, undoOrigin(event, destination));
        }
      }
    }, true);
    this.registerDomEvent(doc, 'keydown', event => {
      if (this.moving?.mode !== 'place') return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.finishMove(true); }
      else if (event.key === 'Tab') this.finishMove();
    }, true);
    this.registerDomEvent(doc, 'focusin', event => {
      if (this.moving?.mode === 'place' && event.target !== this.moving.anchor) this.finishMove();
    });
    this.registerDomEvent(doc, 'scroll', () => { if (this.moving) this.hideTarget(); }, true);
    this.registerDomEvent(win, 'blur', () => this.finishMove());
    this.registerDomEvent(this.grid, 'keydown', event => {
      const grip = event.target as HTMLElement;
      if (!grip.matches('.tod-widget-grip') || event.altKey || event.ctrlKey || event.metaKey) return;
      const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const delta = directions[event.key];
      if (!delta) return;
      event.preventDefault(); event.stopPropagation();
      this.finishMove();
      this.render();
      const id = grip.closest<HTMLElement>('.tod-widget')?.dataset.widget, rect = id ? this.layout.get(id) : undefined;
      if (id && rect) this.plugin.moveWidgetTo(id, { column: rect.column + delta[0], row: rect.row + delta[1] }, this.columns, undoOrigin(event, grip));
      grip.focus({ preventScroll: true });
      if (id) this.announcePosition(id);
    });
  }

  render(geometry = this.measure()): void {
    if (!geometry) return;
    if (this.moving?.sources) {
      const prepared = sourceMovesDraft(this.plugin.settings, this.moving.sources, geometry.columns);
      if (!prepared) this.finishMove();
      else { this.moving.id = prepared.ids[0]; this.moving.ids = prepared.ids; this.moving.draft = prepared.settings; this.hideTarget(); }
    }
    if (this.moving && (!this.moveSettings.widgets[this.moving.id]?.enabled || this.geometry &&
      (geometry.width !== this.geometry.width || geometry.columns !== this.geometry.columns || geometry.rowHeight !== this.geometry.rowHeight))) this.cancelDrag();
    this.geometry = geometry;
    const layout = resolveWidgetLayout(this.plugin.settings, geometry.columns);
    const changed = layout.size !== this.layout.size || [...layout].some(([id, rect]) => {
      const previous = this.layout.get(id);
      return !previous || previous.column !== rect.column || previous.row !== rect.row || previous.columns !== rect.columns || previous.rows !== rect.rows;
    });
    this.layout = layout;
    if (changed && this.moving) this.hideTarget();
    const cards = Array.from(this.grid.querySelectorAll<HTMLElement>(':scope > .tod-widget'));
    const position = (card: HTMLElement) => this.layout.get(card.dataset.widget!);
    const sorted = cards.filter(card => this.layout.has(card.dataset.widget!)).sort((a, b) => {
      const first = position(a)!, second = position(b)!;
      return first.row - second.row || first.column - second.column;
    });
    const ordered = [...sorted, ...cards.filter(card => !this.layout.has(card.dataset.widget!))];
    const currentOrder = Array.from(this.grid.children).filter((el): el is HTMLElement => el.hasClass('tod-widget'));
    for (const [index, card] of ordered.entries()) {
      const rect = position(card);
      if (rect) {
        const column = `${rect.column} / span ${rect.columns}`, row = `${rect.row} / span ${rect.rows}`;
        if (card.style.gridColumn !== column) card.style.gridColumn = column;
        if (card.style.gridRow !== row) card.style.gridRow = row;
      }
      const current = currentOrder[index];
      if (current !== card) {
        this.grid.insertBefore(card, current || this.preview);
        currentOrder.splice(currentOrder.indexOf(card), 1); currentOrder.splice(index, 0, card);
      }
    }
  }

  private measure(): Geometry | null {
    if (!this.grid.isConnected || !this.grid.clientWidth) return null;
    const win = this.grid.ownerDocument.defaultView!, style = win.getComputedStyle(this.grid);
    const tracks = style.gridTemplateColumns.trim().split(/\s+/).length;
    const columns: GridColumns = tracks <= 1 ? 1 : tracks <= 2 ? 2 : 4;
    const columnGap = parseFloat(style.columnGap) || 0, rowGap = parseFloat(style.rowGap) || 0;
    const rowHeight = parseFloat(style.gridAutoRows), bounds = this.grid.getBoundingClientRect();
    if (!Number.isFinite(rowHeight) || rowHeight <= 0) return null;
    return { columns, columnGap, rowGap, rowHeight, width: bounds.width, cellWidth: (bounds.width - columnGap * (columns - 1)) / columns, left: bounds.left, top: bounds.top };
  }
  private targetAt(x: number, y: number, geometry = this.measure()): GridPosition | null {
    const moving = this.moving;
    if (!geometry || !moving) return null;
    const width = Math.min(geometry.columns, this.moveSettings.widgets[moving.id].columns);
    return {
      column: Math.max(1, Math.min(geometry.columns - width + 1, Math.floor((x - geometry.left) / (geometry.cellWidth + geometry.columnGap)) + 1)),
      row: Math.max(1, Math.min(moving.lastRow + 1, Math.floor((y - geometry.top) / (geometry.rowHeight + geometry.rowGap)) + 1)),
    };
  }
  private withinDesk(x: number, y: number): boolean {
    const bounds = (this.grid.closest<HTMLElement>('.tod-view') || this.grid).getBoundingClientRect();
    return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
  }
  private scrollAt(x: number, y: number): void {
    const view = this.grid.closest<HTMLElement>('.tod-view');
    if (!view) return;
    const rect = view.getBoundingClientRect(), edge = Math.min(36, rect.height / 4);
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;
    const speed = y < rect.top + edge ? -12 * (1 - (y - rect.top) / edge) : y > rect.bottom - edge ? 12 * (1 - (rect.bottom - y) / edge) : 0;
    if (speed) view.scrollTop += speed;
  }
  private groupAt(x: number, y: number): { id: string; rect: DOMRect; label: string; notes: boolean } | null {
    if (!this.moving || (this.moving.sources?.length || 0) > 1) return null;
    const hit = this.grid.ownerDocument.elementFromPoint(x, y);
    let card: HTMLElement | null = hit?.closest<HTMLElement>('.tod-widget') || null;
    while (card && card.parentElement !== this.grid) card = card.parentElement?.closest<HTMLElement>('.tod-widget') || null;
    const id = card?.dataset.widget;
    if (!id || !card || id === this.moving.id || !isRootWidget(this.plugin.settings, id)) return null;
    const rect = card.getBoundingClientRect();
    if (x < rect.left + rect.width * .2 || x > rect.right - rect.width * .2 || y < rect.top + rect.height * .22 || y > rect.bottom - rect.height * .22) return null;
    const source = this.moveSettings.widgets[this.moving.id], target = this.plugin.settings.widgets[id];
    if (source.type === 'note' && (target.type === 'note' || target.type === 'stack')) return { id, rect, notes: true, label: target.type === 'stack' ? COPY.addToStack : COPY.stack };
    if (canStackWidget(source) && canStackWidget(target)) return { id, rect, notes: false, label: target.type === 'widget-stack' ? COPY.addToStack : COPY.stack };
    return null;
  }
  private showTarget(x: number, y: number): void {
    const group = this.groupAt(x, y);
    if (group) {
      const key = `group:${group.id}`;
      if (this.targetKey !== key) {
        this.hideTarget(); this.targetKey = key;
        this.previewLabel.setText(group.label);
      }
      const rect = group.rect, grid = this.grid.getBoundingClientRect();
      updateBounds(this.preview, { left: rect.left - grid.left, top: rect.top - grid.top, width: rect.width, height: rect.height });
      if (this.preview.hidden) this.preview.hidden = false;
      return;
    }
    const geometry = this.measure(), target = this.targetAt(x, y, geometry);
    if (!target || !geometry || !this.moving) return;
    const key = `${this.moving.id}:${target.column}:${target.row}:${geometry.width}:${geometry.rowHeight}:${geometry.columnGap}:${geometry.rowGap}`;
    if (key === this.targetKey) return;
    this.targetKey = key;
    const sourceIds = this.moving.ids || [this.moving.id];
    const planned = plannedSourceMoves(this.moveSettings, sourceIds, target, geometry.columns);
    const changed = new Set<string>();
    const place = (el: HTMLElement, rect: WidgetRect) => updateBounds(el, {
      left: (rect.column - 1) * (geometry.cellWidth + geometry.columnGap),
      top: (rect.row - 1) * (geometry.rowHeight + geometry.rowGap),
      width: rect.columns * geometry.cellWidth + (rect.columns - 1) * geometry.columnGap,
      height: rect.rows * geometry.rowHeight + (rect.rows - 1) * geometry.rowGap,
    });
    const destination = planned.get(this.moving.id);
    if (!destination) return;
    place(this.preview, destination);
    for (const [id, rect] of planned) {
      const current = this.layout.get(id), source = sourceIds.includes(id);
      if (id === this.moving.id || !source && (!current || (rect.column === current.column && rect.row === current.row))) continue;
      changed.add(id);
      let outline = this.shifts.get(id);
      if (!outline) {
        outline = this.grid.createDiv({ cls: 'tod-widget-shift-preview', attr: { 'aria-hidden': 'true' } });
        outline.createSpan({ cls: 'tod-widget-drop-label', text: widgetName(this.moveSettings.widgets[id]) });
        this.shifts.set(id, outline);
      }
      outline.toggleClass('is-source-drop', source);
      place(outline, rect);
    }
    for (const [id, outline] of this.shifts) if (!changed.has(id)) { outline.remove(); this.shifts.delete(id); }
    const shifted = [...changed].filter(id => !sourceIds.includes(id)).length;
    this.previewLabel.setText(`${sourceIds.length > 1 ? `Place ${sourceIds.length} items here` : 'Move here'}${shifted ? ` · ${shifted} ${shifted === 1 ? 'item shifts' : 'items shift'}` : ''}${this.moving.mode === 'place' ? ' · Escape to cancel' : ''}`);
    const lastRow = Math.max(this.moving.lastRow + destination.rows, ...[...planned.values()].map(rect => rect.row + rect.rows - 1));
    this.grid.style.minHeight = `${lastRow * (geometry.rowHeight + geometry.rowGap) - geometry.rowGap}px`;
    this.preview.hidden = false;
  }
  private startMove(id: string, anchor: HTMLButtonElement, mode: 'drag' | 'place'): HTMLElement | null {
    this.finishMove(); this.render();
    const rect = this.layout.get(id), card = anchor.closest<HTMLElement>('.tod-widget');
    if (!rect || !this.geometry || !card || card.parentElement !== this.grid) return null;
    this.plugin.sizePicker.close();
    this.moving = { id, anchor, card, mode, lastRow: Math.max(0, ...[...this.layout.values()].map(item => item.row + item.rows - 1)) };
    anchor.setAttribute('aria-pressed', String(mode === 'place'));
    card.addClass(mode === 'drag' ? 'is-dragging' : 'is-placing');
    this.grid.addClass(mode === 'drag' ? 'is-widget-dragging' : 'is-widget-placing');
    this.previewLabel.setText(mode === 'place' ? 'Move here · Escape to cancel' : 'Move here');
    this.reserveMoveSpace(rect.rows);
    return card;
  }
  private reserveMoveSpace(rows: number): void {
    if (!this.geometry || !this.moving) return;
    const geometry = this.geometry;
    this.grid.style.minHeight = `${(this.moving.lastRow + rows) * (geometry.rowHeight + geometry.rowGap) - geometry.rowGap}px`;
  }

  private queueTarget(x: number, y: number): void {
    this.pointer = { x, y };
    if (this.targetFrame) return;
    this.targetFrame = this.grid.ownerDocument.defaultView!.requestAnimationFrame(() => {
      this.targetFrame = 0;
      if (this.moving && this.pointer) this.showTarget(this.pointer.x, this.pointer.y);
    });
  }

  private hideTarget(): void {
    this.preview.hidden = true; this.pointer = null;
    this.targetKey = '';
    for (const outline of this.shifts.values()) outline.remove();
    this.shifts.clear();
    if (this.targetFrame) this.grid.ownerDocument.defaultView!.cancelAnimationFrame(this.targetFrame);
    this.targetFrame = 0;
  }

  private placeAt(x: number, y: number, origin?: UndoOrigin): void {
    const moving = this.moving, target = this.targetAt(x, y), columns = this.columns;
    if (!moving || !target) return;
    const group = this.groupAt(x, y);
    if (moving.sources) {
      this.finishMove(false, true);
      try {
        const first = moving.sources[0];
        const id = moving.sources.length === 1
          ? this.plugin.dropSourceOnDesk(first.source, first.itemId, group ? { group: group.id } : target, columns, origin)
          : this.plugin.dropSourcesOnDesk(moving.sources, target, columns, origin);
        if (id) { this.grid.querySelector<HTMLElement>(`:scope > [data-widget="${id}"]`)?.focus({ preventScroll: true }); this.announcePosition(id); }
      } finally { this.grid.style.removeProperty('min-height'); }
      return;
    }
    if (group) {
      this.finishMove();
      let id: string | null = group.id;
      if (group.notes) this.plugin.stackNote(this.plugin.settings.widgets[moving.id].path, this.plugin.settings.widgets[group.id].itemId!, false, origin);
      else id = this.plugin.stackWidgets([group.id, moving.id], origin);
      if (id) this.grid.querySelector<HTMLElement>(`:scope > [data-widget="${id}"]`)?.focus({ preventScroll: true });
      this.announcement.setText(group.notes ? 'Notes stacked.' : 'Items stacked. Use the icons or swipe to switch between them.');
      return;
    }
    // Keep the destination scroll range until the newly placed cards have their positions.
    this.finishMove(false, true);
    this.plugin.moveWidgetTo(moving.id, target, columns, origin);
    this.grid.style.removeProperty('min-height');
    if (moving.anchor?.isConnected) moving.anchor.focus({ preventScroll: true });
    this.announcePosition(moving.id);
  }

  private announcePosition(id: string): void {
    const widget = this.plugin.settings.widgets[id], rect = this.layout.get(id);
    if (widget && rect) this.announcement.setText(`${widgetName(widget)}, column ${rect.column}, row ${rect.row}.`);
  }

  private finishMove(restoreFocus = false, keepSpace = false): void {
    const moving = this.moving;
    this.moving = null; this.hideTarget();
    this.grid.removeClass('is-widget-dragging', 'is-widget-placing');
    if (!keepSpace) this.grid.style.removeProperty('min-height');
    if (moving) {
      moving.anchor?.setAttribute('aria-pressed', 'false');
      moving.card?.removeClass('is-dragging', 'is-placing');
      if (restoreFocus && moving.anchor?.isConnected) { moving.anchor.focus({ preventScroll: true }); this.announcement.setText('Move cancelled.'); }
    }
  }
}
