import { stripControls, singleLine } from './validation';
import { Modal, Setting } from 'obsidian';
import { COPY } from './copy';
import type DeskPlugin from './main';
import { collectionCountVisibility, itemWidgetId } from './model';
import { setupDialogHeader } from './dialog-header';
import { EditControls } from './edit-controls';
import { UndoOrigin, undoOrigin } from './undo-notice';

/** Desk-only appearance preferences; saving never changes source files. */
export class CollectionDetailsModal extends Modal {
  private releaseDialog: () => void;
  private origin?: UndoOrigin;
  private stopWatching?: () => void;
  private editControls?: EditControls;

  constructor(private plugin: DeskPlugin, private id: string, private restoreFocus?: (origin?: UndoOrigin) => void, private rootId = itemWidgetId(id)) {
    super(plugin.app);
    this.releaseDialog = plugin.trackWidgetDialog(this);
  }

  onOpen(): void {
    const item = this.plugin.settings.items.find(item => item.id === this.id);
    if (!item || item.type === 'note') { this.close(); return; }
    this.setTitle(COPY.edit);
    setupDialogHeader(this);
    const pointer = (event: PointerEvent) => { this.origin = undoOrigin(event, event.target as HTMLElement); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') this.origin = undoOrigin(event, event.target as HTMLElement);
    };
    this.containerEl.addEventListener('pointerdown', pointer, true);
    this.containerEl.addEventListener('keydown', key, true);
    this.stopWatching = () => {
      this.containerEl.removeEventListener('pointerdown', pointer, true);
      this.containerEl.removeEventListener('keydown', key, true);
    };
    const form = this.contentEl.createEl('form', { cls: 'tod-widget-form' });
    form.createEl('p', { cls: 'tod-form-help', text: COPY.deskOnly });
    let updateSave = () => {};
    let name: HTMLInputElement | undefined;
    {
      const field = form.createEl('label', { cls: 'tod-widget-field' });
      field.createSpan({ text: COPY.name });
      name = field.createEl('input', { attr: { type: 'text', maxlength: '80', placeholder: 'Stack' } });
      name.value = item.type === 'stack' ? item.name : this.plugin.settings.widgets[itemWidgetId(item.id)]?.title || '';
      if (item.type === 'folder') name.placeholder = item.path.split('/').pop() || 'Vault';
    }
    const field = form.createEl('label', { cls: 'tod-widget-field' });
    field.createSpan({ cls: 'tod-widget-field-label', text: 'Description' }).createSpan({ cls: 'tod-field-optional', text: 'Optional' });
    const description = field.createEl('textarea', { cls: 'tod-collection-description-input', attr: { rows: '3', maxlength: '240' } });
    description.value = item.description || '';
    const widgetId = itemWidgetId(item.id);
    const initialPresentation = this.plugin.settings.widgets[widgetId]?.presentation || 'cover';
    let presentation = initialPresentation;
    if (item.type === 'folder') {
      const displayField = form.createEl('label', { cls: 'tod-widget-field' });
      displayField.createSpan({ text: 'Display' });
      const display = displayField.createEl('select', { cls: 'dropdown' });
      display.createEl('option', { text: 'Cover', value: 'cover' });
      display.createEl('option', { text: 'List', value: 'list' });
      display.value = presentation;
      display.onchange = () => { presentation = display.value === 'list' ? 'list' : 'cover'; updateSave(); };
      const help = form.createEl('p', { cls: 'tod-form-help', text: 'Cover opens on click. List shows the contents here.' });
      help.id = `tod-folder-display-${crypto.randomUUID()}`;
      display.setAttribute('aria-describedby', help.id);
    }
    const visibility = collectionCountVisibility(item);
    const counts = form.createDiv({ cls: 'tod-edit-options', attr: { role: 'group', 'aria-label': 'Note and word counts' } });
    const noteCount = new Setting(counts).setName('Note count').addToggle(toggle => {
      toggle.setValue(visibility.showNoteCount).onChange(value => { visibility.showNoteCount = value; updateSave(); });
      toggle.toggleEl.addClass('mod-small');
      toggle.toggleEl.setAttribute('aria-label', 'Note count');
    });
    if (item.type === 'folder') noteCount.setDesc('Includes notes in subfolders.');
    new Setting(counts).setName('Word count').addToggle(toggle => {
      toggle.setValue(visibility.showWordCount).onChange(value => { visibility.showWordCount = value; updateSave(); });
      toggle.toggleEl.addClass('mod-small');
      toggle.toggleEl.setAttribute('aria-label', 'Word count');
    });
    this.editControls = new EditControls(this.plugin, this, this.rootId, widgetId, () => updateSave());
    this.editControls.actions(form);
    const actions = form.createDiv('tod-dialog-actions');
    actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } }).onclick = () => this.close();
    const submit = actions.createEl('button', { text: 'Save', cls: 'mod-cta', attr: { type: 'submit' } });
    const details = () => JSON.stringify([
      name ? stripControls(name.value).trim().slice(0, 80) : undefined,
      singleLine(description.value).slice(0, 240), visibility,
    ]);
    const initialDetails = details();
    updateSave = () => {
      submit.disabled = details() === initialDetails && presentation === initialPresentation && !this.editControls?.dirty;
      this.editControls?.setUnsaved(!submit.disabled);
    };
    form.addEventListener('input', updateSave); updateSave();
    form.onsubmit = event => {
      event.preventDefault();
      if (submit.disabled) return;
      this.plugin.batchEdit(() => {
        if (details() !== initialDetails) this.plugin.updateCollection(this.id, description.value, name?.value, visibility);
        if (item.type === 'folder' && presentation !== initialPresentation) this.plugin.setFolderPresentation(widgetId, presentation, this.origin);
        this.editControls?.save();
      });
      this.close();
    };
    description.onkeydown = event => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); form.requestSubmit(); }
    };
    (name || description).focus();
    name?.select();
  }

  onClose(): void {
    this.editControls?.close();
    this.stopWatching?.(); this.stopWatching = undefined;
    this.releaseDialog(); this.contentEl.empty();
    const origin = this.origin; this.origin = undefined;
    if (!this.editControls?.acted && this.restoreFocus) queueMicrotask(() => this.restoreFocus?.(origin));
  }
}
