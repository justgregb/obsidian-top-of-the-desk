import { type DeskSettings, isFixedSizeWidget, widgetHeadingState } from './model';
import { type ToolbarAction } from './toolbar-preferences';

/** Stack-wide actions use the root; source-specific actions use its active member. */
export function toolbarState(settings: DeskSettings, id: string, memberId?: string): {
  sourceId: string;
  heading: ReturnType<typeof widgetHeadingState>;
  baseHidden: boolean;
  edit: boolean;
  available: Record<ToolbarAction, boolean>;
} {
  const root = settings.widgets[id];
  const sourceId = memberId || (root?.type === 'widget-stack' ? root.activeMember || root.members?.[0] || id : id);
  const source = settings.widgets[sourceId];
  const enabled = !!root?.enabled && !!source;
  const heading = enabled ? widgetHeadingState(settings, id) : null;
  const available: Record<ToolbarAction, boolean> = {
    move: enabled,
    resize: enabled && !isFixedSizeWidget(settings, id),
    addNotes: enabled && source.type === 'stack' && !!source.itemId,
    heading: heading !== null,
    baseToolbar: enabled && source.type === 'base',
    unstack: enabled && (root.type === 'widget-stack' || root.type === 'stack'),
    remove: enabled,
  };
  return {
    sourceId, heading, baseHidden: source?.showBaseControls === false,
    edit: enabled && settings.toolbarActions.includes('edit'),
    available,
  };
}
