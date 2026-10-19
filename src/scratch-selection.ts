import { Modal } from 'obsidian';
import type DeskPlugin from './main';
import { safePath } from './model';
import { setupDialogHeader } from './dialog-header';

/** Capture a selection as a separate note; the Scratchpad is never cut or rewritten. */
export class ScratchSelectionModal extends Modal {
  private release: () => void;
  private openNow = false;
  constructor(private plugin: DeskPlugin, private text: string, private sourcePath: string, private restoreFocus?: () => void) {
    super(plugin.app); this.release = plugin.trackWidgetDialog(this);
  }
  onOpen(): void {
    this.openNow = true; this.setTitle('Create note from selection'); setupDialogHeader(this);
    const form = this.contentEl.createEl('form', { cls: 'tod-widget-form' });
    const field = form.createEl('label', { cls: 'tod-widget-field', text: 'Note name' });
    const name = field.createEl('input', { attr: { type: 'text', maxlength: '160', required: 'true', placeholder: 'New note' } });
    const suggestion = this.text.split('\n').find(line => line.trim())?.replace(/^\s*#+\s*/, '').replace(/[\\/:*?"<>|#\[\]]/g, '').trim().slice(0, 70);
    name.value = suggestion || 'New note';
    const parent = this.sourcePath.split('/').slice(0, -1).join('/');
    form.createEl('p', { cls: 'tod-form-help', text: `Saved in ${parent || 'the vault root'}. Your selection stays in Scratchpad.` });
    const preview = form.createEl('blockquote', { cls: 'tod-capture-preview' }); preview.setText(this.text.slice(0, 400) + (this.text.length > 400 ? '…' : ''));
    const label = form.createEl('label', { cls: 'tod-note-choice' });
    const pin = label.createEl('input', { attr: { type: 'checkbox' } }); label.createSpan({ text: 'Add to the desk' });
    const error = form.createEl('p', { cls: 'tod-form-error', attr: { role: 'alert' } }); error.hidden = true;
    const actions = form.createDiv('tod-dialog-actions');
    actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } }).onclick = () => this.close();
    const submit = actions.createEl('button', { text: 'Create note', cls: 'mod-cta', attr: { type: 'submit' } });
    form.onsubmit = async event => {
      event.preventDefault(); if (submit.disabled) return;
      const title = name.value.trim().replace(/\.md$/i, '');
      const fail = (message: string) => { error.setText(message); error.hidden = false; };
      if (!title || /[\\/:*?"<>|#\[\]]/.test(title) || !safePath(title + '.md', 'md')) { fail('Use a note name without slashes or reserved filename characters.'); name.focus(); return; }
      submit.disabled = true; error.hidden = true;
      try {
        let index = 1, path = `${parent ? parent + '/' : ''}${title}.md`;
        while (this.app.vault.getAbstractFileByPath(path)) path = `${parent ? parent + '/' : ''}${title} ${++index}.md`;
        await this.plugin.ensureParent(path);
        const file = await this.app.vault.create(path, this.text);
        if (pin.checked) this.plugin.pin(file.path);
        if (this.openNow) { this.restoreFocus = undefined; this.close(); await this.plugin.openPath(file.path); }
      } catch (cause) {
        console.error('Top of the Desk: could not create a note from Scratchpad', cause);
        if (this.openNow) { fail('Couldn’t create the note. Your selection is still in Scratchpad. Try again.'); submit.disabled = false; }
      }
    };
    name.focus(); name.select();
  }
  onClose(): void { this.openNow = false; this.release(); this.contentEl.empty(); if (this.restoreFocus) queueMicrotask(this.restoreFocus); }
}
