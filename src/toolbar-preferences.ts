import { COPY } from './copy';
import { isUnknownArray } from './validation';

/** Shared labels and icons for settings, floating controls, and Edit. */
export const TOOLBAR_ACTIONS = [
  { id: 'move', label: COPY.move, icon: 'grip-vertical' },
  { id: 'resize', label: COPY.resize, icon: 'top-of-the-desk-resize' },
  { id: 'addNotes', label: COPY.addNotes, icon: 'plus', scope: 'Note stacks only' },
  { id: 'heading', label: COPY.hideHeading, icon: 'heading' },
  { id: 'baseToolbar', label: COPY.hideBaseControls, icon: 'panel-top' },
  { id: 'unstack', label: COPY.unstack, icon: 'top-of-the-desk-unstack', scope: 'Stacks only' },
  { id: 'remove', label: COPY.removeFromDesk, icon: 'archive' },
] as const;

export type ToolbarAction = typeof TOOLBAR_ACTIONS[number]['id'];
export type ToolbarControl = ToolbarAction | 'edit';
export const DEFAULT_TOOLBAR_ACTIONS: readonly ToolbarControl[] = ['resize', 'edit', 'addNotes'];
export const DEFAULT_TOOLBAR_ORDER: readonly ToolbarControl[] = ['move', 'resize', 'edit', 'addNotes', 'heading', 'baseToolbar', 'unstack', 'remove'];

/** Keep saved positions, always retain Edit, and append newly introduced controls. */
export function normalizeToolbarOrder(value: unknown): ToolbarControl[] {
  const order: ToolbarControl[] = [];
  if (isUnknownArray(value)) for (const id of value) {
    const known = DEFAULT_TOOLBAR_ORDER.find(key => key === id);
    if (known && !order.includes(known)) order.push(known);
  }
  return [...order, ...DEFAULT_TOOLBAR_ORDER.filter(id => !order.includes(id))];
}

/** Every control is opt-in; an explicit empty selection hides the toolbar. */
export function normalizeToolbarActions(value: unknown): ToolbarControl[] {
  if (!isUnknownArray(value)) return [...DEFAULT_TOOLBAR_ACTIONS];
  return DEFAULT_TOOLBAR_ORDER.filter(id => value.includes(id));
}
