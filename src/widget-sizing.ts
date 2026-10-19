/** Fine tracks fit two compact cards, including their gap, into one half-height card. */
export const COMPACT_HEIGHT = 1;
export const HALF_HEIGHT = 2;
export const STANDARD_HEIGHT = 4;
export const WIDGET_HEIGHTS = [
  { rows: HALF_HEIGHT, label: 'Half height' },
  { rows: STANDARD_HEIGHT, label: 'Standard height' },
  { rows: 8, label: 'Double height' },
  { rows: 12, label: 'Triple height' },
] as const;

export function normalizeWidgetRows(value: unknown, fallback = STANDARD_HEIGHT): number {
  const rows = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return WIDGET_HEIGHTS.find(size => size.rows >= rows)?.rows ?? WIDGET_HEIGHTS[WIDGET_HEIGHTS.length - 1].rows;
}

/** Translate the previous 2/3/4/6/9/12-row choices into the shared height scale. */
export function migrateWidgetRows(rows: number): number {
  return rows <= 2 ? HALF_HEIGHT : rows <= 4 ? STANDARD_HEIGHT : rows <= 8 ? 8 : 12;
}
