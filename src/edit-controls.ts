import { Modal, Setting, setIcon } from 'obsidian';
import type DeskPlugin from './main';
import { COPY } from './copy';
import { DESK_ACTION_ICONS, setUnstackIcon } from './collection-icons';
import { widgetHeadingState, widgetName } from './model';
import { isCompactSourceType } from './source-types';
import { setupDialogHeader } from './dialog-header';
import { UndoOrigin, undoOrigin } from './undo-notice';

/** Shared, deferred appearance preferences and explicit actions for every Edit dialog. */
export class EditControls {
  acted = false;
  private showHeading?: boolean;
  private showBaseControls?: boolean;

  constructor(private plugin: DeskPlugin, private modal: Modal, private rootId: string, private sourceId = rootId, private onChange: () => void = () => {}) {}

  get dirty(): boolean { return this.showHeading !== undefined || this.showBaseControls !== undefined; }

  preferences(parent: HTMLElement): void {
    const root = this.plugin.settings.widgets[this.rootId], source = this.plugin.settings.widgets[this.sourceId];
    if (!root || !source) return;
    if (root.type === 'widget-stack') parent.createEl('p', { cls: 'tod-form-help', text: `Editing ${widgetName(source)}. Unstack and Remove from desk apply to the whole stack.` });
    const heading = widgetHeadingState(this.plugin.settings, this.rootId);
    const hasHeading = heading !== null && !isCompactSourceType(source.type);
    if (!hasHeading && source.type !== 'base') return;
    const options = parent.createDiv('tod-edit-options');
    if (hasHeading) {
      const label = root.type === 'widget-stack' ? 'Hide headings' : COPY.hideHeading;
      const setting = new Setting(options).setName(label).addToggle(toggle => {
        toggle.setValue(heading === false).onChange(hidden => { this.showHeading = hidden === (heading === false) ? undefined : !hidden; this.onChange(); });
        toggle.toggleEl.addClass('mod-small'); toggle.toggleEl.setAttribute('aria-label', label);
      });
      if (root.type === 'widget-stack') setting.setDesc(heading === 'mixed' ? 'Some headings are hidden. Applies to items with optional headings.' : 'Applies to items with optional headings.');
    }
    if (source.type === 'base') new Setting(options).setName(COPY.hideBaseControls).addToggle(toggle => {
      toggle.setValue(source.showBaseControls === false).onChange(hidden => { this.showBaseControls = hidden === (source.showBaseControls === false) ? undefined : !hidden; this.onChange(); });
      toggle.toggleEl.addClass('mod-small'); toggle.toggleEl.setAttribute('aria-label', COPY.hideBaseControls);
    });
  }

  save(): void {
    if (this.showHeading !== undefined) this.plugin.setWidgetHeading(this.rootId, this.showHeading);
    if (this.showBaseControls !== undefined) this.plugin.setBaseControls(this.sourceId, this.showBaseControls);
  }

  actions(parent: HTMLElement): void {
    const root = this.plugin.settings.widgets[this.rootId];
    if (!root) return;
    const actions = parent.createDiv({ cls: 'tod-edit-actions', attr: { role: 'group', 'aria-label': COPY.actions } });
    const action = (label: string, icon: string, run: (origin?: UndoOrigin) => void) => {
      const button = actions.createEl('button', { attr: { type: 'button' } });
      const symbol = button.createSpan({ attr: { 'aria-hidden': 'true' } });
      setIcon(symbol, icon); button.createSpan({ text: label });
      button.onclick = event => {
        if (this.acted || !this.plugin.settings.widgets[this.rootId]?.enabled) return;
        const origin = undoOrigin(event);
        this.acted = true; this.modal.close(); run(origin);
      };
      return symbol;
    };
    if (root.type === 'widget-stack' || root.type === 'stack') {
      const symbol = action(COPY.unstack, 'unfold-horizontal', origin => {
        const current = this.plugin.settings.widgets[this.rootId];
        if (!current) return;
        const focusId = current.type === 'widget-stack' ? current.activeMember || current.members?.[0] : this.rootId;
        if (current.type === 'widget-stack') this.plugin.takeWidgetOut(this.rootId, undefined, origin);
        else if (current.type === 'stack' && current.itemId) this.plugin.unstack(current.itemId, origin);
        if (focusId) this.plugin.revealDeskWidget(focusId, false);
      });
      setUnstackIcon(symbol);
    }
    action(COPY.removeFromDesk, DESK_ACTION_ICONS.remove, origin => this.plugin.removeFromDesk(this.rootId, origin));
  }
}

/** Notes and writing tools share Edit without needing an extra menu or source form. */
export class ItemEditModal extends Modal {
  private release: () => void;
  private controls?: EditControls;
  constructor(private plugin: DeskPlugin, private id: string, private sourceId: string, private restoreFocus?: () => void) {
    super(plugin.app); this.release = plugin.trackWidgetDialog(this);
  }
  onOpen(): void {
    if (!this.plugin.settings.widgets[this.id]?.enabled) { this.close(); return; }
    this.setTitle(COPY.edit); setupDialogHeader(this);
    const form = this.contentEl.createEl('form', { cls: 'tod-widget-form' });
    form.createEl('p', { cls: 'tod-form-help', text: COPY.deskOnly });
    let updateSave = () => {};
    this.controls = new EditControls(this.plugin, this, this.id, this.sourceId, () => updateSave());
    this.controls.preferences(form);
    const actions = form.createDiv('tod-dialog-actions');
    actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } }).onclick = () => this.close();
    const submit = actions.createEl('button', { text: 'Save', cls: 'mod-cta', attr: { type: 'submit' } });
    updateSave = () => { submit.disabled = !this.controls?.dirty; }; updateSave();
    this.controls.actions(form);
    form.onsubmit = event => { event.preventDefault(); if (submit.disabled) return; this.plugin.batchEdit(() => this.controls?.save()); this.close(); };
  }
  onClose(): void {
    this.release(); this.contentEl.empty();
    if (!this.controls?.acted && this.restoreFocus) queueMicrotask(this.restoreFocus);
  }
}
