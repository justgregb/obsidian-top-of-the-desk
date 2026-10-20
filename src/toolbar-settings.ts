import { Component, Setting, setIcon } from 'obsidian';
import type DeskPlugin from './main';
import { DESK_ACTION_ICONS } from './collection-icons';
import { ControlTooltips } from './control-tooltips';
import { COPY } from './copy';
import { PointerDrag } from './pointer-drag';
import { DEFAULT_TOOLBAR_ACTIONS, DEFAULT_TOOLBAR_ORDER, TOOLBAR_ACTIONS, type ToolbarControl } from './toolbar-preferences';
import { reconcileChildren, updateAttribute } from './ui';

/** The preview is the editor: reusable icon buttons toggle and reorder controls. */
export function renderToolbarSettings(setting: Setting, plugin: DeskPlugin): () => void {
  setting.settingEl.addClass('tod-toolbar-setting');
  const container = setting.settingEl.createDiv('tod-toolbar-settings');
  const top = container.createDiv('tod-toolbar-settings-top');
  const preview = top.createDiv({ cls: 'tod-toolbar-preview', attr: { role: 'group', 'aria-label': 'Toolbar controls' } });
  const shortcuts = top.createDiv('tod-toolbar-presets');
  const status = container.createDiv({ cls: 'tod-toolbar-status', attr: { role: 'status', 'aria-live': 'polite' } });
  const buttons = new Map<ToolbarControl, { el: HTMLButtonElement; label: string; scope: string }>();
  const owner = plugin.addChild(new Component());
  const tooltips = owner.addChild(new ControlTooltips(container, '.tod-toolbar-choice'));
  let target: { id: ToolbarControl; after: boolean } | null = null;
  let renderedOrder = '';

  function refresh(): void {
    const { toolbarOrder, toolbarActions } = plugin.settings;
    const order = toolbarOrder.join(',');
    if (order !== renderedOrder) {
      reconcileChildren(preview, toolbarOrder.map(id => buttons.get(id)!.el));
      renderedOrder = order;
    }
    for (const id of toolbarOrder) {
      const { el, label, scope } = buttons.get(id)!;
      const shown = toolbarActions.includes(id);
      updateAttribute(el, 'aria-pressed', String(shown));
      if (el.hasClass('is-hidden-control') === shown) el.toggleClass('is-hidden-control', !shown);
      const hint = shown ? 'Click to hide' : 'Click to show';
      updateAttribute(el, 'data-tod-tooltip', [label, scope, hint].filter(Boolean).join(' · '));
    }
    tooltips.refresh();
  }
  function reorder(order: ToolbarControl[], id: ToolbarControl): void {
    plugin.setToolbarOrder(order); refresh();
    buttons.get(id)!.el.focus({ preventScroll: true });
    status.setText(`${buttons.get(id)!.label}, position ${order.indexOf(id) + 1} of ${order.length}.`);
  }
  function move(id: ToolbarControl, step: number): void {
    const order = [...plugin.settings.toolbarOrder], from = order.indexOf(id), to = from + step;
    if (to < 0 || to >= order.length) return;
    order.splice(from, 1); order.splice(to, 0, id); reorder(order, id);
  }
  function clearDrop(): void {
    if (target) buttons.get(target.id)!.el.removeClasses(['is-drop-before', 'is-drop-after']);
    target = null;
  }
  function dropTarget(x: number, y: number): typeof target {
    const bounds = preview.getBoundingClientRect();
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
    let nearest: typeof target = null, distance = Infinity;
    const rtl = preview.ownerDocument.defaultView!.getComputedStyle(preview).direction === 'rtl';
    for (const [id, { el }] of buttons) {
      const rect = el.getBoundingClientRect(), center = rect.left + rect.width / 2;
      const next = (x - center) ** 2 + (y - rect.top - rect.height / 2) ** 2;
      if (next < distance) { distance = next; nearest = { id, after: rtl ? x < center : x > center }; }
    }
    return nearest;
  }
  const drag = owner.addChild(new PointerDrag<ToolbarControl>({
    label: id => buttons.get(id)!.label,
    begin: id => { tooltips.hide(); buttons.get(id)!.el.addClass('is-reordering'); },
    move: (id, x, y) => {
      const next = dropTarget(x, y);
      if (target?.id !== next?.id || target?.after !== next?.after) {
        clearDrop(); target = next;
        if (target && target.id !== id) buttons.get(target.id)!.el.addClass(target.after ? 'is-drop-after' : 'is-drop-before');
      }
      return !!next;
    },
    drop: (id, x, y) => {
      const next = dropTarget(x, y);
      if (!next || next.id === id) return;
      const order = plugin.settings.toolbarOrder.filter(key => key !== id);
      order.splice(order.indexOf(next.id) + Number(next.after), 0, id); reorder(order, id);
    },
    end: () => { clearDrop(); for (const { el } of buttons.values()) el.removeClass('is-reordering'); },
  }));
  owner.register(drag.delegate(preview, element => {
    const el = element.closest<HTMLButtonElement>('.tod-toolbar-choice');
    const id = el?.dataset.toolbarControl;
    const value = DEFAULT_TOOLBAR_ORDER.find(key => key === id);
    return el && value && preview.contains(el) ? { handle: el, source: el, value } : null;
  }));
  const cleanup = () => plugin.removeChild(owner);
  owner.registerDomEvent(container.ownerDocument.defaultView!, 'unload', cleanup);

  shortcuts.createEl('button', { text: 'Reset', attr: { type: 'button' } }).onclick = () => {
    plugin.batchEdit(() => { plugin.setToolbarActions(DEFAULT_TOOLBAR_ACTIONS); plugin.setToolbarOrder(DEFAULT_TOOLBAR_ORDER); });
    refresh(); status.setText('Default controls and order restored.');
  };
  for (const id of DEFAULT_TOOLBAR_ORDER) {
    const definition = id === 'edit' ? { label: COPY.edit, icon: DESK_ACTION_ICONS.edit } : TOOLBAR_ACTIONS.find(action => action.id === id)!;
    const { label, icon } = definition, scope = 'scope' in definition ? definition.scope : '';
    const el = preview.createEl('button', { cls: 'tod-toolbar-choice tod-touch-drag-handle', attr: {
      type: 'button', 'data-toolbar-control': id, 'aria-label': label, 'aria-keyshortcuts': 'ArrowLeft ArrowRight',
      'aria-description': [scope, 'Toggle visibility in the toolbar.', 'Drag or use the left and right arrow keys to reorder.'].filter(Boolean).join(' '),
    } });
    setIcon(el, icon);
    el.onclick = () => {
      const shown = plugin.settings.toolbarActions.includes(id);
      plugin.setToolbarActions(shown ? plugin.settings.toolbarActions.filter(key => key !== id) : [...plugin.settings.toolbarActions, id]);
      refresh();
      status.setText(plugin.settings.toolbarActions.length ? `${label} ${shown ? 'hidden from' : 'shown in'} the toolbar.` : 'Toolbar hidden.');
    };
    el.onkeydown = event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const rtl = el.ownerDocument.defaultView!.getComputedStyle(preview).direction === 'rtl';
      const step = event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : event.key === 'ArrowRight' ? (rtl ? -1 : 1) : event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
      if (!step) return;
      event.preventDefault(); event.stopPropagation(); move(id, step);
    };
    buttons.set(id, { el, label, scope });
  }
  refresh();
  return cleanup;
}
