import { isRecord, isUnknownArray, hasControlCharacters, stripControls, singleLine } from './validation';
import { normalizeToolbarActions, normalizeToolbarOrder, type ToolbarControl } from './toolbar-preferences';
import { SOURCE_TYPES, isCompactSourceType, isFileWidgetType, matchesSourceFile, sourceWebName, sourceWebUrl } from './source-types';
import { COMPACT_HEIGHT, HALF_HEIGHT, STANDARD_HEIGHT, migrateWidgetRows, normalizeWidgetRows } from './widget-sizing';

export const WIDGET_KEYS = ['desk', 'note', 'stack', 'recents', 'base', 'canvas', 'pdf', 'audio', 'image', 'web', 'folder', 'scratchpad', 'daily', 'activity', 'widget-stack'] as const;
export type WidgetKey = typeof WIDGET_KEYS[number];
export const SINGLETON_WIDGETS = ['recents', 'scratchpad', 'daily', 'activity'] as const;
export type GridColumns = 1 | 2 | 4;
export interface GridPosition { column: number; row: number; }
export interface WidgetSize { columns: 1 | 2 | 3 | 4; rows: number; }
export const WIDGET_NAMES: Record<WidgetKey, string> = {
  desk: 'Desk', note: SOURCE_TYPES.note.name, stack: 'Stack', recents: 'Recently opened', base: SOURCE_TYPES.base.name, canvas: SOURCE_TYPES.canvas.name, pdf: SOURCE_TYPES.pdf.name, audio: SOURCE_TYPES.audio.name, image: SOURCE_TYPES.image.name, web: SOURCE_TYPES.web.name, folder: SOURCE_TYPES.folder.name, scratchpad: 'Scratchpad', daily: 'Daily note', activity: 'Writing activity', 'widget-stack': 'Stack'
};
/** Shared identities for headings, stack navigation and the Add to desk picker. */
export const WIDGET_ICONS: Record<WidgetKey, string> = {
  desk: 'layers', note: SOURCE_TYPES.note.icon, stack: 'files', recents: 'history', base: SOURCE_TYPES.base.icon, canvas: SOURCE_TYPES.canvas.icon, pdf: SOURCE_TYPES.pdf.icon, audio: SOURCE_TYPES.audio.icon, image: SOURCE_TYPES.image.icon, web: SOURCE_TYPES.web.icon, folder: SOURCE_TYPES.folder.icon,
  scratchpad: 'square-pen', daily: 'calendar-days', activity: 'calendar-range', 'widget-stack': 'layers-2'
};
export const DEFAULT_WIDGET_COLUMNS: Record<WidgetKey, WidgetSize['columns']> = {
  desk: 2, note: 1, stack: 1, recents: 1, scratchpad: 1, base: 2, canvas: 1, pdf: 1, audio: 1, image: 1, web: 1, folder: 1, daily: 1, activity: 2, 'widget-stack': 2
};
export interface WidgetSettings extends WidgetSize {
  type: WidgetKey;
  enabled: boolean;
  path: string;
  view: string;
  title: string;
  itemId?: string;
  members?: string[];
  activeMember?: string;
  presentation?: 'cover' | 'list';
  coverSize?: WidgetSize;
  listSize?: WidgetSize;
  showHeading?: boolean;
  showBaseControls?: boolean;
  positions?: Partial<Record<GridColumns, GridPosition>>;
  /** Slots temporarily displaced by resizing, retained until they fit again. */
  resizeOrigins?: Partial<Record<GridColumns, GridPosition>>;
}
export function widgetDefaults(type: WidgetKey): WidgetSettings {
  return { type, enabled: true, columns: DEFAULT_WIDGET_COLUMNS[type], rows: isCompactSourceType(type) ? COMPACT_HEIGHT : type === 'note' || type === 'stack' || type === 'folder' ? HALF_HEIGHT : type === 'base' ? 2 * STANDARD_HEIGHT : STANDARD_HEIGHT, path: '', view: '', title: '' };
}
function legacyWidgetRows(type: WidgetKey): number { return type === 'note' || type === 'stack' || type === 'folder' ? 2 : type === 'base' ? 6 : 3; }
export function widgetName(widget: WidgetSettings): string {
  const name = widget.path === '/' ? 'Vault' : widget.path.split('/').pop() || '';
  return widget.title || (widget.type === 'web' ? sourceWebName(widget.path) : isFileWidgetType(widget.type) || widget.type === 'note' ? name.replace(/\.[^.]+$/, '') : name) || WIDGET_NAMES[widget.type];
}

export interface DeskNote { id: string; type: 'note'; path: string; }
export interface CollectionCountSettings { showNoteCount?: boolean; showWordCount?: boolean; }
export interface DeskFolder extends CollectionCountSettings { id: string; type: 'folder'; path: string; description?: string; }
export interface DeskStack extends CollectionCountSettings { id: string; type: 'stack'; name: string; description?: string; paths: string[]; }
export type DeskItem = DeskNote | DeskFolder | DeskStack;

export function collectionCountVisibility(item: DeskFolder | DeskStack): Required<CollectionCountSettings> {
  return { showNoteCount: item.showNoteCount ?? true, showWordCount: item.showWordCount ?? item.type === 'stack' };
}

/** Only explicit note references count as desk notes; a folder is a live shortcut. */
export function itemPaths(item: DeskItem): string[] { return item.type === 'note' ? [item.path] : item.type === 'stack' ? item.paths : []; }
export function deskPaths(items: DeskItem[]): string[] { return items.flatMap(itemPaths); }

/** References only. A file is represented once on the desk, including inside stacks. */
export function normalizeDeskItems(raw: unknown): DeskItem[] {
  if (!isUnknownArray(raw)) return [];
  const seen = new Set<string>(), folders = new Set<string>(), ids = new Set<string>();
  const items: DeskItem[] = [];
  for (const [index, value] of raw.entries()) {
    if (!isRecord(value) || typeof value.type !== 'string' || !['note', 'stack', 'folder'].includes(value.type)) continue;
    if (value.type === 'stack' && !isUnknownArray(value.paths)) continue;
    const folderPath = value.type === 'folder' ? value.path === '/' ? '/' : safePath(value.path) : null;
    if (value.type === 'folder' && (!folderPath || folders.has(folderPath) || folders.size >= 100)) continue;
    const source = value.type === 'note' ? [value.path] : value.type === 'stack' && isUnknownArray(value.paths) ? value.paths : [];
    const paths: string[] = [];
    for (const candidate of source) {
      const path = safePath(candidate, 'md');
      if (!path || seen.has(path) || seen.size >= 300) continue;
      seen.add(path); paths.push(path);
    }
    // A stack needs at least two distinct notes; empty groups leave no surface.
    if (!paths.length && !folderPath) continue;
    let id = typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value.id) ? value.id : `desk-${index}`;
    let suffix = 0;
    const baseId = id;
    while (ids.has(id)) id = `desk-${index}-${++suffix}-${baseId.slice(0, 40)}`;
    ids.add(id);
    const description = typeof value.description === 'string' ? singleLine(value.description).slice(0, 240) : '';
    const counts: CollectionCountSettings = {};
    if (typeof value.showNoteCount === 'boolean') counts.showNoteCount = value.showNoteCount;
    if (typeof value.showWordCount === 'boolean') counts.showWordCount = value.showWordCount;
    if (folderPath) {
      folders.add(folderPath); items.push({ id, type: 'folder', path: folderPath, ...(description ? { description } : {}), ...counts }); continue;
    }
    items.push(paths.length === 1 ? { id, type: 'note', path: paths[0] } : {
      id, type: 'stack', name: typeof value.name === 'string' ? stripControls(value.name).trim().slice(0, 80) : '', paths, ...(description ? { description } : {}), ...counts
    });
  }
  return items;
}

/** Saved collections may share references, but retain distinct identities. */
function normalizePutAwayItems(raw: unknown): DeskItem[] {
  if (!isUnknownArray(raw)) return [];
  const ids = new Set<string>();
  return raw.flatMap((value, index) => normalizeDeskItems([value]).map(item => {
    let id = item.id, suffix = 0;
    while (ids.has(id)) id = `saved-${index}-${++suffix}`;
    ids.add(id); return { ...item, id };
  }));
}

export function removeDeskNote(items: DeskItem[], path: string): DeskItem[] {
  return normalizeDeskItems(items.flatMap<DeskItem>(item => item.type === 'note'
    ? item.path === path ? [] : [item]
    : item.type === 'stack' ? [{ ...item, paths: item.paths.filter(p => p !== path) }] : [item]));
}

export interface DeskSettings {
  version: 10;
  items: DeskItem[];
  putAwayItems: DeskItem[];
  openOnStartup: boolean;
  openOnNewTab: boolean;
  pageTitle: string;
  scratchPath: string;
  widgets: Record<string, WidgetSettings>;
  widgetOrder: string[];
  toolbarActions: ToolbarControl[];
  toolbarOrder: ToolbarControl[];
}

export function safePath(value: unknown, extension?: string): string | null {
  if (typeof value !== 'string' || !value.trim() || hasControlCharacters(value)) return null;
  const path = value.trim().replace(/\\/g, '/');
  const parts = path.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || p.startsWith('.')) || /^[A-Za-z]:/.test(path)) return null;
  if (extension && !path.toLowerCase().endsWith('.' + extension)) return null;
  return path;
}

function normalizeGridPositions(raw: unknown): Partial<Record<GridColumns, GridPosition>> | undefined {
  if (!raw || typeof raw !== 'object' || isUnknownArray(raw)) return undefined;
  const positions: Partial<Record<GridColumns, GridPosition>> = {};
  for (const count of [1, 2, 4] as const) {
    const position = (raw as Record<string, unknown>)[count] as Partial<GridPosition> | undefined;
    if (position && Number.isInteger(position.column) && Number.isInteger(position.row) &&
      position.column! >= 1 && position.column! <= count && position.row! >= 1 && position.row! <= 20000) {
      positions[count] = { column: position.column!, row: position.row! };
    }
  }
  return Object.keys(positions).length ? positions : undefined;
}

export function normalizeSettings(raw: unknown): DeskSettings {
  const s = isRecord(raw) ? raw : {};
  const pins = isUnknownArray(s.pins) ? s.pins.map(p => safePath(p, 'md')).filter((p): p is string => !!p) : [];
  const savedWidgets = isRecord(s.widgets) ? s.widgets : {};
  const widgets = Object.create(null) as Record<string, WidgetSettings>;
  const fineTracks = s.version === 10;
  const sharedHeights = s.version === 8 || s.version === 9 || fineTracks;
  const unified = s.version === 6 || s.version === 7 || sharedHeights;
  const legacy = s.version !== 5 && !unified;
  const entries: [string, unknown][] = legacy
    ? ['desk', 'recents', 'scratchpad', 'base', 'daily'].map(id => [id, savedWidgets[id]] as [string, unknown])
    : Object.entries(savedWidgets);
  for (const [id, raw] of entries) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) continue;
    const value = isRecord(raw) ? raw : {};
    const key = (legacy ? id : value.type) as WidgetKey;
    if (!WIDGET_KEYS.includes(key)) continue;
    // Singleton IDs remain stable so hidden editors and their drafts can be restored.
    if (SINGLETON_WIDGETS.some(type => (type === key || type === id) && id !== key)) continue;
    const columns = value.columns === 1 || value.columns === 2 || value.columns === 3 || value.columns === 4
      ? value.columns : value.width === 'full' ? 4 : value.width === 'half' ? 2 : value.width === 'quarter' ? 1 : DEFAULT_WIDGET_COLUMNS[key];
    const rows = sharedHeights ? normalizeWidgetRows(typeof value.rows === 'number' ? value.rows * (fineTracks ? 1 : 2) : undefined, widgetDefaults(key).rows)
      : unified ? Math.max(2, Math.min(12, Number.isInteger(value.rows) ? Number(value.rows) : legacyWidgetRows(key)))
      : 3 * (value.rows === 1 || value.rows === 2 || value.rows === 3 ? value.rows : key === 'base' && columns > 1 ? 2 : 1);
    const path = legacy && key === 'base' ? s.basePath : value.path;
    const view = legacy && key === 'base' ? s.baseView : value.view;
    const title = legacy && key === 'base' ? s.baseTitle : value.title;
    const positions = normalizeGridPositions(value.positions);
    const resizeOrigins = normalizeGridPositions(value.resizeOrigins);
    const coverSize = normalizedWidgetSize(value.coverSize, sharedHeights, fineTracks);
    const listSize = normalizedWidgetSize(value.listSize, sharedHeights, fineTracks);
    // Split saved tracks without shifting any existing card's top edge.
    if (sharedHeights && !fineTracks) for (const map of [positions, resizeOrigins]) for (const position of Object.values(map || {})) position.row = (position.row - 1) * 2 + 1;
    if (!unified) for (const map of [positions, resizeOrigins]) for (const position of Object.values(map || {})) position.row = (position.row - 1) * 3 + 1;
    widgets[id] = {
      type: key,
      ...(key === 'widget-stack' ? { members: isUnknownArray(value.members) ? value.members.filter((id): id is string => typeof id === 'string') : [], activeMember: typeof value.activeMember === 'string' ? value.activeMember : '' } : {}),
      enabled: typeof value.enabled === 'boolean' ? value.enabled : key === 'base' ? s.baseEnabled === true : true,
      columns, rows,
      ...(positions ? { positions } : {}),
      ...(resizeOrigins ? { resizeOrigins } : {}),
      ...(typeof value.itemId === 'string' ? { itemId: value.itemId } : {}),
      ...(key === 'folder' ? { presentation: value.presentation === 'cover' ? 'cover' as const : 'list' as const } : {}),
      ...(coverSize ? { coverSize } : {}),
      ...(listSize ? { listSize } : {}),
      path: key === 'web' ? sourceWebUrl(path) || '' : key === 'note' ? safePath(path, 'md') || '' : isFileWidgetType(key) ? (typeof path === 'string' && matchesSourceFile(key, path.split('.').pop() || '') ? safePath(path) || '' : '') : key === 'folder' ? (path === '/' ? '/' : safePath(path) || '') : '',
      view: key === 'base' && typeof view === 'string' ? stripControls(view).replace(/[\]#|]/g, '').slice(0, 200) : '',
      title: typeof title === 'string' && title !== 'Featured Base' ? stripControls(title).trim().slice(0, 100) : '',
      ...(typeof value.showHeading === 'boolean' ? { showHeading: value.showHeading } : {}),
      ...(key === 'base' && typeof value.showBaseControls === 'boolean' ? { showBaseControls: value.showBaseControls } : {})
    };
  }
  for (const type of SINGLETON_WIDGETS) if (!widgets[type]) widgets[type] = { ...widgetDefaults(type), ...(!sharedHeights ? { rows: legacyWidgetRows(type) } : {}), enabled: false };
  const order = isUnknownArray(s.widgetOrder) ? s.widgetOrder.filter((id): id is string => typeof id === 'string' && !!widgets[id]) : [];
  const settings: DeskSettings = {
    version: 10,
    items: normalizeDeskItems(isUnknownArray(s.items) ? s.items : pins.map((path, index) => ({ id: `note-${index}`, type: 'note', path }))),
    putAwayItems: normalizePutAwayItems(s.putAwayItems),
    openOnStartup: typeof s.openOnStartup === 'boolean' ? s.openOnStartup : false,
    openOnNewTab: typeof s.openOnNewTab === 'boolean' ? s.openOnNewTab : true,
    pageTitle: typeof s.pageTitle === 'string' ? stripControls(s.pageTitle).trim().slice(0, 100) : s.showHeading === false ? '' : 'Top of the Desk',
    scratchPath: safePath(s.scratchPath, 'md') || 'Desk scratchpad.md',
    toolbarActions: normalizeToolbarActions(s.toolbarActions),
    toolbarOrder: normalizeToolbarOrder(s.toolbarOrder),
    widgets,
    widgetOrder: [...new Set([...order, ...Object.keys(widgets)])]
  };
  if (!unified) migrateDesk(settings);
  syncDeskWidgets(settings);
  if (!sharedHeights) migrateHeightGrid(settings);
  enforceCompactPresentation(settings);
  return settings;
}

function normalizedWidgetSize(value: unknown, sharedHeights: boolean, fineTracks: boolean): WidgetSize | undefined {
  const size = value as WidgetSize | undefined;
  if (!size || !Number.isInteger(size.columns) || size.columns < 1 || size.columns > 4 || !Number.isInteger(size.rows) || size.rows < (sharedHeights && !fineTracks ? 1 : 2) || size.rows > (sharedHeights && !fineTracks ? 6 : 12)) return undefined;
  return { columns: size.columns, rows: sharedHeights ? normalizeWidgetRows(size.rows * (fineTracks ? 1 : 2)) : size.rows };
}

/** Reflow each saved pane layout once, retaining columns and vertical order on the new grid. */
function migrateHeightGrid(settings: DeskSettings): void {
  const previousPositions = new Map(Object.entries(settings.widgets).map(([id, widget]) => [id, widget.positions]));
  for (const widget of Object.values(settings.widgets)) {
    widget.rows = migrateWidgetRows(widget.rows);
    for (const size of [widget.coverSize, widget.listSize]) if (size) size.rows = migrateWidgetRows(size.rows);
    if (widget.positions) widget.positions = Object.fromEntries(Object.entries(widget.positions).map(([columns, position]) =>
      [columns, { column: position.column, row: Math.floor((position.row - 1) / 2) * 2 + 1 }]));
    // Resizing starts from the migrated layout, never an obsolete slot on the old grid.
    delete widget.resizeOrigins;
  }
  for (const columns of [1, 2, 4] as const) {
    const ids = settings.widgetOrder.filter(id => isRootWidget(settings, id) && previousPositions.get(id)?.[columns]);
    ids.sort((a, b) => {
      const first = previousPositions.get(a)![columns]!, second = previousPositions.get(b)![columns]!;
      return first.row - second.row || first.column - second.column;
    });
    const nextRow = Array<number>(columns).fill(1);
    for (const id of ids) {
      const widget = settings.widgets[id], previous = previousPositions.get(id)![columns]!;
      const width = Math.min(columns, widget.columns), column = Math.min(previous.column, columns - width + 1);
      const row = Math.max(...nextRow.slice(column - 1, column - 1 + width));
      widget.positions = { ...widget.positions, [columns]: { column, row } };
      nextRow.fill(row + widget.rows, column - 1, column - 1 + width);
    }
  }
}

export const itemWidgetId = (id: string): string => `item-${id}`;
export const isCoverWidget = (widget: WidgetSettings): boolean => !!widget.itemId && (widget.type !== 'folder' || widget.presentation !== 'list');

/** Content metadata and placement are separate; there is exactly one surface per item. */
export function syncDeskWidgets(settings: DeskSettings): void {
  const active = new Set(settings.items.map(item => item.id));
  const items = new Map([...settings.putAwayItems, ...settings.items].map(item => [item.id, item]));
  for (const [id, widget] of Object.entries(settings.widgets)) {
    if (widget.type === 'desk' || widget.itemId && (!items.has(widget.itemId) || id !== itemWidgetId(widget.itemId)) || (widget.type === 'note' || widget.type === 'stack') && !widget.itemId) delete settings.widgets[id];
  }
  for (const item of items.values()) {
    const id = itemWidgetId(item.id), previous = settings.widgets[id];
    settings.widgets[id] = {
      ...widgetDefaults(item.type), ...previous, type: item.type, itemId: item.id, enabled: active.has(item.id),
      path: item.type === 'stack' ? '' : item.path,
      title: item.type === 'stack' ? item.name || 'Stack' : item.type === 'folder' ? previous?.title || '' : '',
      ...(item.type === 'folder' ? { presentation: previous?.presentation || 'cover' } : {}),
    };
    if (!settings.widgetOrder.includes(id)) settings.widgetOrder.push(id);
  }
  normalizeWidgetStacks(settings);
  enforceCompactPresentation(settings);
  settings.widgetOrder = [...new Set(settings.widgetOrder.filter(id => !!settings.widgets[id]))];
}

/** Compact sources have one size, including stacks made entirely from them. */
export function isFixedSizeWidget(settings: DeskSettings, id: string): boolean {
  const widget = settings.widgets[id];
  return !!widget && (isCompactSourceType(widget.type) || widget.type === 'widget-stack' && !!widget.members?.length &&
    widget.members.every(member => isCompactSourceType(settings.widgets[member]?.type || '')));
}
function enforceCompactPresentation(settings: DeskSettings): void {
  for (const [id, widget] of Object.entries(settings.widgets)) {
    // The title is the identity of these cards, including saved and stacked members.
    if (isCompactSourceType(widget.type)) widget.showHeading = true;
    if (isFixedSizeWidget(settings, id)) {
      widget.columns = 1;
      // Stacks retain space for their navigation; individual sources use the finer track.
      widget.rows = widget.type === 'widget-stack' ? HALF_HEIGHT : COMPACT_HEIGHT;
      delete widget.resizeOrigins;
    }
  }
}

/** Widget stacks are flat groups of non-note surfaces; source identities stay intact. */
export function canStackWidget(widget: WidgetSettings | undefined): boolean {
  return !!widget && widget.type !== 'note' && widget.type !== 'stack' && widget.type !== 'desk';
}
export function widgetStackFor(settings: DeskSettings, id: string): string | undefined {
  return settings.widgetOrder.find(key => settings.widgets[key]?.type === 'widget-stack' && settings.widgets[key].members?.includes(id));
}
/** Build once per rendering/layout pass; do not retain across membership changes. */
export function widgetStackOwners(settings: DeskSettings): ReadonlyMap<string, string> {
  const owners = new Map<string, string>();
  for (const id of settings.widgetOrder) {
    const widget = settings.widgets[id];
    if (widget?.type === 'widget-stack') for (const member of widget.members || []) if (!owners.has(member)) owners.set(member, id);
  }
  return owners;
}
export function canHideWidgetHeading(widget: WidgetSettings | undefined): boolean {
  return !!widget && widget.type !== 'widget-stack' && !isCompactSourceType(widget.type);
}
/** A stack's heading preference only controls members with optional headings. */
export function widgetHeadingState(settings: DeskSettings, id: string): boolean | 'mixed' | null {
  const widget = settings.widgets[id];
  if (!widget) return null;
  const candidates = (widget.type === 'widget-stack' ? widget.members || [] : [id])
    .map(key => settings.widgets[key]).filter(canHideWidgetHeading);
  if (!candidates.length) return null;
  if (candidates.every(member => member.showHeading !== false)) return true;
  if (candidates.every(member => member.showHeading === false)) return false;
  return 'mixed';
}
export function isRootWidget(settings: DeskSettings, id: string, owners?: ReadonlyMap<string, string>): boolean {
  return !!settings.widgets[id]?.enabled && !(owners ? owners.get(id) : widgetStackFor(settings, id));
}
export function isEnabledWidget(settings: DeskSettings, id: string): boolean {
  if (!settings.widgets[id]?.enabled) return false;
  const owner = widgetStackFor(settings, id);
  return !owner || !!settings.widgets[owner]?.enabled;
}
export function isVisibleWidget(settings: DeskSettings, id: string, owners?: ReadonlyMap<string, string>): boolean {
  if (!settings.widgets[id]?.enabled) return false;
  const owner = owners ? owners.get(id) : widgetStackFor(settings, id);
  return !owner || !!settings.widgets[owner]?.enabled && settings.widgets[owner].activeMember === id;
}
function normalizeWidgetStacks(settings: DeskSettings): void {
  const claimed = new Set<string>();
  for (const id of settings.widgetOrder) {
    const stack = settings.widgets[id];
    if (stack?.type !== 'widget-stack') continue;
    stack.members = (stack.members || []).filter(member => {
      const widget = settings.widgets[member];
      if (!widget?.enabled || widget.type === 'widget-stack' || !canStackWidget(widget) || claimed.has(member)) return false;
      claimed.add(member); return true;
    });
    if (!stack.members.length) { delete settings.widgets[id]; continue; }
    if (!stack.members.includes(stack.activeMember || '')) stack.activeMember = stack.members[0];
  }
}

/** Lift nested covers into the common grid once; keep old folder browsers as list presentations. */
function migrateDesk(settings: DeskSettings): void {
  const desk = settings.widgets.desk;
  const nested = [...settings.items];
  if (desk && !desk.enabled) {
    settings.putAwayItems = normalizePutAwayItems([...nested, ...settings.putAwayItems]);
    settings.items = [];
  }
  for (const item of [...settings.items, ...settings.putAwayItems]) {
    const id = itemWidgetId(item.id);
    if (!settings.widgets[id]) settings.widgets[id] = { ...widgetDefaults(item.type), rows: 2, itemId: item.id, ...(item.type === 'folder' ? { presentation: 'cover' as const } : {}) };
  }
  // Coalesce the two former folder types by source, retaining cover details and browser settings.
  for (const [id, widget] of Object.entries(settings.widgets)) {
    if (widget.type !== 'folder' || widget.itemId || !widget.path) continue;
    let item = [...settings.items, ...settings.putAwayItems].find(item => item.type === 'folder' && item.path === widget.path);
    if (!item) {
      item = { id: `folder-${id}`.slice(0, 80), type: 'folder', path: widget.path };
      (widget.enabled ? settings.items : settings.putAwayItems).push(item);
    } else if (widget.enabled && !settings.items.some(active => active.id === item!.id)) {
      settings.items.push(item); settings.putAwayItems = settings.putAwayItems.filter(saved => saved.id !== item!.id);
    }
    const surfaceId = itemWidgetId(item.id);
    const prior = settings.widgets[surfaceId];
    const keepCover = !widget.enabled && settings.items.some(active => active.id === item.id);
    settings.widgets[surfaceId] = {
      ...widget, ...(keepCover ? prior : {}), itemId: item.id,
      title: prior?.title || widget.title, presentation: keepCover ? 'cover' : 'list',
      coverSize: { columns: 1, rows: 2 }, listSize: { columns: widget.columns, rows: widget.rows },
    };
    settings.widgetOrder = settings.widgetOrder.map(key => key === id ? surfaceId : key);
    delete settings.widgets[id];
  }
  const ids = nested.map(item => itemWidgetId(item.id));
  settings.widgetOrder = settings.widgetOrder.flatMap(id => id === 'desk' ? ids : [id]);
  for (const columns of [1, 2, 4] as const) {
    const origin = desk?.positions?.[columns];
    if (!origin) continue;
    const covers = nested.filter(item => settings.widgets[itemWidgetId(item.id)]?.presentation !== 'list');
    const coverIds = new Set(covers.map(item => itemWidgetId(item.id)));
    // Use spare columns beside the former container without crossing an existing item.
    let width = Math.min(columns - origin.column + 1, desk.columns);
    for (let candidate = width + 1; candidate <= columns - origin.column + 1; candidate++) {
      const rows = Math.ceil(covers.length / candidate) * 2;
      const blocked = Object.entries(settings.widgets).some(([id, widget]) => {
        const position = widget.positions?.[columns];
        return id !== 'desk' && !coverIds.has(id) && widget.enabled && position &&
          position.column < origin.column + candidate && origin.column < position.column + Math.min(columns, widget.columns) &&
          position.row < origin.row + rows && origin.row < position.row + widget.rows;
      });
      if (!blocked) width = candidate;
    }
    covers.forEach((item, index) => {
      const widget = settings.widgets[itemWidgetId(item.id)];
      if (!widget) return;
      widget.positions = { ...widget.positions, [columns]: { column: Math.min(columns, origin.column + index % width), row: origin.row + Math.floor(index / width) * 2 } };
    });
    if (desk.enabled) {
      const difference = Math.ceil(covers.length / width) * 2 - desk.rows;
      for (const [id, widget] of Object.entries(settings.widgets)) {
        if (id === 'desk' || covers.some(item => itemWidgetId(item.id) === id)) continue;
        for (const positions of [widget.positions, widget.resizeOrigins]) {
          const position = positions?.[columns];
          if (position && position.row >= origin.row + desk.rows) position.row = Math.max(1, position.row + difference);
        }
      }
    }
  }
  delete settings.widgets.desk;
}

export function renamePath(path: string, oldPath: string, nextPath: string): string {
  return path === oldPath ? nextPath : path.startsWith(oldPath + '/') ? nextPath + path.slice(oldPath.length) : path;
}

export function movePin(pins: string[], path: string, destination: number): string[] {
  if (!pins.includes(path)) return pins;
  const next = pins.filter(p => p !== path);
  next.splice(Math.max(0, Math.min(destination, next.length)), 0, path);
  return next;
}

export function recentPaths(history: string[], exists: (path: string) => boolean): string[] {
  return [...new Set(history)].filter(path => path.endsWith('.md') && exists(path));
}

/** Omit footnote definitions, including indented continuation paragraphs. */
function withoutFootnotes(markdown: string): string {
  let definition = false;
  return markdown.split(/\r?\n/).filter(line => {
    if (/^[ \t]{0,3}\[\^[^\]\r\n]+\]:/.test(line)) { definition = true; return false; }
    if (definition && (!line.trim() || /^(?: {4}|\t)/.test(line))) return false;
    definition = false;
    return true;
  }).join('\n');
}

export function excerpt(markdown: string, summary?: unknown): string {
  let text = typeof summary === 'string' && summary.trim() ? summary : withoutFootnotes(markdown)
    .replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
    .replace(/%%[\s\S]*?%%/g, '')
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
    // Footnote destinations belong to the note, not its short cover preview.
    .replace(/\[\^[^\]\r\n]+\]|\^\[[^\]\r\n]*\]/g, '')
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match: string, target: string, alias: string | undefined) => alias || target)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:>\s*|[-*+]\s+(?:\[[ xX]\]\s*)?|\d+\.\s+)/gm, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[*_`~]/g, '');
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > 200 ? text.slice(0, 197).trimEnd() + '…' : text;
}

/** Keep the original YAML block, including its line endings, out of the editor. */
export function splitFrontmatter(text: string): { prefix: string; body: string } {
  const opening = /^\uFEFF?---[ \t]*\r?\n/.exec(text);
  if (!opening) return { prefix: '', body: text };
  let start = opening[0].length;
  while (start < text.length) {
    const newline = text.indexOf('\n', start);
    const end = newline < 0 ? text.length : newline;
    const line = text.slice(start, end).replace(/\r$/, '');
    if (/^---[ \t]*$/.test(line)) {
      const boundary = newline < 0 ? end : end + 1;
      return { prefix: text.slice(0, boundary), body: text.slice(boundary) };
    }
    if (newline < 0) break;
    start = newline + 1;
  }
  // An unclosed block is shown as text so its contents cannot disappear.
  return { prefix: '', body: text };
}

export interface Recovery { path: string; baseline: string | null; text: string; }
export function validRecovery(value: unknown, path: string): Recovery | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Recovery;
  return r.path === path && (r.baseline === null || typeof r.baseline === 'string') && typeof r.text === 'string' ? r : null;
}
