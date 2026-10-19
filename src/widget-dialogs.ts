import { stripControls } from './validation';
import { ConfigurableSourceType, matchesSourceFile, SOURCE_TYPES, sourceWebUrl } from './source-types';
import { COPY } from './copy';
import { AbstractInputSuggest, Modal, Notice, TFile, TFolder, prepareFuzzySearch } from 'obsidian';
import type DeskPlugin from './main';
import { WidgetSettings, WIDGET_NAMES, widgetDefaults, widgetName } from './model';
import { setupDialogHeader } from './dialog-header';
import { EditControls } from './edit-controls';
import { updateText } from './ui';

/** Native inline suggestions keep choosing a source inside the setup form. */
class SourceSuggestions extends AbstractInputSuggest<TFile | TFolder> {
  private items: (TFile | TFolder)[] = [];
  get hasItems(): boolean { return this.items.length > 0; }
  constructor(private plugin: DeskPlugin, input: HTMLInputElement, private type: ConfigurableSourceType,
    private choose: (item: TFile | TFolder) => void) {
    super(plugin.app, input);
    this.refresh(); this.limit = 30;
  }
  refresh(): void {
    const items = this.plugin.sourceCatalog.ofType(this.type);
    if (items === this.items) return;
    this.items = items;
    this.close();
  }
  protected getSuggestions(query: string): (TFile | TFolder)[] {
    if (!query.trim()) return this.items;
    const search = prepareFuzzySearch(query.trim());
    return this.items.map(item => ({ item, match: search(item.path === '/' ? '/ Vault root' : item.path) }))
      .filter(result => result.match !== null).sort((a, b) => b.match!.score - a.match!.score).map(result => result.item);
  }
  renderSuggestion(item: TFile | TFolder, el: HTMLElement): void {
    el.createDiv({ text: item.path === '/' ? 'Vault root' : item instanceof TFile ? item.basename : item.name });
    if (item.path !== '/') el.createDiv({ cls: 'tod-source-path', text: item.path });
  }
  selectSuggestion(item: TFile | TFolder): void {
    this.setValue(item.path); this.close(); this.choose(item);
  }
}

/** Source settings stay local until Save or Add to desk. */
export class SourceWidgetModal extends Modal {
  private draft: WidgetSettings;
  private initialSource: string;
  private generation = 0;
  private closed = false;
  private submitted = false;
  private sourceInput!: HTMLInputElement;
  private sourceHelp!: HTMLElement;
  private suggestions?: SourceSuggestions;
  private heading!: HTMLInputElement;
  private automaticTitle: boolean;
  private views?: HTMLSelectElement;
  private viewField?: HTMLElement;
  private submit!: HTMLButtonElement;
  private releaseDialog: () => void;
  private editControls?: EditControls;

  constructor(private plugin: DeskPlugin, private type: ConfigurableSourceType, private id?: string, private onFinish?: (submitted: boolean) => void, private rootId = id) {
    super(plugin.app);
    this.releaseDialog = plugin.trackWidgetDialog(this);
    this.draft = { ...(id ? plugin.settings.widgets[id] : widgetDefaults(type)) };
    this.automaticTitle = !this.draft.title;
    this.initialSource = JSON.stringify([this.draft.path, this.draft.view, this.normalizedTitle(this.draft.title)]);
  }
  onOpen(): void {
    this.setTitle(this.id ? COPY.edit : this.type === 'web' ? COPY.addWebsite : `Add ${SOURCE_TYPES[this.type].name}`);
    setupDialogHeader(this);
    const form = this.contentEl.createEl('form', { cls: 'tod-widget-form' });
    if (this.id) form.createEl('p', { cls: 'tod-form-help', text: COPY.deskOnly });
    const sourceField = form.createEl('label', { cls: 'tod-widget-field' });
    const fieldId = `tod-source-${crypto.randomUUID()}`;
    sourceField.createSpan({ text: this.type === 'folder' ? 'Folder' : this.type === 'web' ? 'Web address' : SOURCE_TYPES[this.type].name, attr: { id: fieldId } });
    this.sourceInput = sourceField.createEl('input', { attr: {
      type: 'text', placeholder: this.type === 'folder' ? 'Find a folder…' : this.type === 'web' ? 'https://example.com' : 'Find a file…', autocomplete: 'off', spellcheck: 'false',
      'aria-labelledby': fieldId, 'aria-describedby': `${fieldId}-help`,
    } });
    this.sourceInput.value = this.draft.path;
    this.sourceHelp = sourceField.createSpan({ cls: 'tod-source-path', attr: { id: `${fieldId}-help`, 'aria-live': 'polite' } });
    if (this.type === 'base') {
      this.viewField = form.createEl('label', { cls: 'tod-widget-field' });
      this.viewField.hidden = true;
      this.viewField.createSpan({ text: 'View' });
      this.views = this.viewField.createEl('select', { cls: 'dropdown' });
      this.views.onchange = () => { this.draft.view = this.views!.value; this.updateSubmit(); };
    }
    const titleField = form.createEl('label', { cls: 'tod-widget-field' });
    titleField.createSpan({ text: COPY.name, cls: 'tod-widget-field-label', attr: { id: `${fieldId}-name` } }).createSpan({ text: 'Optional', cls: 'tod-field-optional' });
    this.heading = titleField.createEl('input', { attr: { type: 'text', maxlength: '100', 'aria-labelledby': `${fieldId}-name`, 'aria-describedby': `${fieldId}-name-help` } });
    this.heading.value = this.draft.title;
    this.heading.oninput = () => { this.automaticTitle = !this.heading.value.trim(); this.updateSubmit(); };
    titleField.createSpan({ cls: 'tod-source-path', text: `Defaults to the ${this.type === 'web' ? 'web address' : this.type === 'folder' ? 'folder name' : 'file name'}.`, attr: { id: `${fieldId}-name-help` } });
    if (this.id && this.rootId) {
      this.editControls = new EditControls(this.plugin, this, this.rootId, this.id, () => this.updateSubmit());
      this.editControls.preferences(form);
    }
    const actions = form.createDiv('tod-dialog-actions');
    actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } }).onclick = () => this.close();
    this.submit = actions.createEl('button', { text: this.id ? 'Save' : COPY.add, cls: 'mod-cta', attr: { type: 'submit' } });
    this.editControls?.actions(form);
    if (this.type !== 'web') this.suggestions = new SourceSuggestions(this.plugin, this.sourceInput, this.type, item => {
      if (this.closed) return;
      this.setSource(item.path);
      this.heading.focus(); this.heading.select();
    });
    this.sourceInput.oninput = () => {
      const path = this.sourceInput.value.trim();
      const source = path === '/' ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(path);
      this.sourceInput.removeAttribute('aria-invalid');
      this.setSource(this.type === 'web' ? sourceWebUrl(path) || '' : this.validSource(source) ? path : '');
      this.updateSourceHelp();
    };
    this.sourceInput.onblur = () => {
      if (this.sourceInput.value.trim() && !this.hasValidSource()) this.sourceInput.setAttribute('aria-invalid', 'true');
    };
    form.onsubmit = event => {
      event.preventDefault();
      if (this.closed || this.submitted || this.submit.disabled) return;
      const source = this.draft.path === '/' ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(this.draft.path);
      if (this.type === 'web' ? !sourceWebUrl(this.draft.path) : !this.validSource(source)) {
        new Notice(this.type === 'web' ? 'Enter a web address starting with https:// or http://.' : this.type === 'folder' ? 'Choose an existing folder.' : 'Choose an existing file.'); return;
      }
      if (this.id && !this.plugin.settings.widgets[this.id]) { this.close(); return; }
      this.draft.title = this.normalizedTitle(this.heading.value);
      const saved = this.plugin.batchEdit(() => {
        if (this.id) { if (!this.plugin.updateWidget(this.id, this.draft)) return false; }
        else this.plugin.addWidget(this.type, this.draft);
        this.editControls?.save();
        return true;
      });
      if (!saved) return;
      this.submitted = true; this.close();
    };
    this.updateSource();
    if (!this.id) this.sourceInput.focus();
  }
  private normalizedTitle(value: string): string {
    const title = stripControls(value).trim().slice(0, 100);
    return title === widgetName({ ...this.draft, title: '' }) ? '' : title;
  }
  private hasValidSource(): boolean {
    const path = this.draft.path;
    const source = path === '/' ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(path);
    return this.type === 'web' ? !!sourceWebUrl(path) : this.validSource(source);
  }
  private updateSubmit(): void {
    if (!this.submit) return;
    const source = JSON.stringify([this.draft.path, this.draft.view, this.normalizedTitle(this.heading.value)]);
    this.submit.disabled = !this.hasValidSource() || !!this.id && source === this.initialSource && !this.editControls?.dirty;
  }
  private validSource(source: unknown): source is TFile | TFolder {
    return this.type === 'folder' ? source instanceof TFolder : source instanceof TFile && matchesSourceFile(this.type, source.extension);
  }
  refresh(): void {
    if (this.closed || !this.sourceInput) return;
    this.suggestions?.refresh(); this.updateSource();
  }
  private setSource(path: string): void {
    if (path === this.draft.path) return;
    this.draft.path = path; this.draft.view = ''; this.updateSource();
  }
  private updateSource(): void {
    const { path } = this.draft;
    const name = path ? widgetName({ ...this.draft, title: '' }) : '';
    if (this.automaticTitle) this.heading.value = name;
    this.heading.placeholder = name || WIDGET_NAMES[this.type];
    this.updateSubmit();
    if (this.hasValidSource()) this.sourceInput.removeAttribute('aria-invalid');
    this.updateSourceHelp();
    if (!this.views) return;
    const select = this.views, generation = ++this.generation;
    this.viewField!.hidden = true;
    select.empty(); select.createEl('option', { text: 'First view', attr: { value: '' } });
    select.disabled = true;
    if (!path) return;
    void this.plugin.baseViews(path).then(views => {
      if (this.closed || generation !== this.generation) return;
      select.empty(); select.createEl('option', { text: 'First view', attr: { value: '' } });
      for (const name of views) select.createEl('option', { text: name, attr: { value: name } });
      const missingView = !!this.draft.view && !views.includes(this.draft.view);
      if (missingView) select.createEl('option', { text: `${this.draft.view} (not found)`, attr: { value: this.draft.view } });
      select.value = this.draft.view; select.disabled = !views.length && !missingView;
      this.viewField!.hidden = views.length <= 1 && !missingView;
    });
  }
  private updateSourceHelp(): void {
    const text = this.type === 'web'
      ? !this.hasValidSource() && this.sourceInput.value.trim() ? 'Start the address with https:// or http://.' : ''
      : !this.suggestions?.hasItems ? `No ${this.type === 'folder' ? 'folders' : this.type === 'audio' ? 'audio files' : this.type === 'image' ? 'images' : SOURCE_TYPES[this.type].name + ' files'} in this vault yet.`
      : !this.hasValidSource() && this.sourceInput.value.trim() ? `Choose ${this.type === 'folder' ? 'a folder' : 'a file'} from the suggestions.`
      : this.draft.path === '/' ? 'Vault root' : '';
    updateText(this.sourceHelp, text); this.sourceHelp.hidden = !text;
  }
  onClose(): void {
    if (this.closed) return;
    this.closed = true; this.generation++; this.suggestions?.close(); this.releaseDialog(); this.contentEl.empty();
    if (!this.editControls?.acted && this.onFinish) queueMicrotask(() => this.onFinish?.(this.submitted));
  }
}
