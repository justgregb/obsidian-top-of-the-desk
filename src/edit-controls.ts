import { Modal, setIcon, setTooltip } from 'obsidian';
import type DeskPlugin from './main';
import { COPY } from './copy';
import { widgetName, type WidgetSize } from './model';
import { TOOLBAR_ACTIONS } from './toolbar-preferences';
import { toolbarState } from './toolbar-state';
import { setupDialogHeader } from './dialog-header';
import { UndoOrigin, undoOrigin } from './undo-notice';

/** Shared, deferred appearance preferences and explicit actions for every Edit dialog. */
export class EditControls {
  acted = false;
  private showHeading?: boolean;
  private showBaseControls?: boolean;
  private size?: WidgetSize;
  private leavingActions: HTMLButtonElement[] = [];
  private unsaved = false;

  constructor(private plugin: DeskPlugin, private modal: Modal, private rootId: string, private sourceId = rootId, private onChange: () => void = () => {}) {
    modal.modalEl.addClass('tod-edit-dialog');
  }

  get dirty(): boolean { return this.showHeading !== undefined || this.showBaseControls !== undefined || this.size !== undefined; }

  /** Actions that close Edit must not silently discard a source or appearance draft. */
  setUnsaved(unsaved: boolean): void {
    this.unsaved = unsaved;
    for (const button of this.leavingActions) {
      button.setAttribute('aria-disabled', String(unsaved));
      setTooltip(button, unsaved ? 'Save or cancel your changes first' : button.textContent || '');
      button.setAttribute('aria-label', button.textContent || '');
    }
  }

  close(): void { this.plugin.sizePicker.closeWithin(this.modal.contentEl); }

  save(): void {
    if (this.size) this.plugin.setWidgetSize(this.rootId, this.size, this.plugin.deskColumns);
    if (this.showHeading !== undefined) this.plugin.setWidgetHeading(this.rootId, this.showHeading);
    if (this.showBaseControls !== undefined) this.plugin.setBaseControls(this.sourceId, this.showBaseControls);
  }

  actions(parent: HTMLElement): void {
    const root = this.plugin.settings.widgets[this.rootId], source = this.plugin.settings.widgets[this.sourceId];
    if (!root || !source) return;
    if (root.type === 'widget-stack') parent.createEl('p', { cls: 'tod-form-help', text: `Editing ${widgetName(source)}. Move, Resize, Unstack, and Remove from desk apply to the whole stack.` });
    const actions = parent.createDiv({ cls: 'tod-edit-actions', attr: { role: 'group', 'aria-label': COPY.actions } });
    const state = toolbarState(this.plugin.settings, this.rootId, this.sourceId);
    const action = (label: string, icon: string, run: (button: HTMLButtonElement, origin?: UndoOrigin) => void, leaves = false) => {
      const button = actions.createEl('button', { attr: { type: 'button' } });
      const symbol = button.createSpan({ attr: { 'aria-hidden': 'true' } });
      setIcon(symbol, icon); button.createSpan({ text: label });
      button.onclick = event => {
        if (this.acted || !this.plugin.settings.widgets[this.rootId]?.enabled) return;
        const origin = undoOrigin(event);
        if (leaves) {
          if (this.unsaved) return;
          this.acted = true; this.modal.close();
        }
        run(button, origin);
      };
      if (leaves) this.leavingActions.push(button);
      return button;
    };
    for (const id of this.plugin.settings.toolbarOrder) {
      const definition = TOOLBAR_ACTIONS.find(action => action.id === id);
      if (!definition) continue;
      const key = definition.id;
      if (!state.available[key]) continue;
      if (key === 'heading' || key === 'baseToolbar') {
        const heading = key === 'heading';
        const label = heading && root.type === 'widget-stack' ? 'Hide headings' : definition.label;
        const initial = heading ? state.heading : !state.baseHidden;
        const current = () => (heading ? this.showHeading : this.showBaseControls) ?? initial;
        const update = (button: HTMLButtonElement) => {
          const shown = current();
          button.setAttribute('aria-pressed', shown === 'mixed' ? 'mixed' : String(shown === false));
        };
        const button = action(label, definition.icon, button => {
          const shown = current() === false;
          if (heading) this.showHeading = shown === initial ? undefined : shown;
          else this.showBaseControls = shown === initial ? undefined : shown;
          update(button); this.onChange();
        });
        if (heading && root.type === 'widget-stack') {
          button.setAttribute('aria-description', 'Applies to items with optional headings.');
          setTooltip(button, 'Applies to items with optional headings.');
          button.setAttribute('aria-label', label);
        }
        update(button);
      } else if (key === 'resize') {
        const resize = action(definition.label, definition.icon, button => {
          const current = this.plugin.settings.widgets[this.rootId];
          if (!current) return;
          this.plugin.sizePicker.open(button, this.size || current, size => {
            this.size = current.columns === size.columns && current.rows === size.rows ? undefined : size;
            this.onChange();
          }, this.plugin.deskColumns, this.modal.contentEl);
        });
        resize.setAttribute('aria-haspopup', 'dialog'); resize.setAttribute('aria-expanded', 'false');
      } else if (key === 'addNotes') {
        action(definition.label, definition.icon, button => {
          this.plugin.pickStackNotes(this.plugin.settings.widgets[this.sourceId]?.itemId, () => {
            if (button.isConnected) button.focus({ preventScroll: true });
          });
        }).setAttribute('aria-haspopup', 'dialog');
      } else {
        const button = action(definition.label, definition.icon, (_button, origin) => {
          if (key === 'move') this.plugin.moveFromEdit(this.rootId);
          else this.plugin.runToolbarAction(this.rootId, key, origin);
        }, true);
        if (key === 'remove') button.addClass('tod-edit-remove');
      }
    }
    this.setUnsaved(this.unsaved);
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
    this.controls.actions(form);
    const actions = form.createDiv('tod-dialog-actions');
    actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } }).onclick = () => this.close();
    const submit = actions.createEl('button', { text: 'Save', cls: 'mod-cta', attr: { type: 'submit' } });
    updateSave = () => { submit.disabled = !this.controls?.dirty; this.controls?.setUnsaved(!submit.disabled); }; updateSave();
    form.onsubmit = event => { event.preventDefault(); if (submit.disabled) return; this.plugin.batchEdit(() => this.controls?.save()); this.close(); };
  }
  onClose(): void {
    this.controls?.close(); this.release(); this.contentEl.empty();
    if (!this.controls?.acted && this.restoreFocus) queueMicrotask(this.restoreFocus);
  }
}
