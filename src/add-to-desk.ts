import { fileSourceType, SOURCE_TYPES, sourceWebUrl } from './source-types';
import { FuzzyMatch, FuzzySuggestModal, Modal, Notice, TFile, TFolder, prepareFuzzySearch, setIcon } from 'obsidian';
import type DeskPlugin from './main';
import { COPY, formatCount } from './copy';
import { DESK_ACTION_ICONS, setCollectionIcon } from './collection-icons';
import { widgetStackOwners, DeskItem, itemPaths, itemWidgetId, widgetName, WIDGET_ICONS, WidgetKey } from './model';
import { reconcileChildren } from './ui';
import { setupDialogHeader } from './dialog-header';
import { SourceWidgetModal } from './widget-dialogs';
import type { DeskSource } from './widget-layout';
import { recentWindow } from './recent-history';

type Choice = { kind: 'source'; file: TFile | TFolder } | { kind: 'new-url'; url?: string } | { kind: 'web'; url: string; title: string } | { kind: 'new-stack' } | { kind: 'new-widget-stack' } | { kind: 'put-away' } | { kind: 'restore-title' }
  | { kind: 'saved'; item: DeskItem } | { kind: 'tool'; id: string };

const DETAILS: Partial<Record<WidgetKey, string>> = {
  recents: 'Opened in the last 7 days.', scratchpad: 'Capture thoughts and links.',
  daily: 'Write in today’s note.', activity: 'See your daily word-count changes.',
};

/** One searchable Add flow for sources, collections, tools and saved items. */
export class AddDeskModal extends FuzzySuggestModal<Choice> {
  private release: () => void;
  private choices: Choice[] = [];
  private sourceFiles?: (TFile | TFolder)[];
  private sources: Choice[] = [];
  private searchText = new WeakMap<Choice, string>();
  private sections = new Map<Choice, string>();
  private onDesk = new Set<string>();
  private deskNames = new Map<string, string>();
  private restoreTitle = false;
  private handledFocus = false;
  constructor(private plugin: DeskPlugin, private onFinish?: (restoreTitle: boolean, handledFocus?: boolean) => void, private savedOnly = false) {
    super(plugin.app);
    this.release = plugin.trackWidgetDialog(this);
    this.setPlaceholder(savedOnly ? 'Find an item to restore…' : 'Find an item or paste a link…');
    this.inputEl.setAttribute('aria-label', savedOnly ? COPY.removedFromDesk : COPY.addToDesk);
    this.buildChoices();
  }
  private itemName(item: DeskItem): string { return widgetName(this.plugin.settings.widgets[itemWidgetId(item.id)]); }
  private buildChoices(): void {
    // Names and membership can change while this dialog is open. Cache only
    // until the next choices refresh, rather than rebuilding text per keypress.
    this.searchText = new WeakMap();
    const settings = this.plugin.settings, owners = widgetStackOwners(settings);
    const savedTools = settings.widgetOrder.filter(id => !settings.widgets[id].enabled && !settings.widgets[id].itemId && !owners.has(id));
    if (this.savedOnly) {
      this.choices = [...settings.putAwayItems.map(item => ({ kind: 'saved' as const, item })), ...savedTools.map(id => ({ kind: 'tool' as const, id }))];
      return;
    }
    const enabled = (id: string) => !!settings.widgets[owners.get(id) || id]?.enabled;
    this.onDesk.clear(); this.deskNames.clear(); this.sections.clear();
    for (const item of settings.items) {
      const id = itemWidgetId(item.id);
      if (!enabled(id)) continue;
      const keys = item.type === 'folder' ? [`folder:${item.path}`] : itemPaths(item).map(path => `note:${path}`);
      for (const key of keys) { this.onDesk.add(key); this.deskNames.set(key, widgetName(settings.widgets[id])); }
    }
    const pages = new Map<string, Choice>();
    for (const id of settings.widgetOrder) {
      const widget = settings.widgets[id];
      if (!enabled(id)) continue;
      this.onDesk.add(`tool:${id}`);
      if (widget.path) { this.onDesk.add(`${widget.type}:${widget.path}`); this.deskNames.set(`${widget.type}:${widget.path}`, widgetName(widget)); }
      if (widget.type === 'web' && sourceWebUrl(widget.path)) pages.set(widget.path, { kind: 'web', url: widget.path, title: widget.title });
    }
    const group = recentWindow(), times = new Map<string, number>();
    for (const entry of this.plugin.recents.entries) {
      if (group(entry.openedAt)) times.set(entry.path, entry.openedAt!);
    }
    for (const entry of this.plugin.webHistory.entries) {
      if (!group(entry.openedAt)) continue;
      times.set(entry.url, entry.openedAt);
      const existing = pages.get(entry.url);
      if (existing?.kind !== 'web' || !existing.title) pages.set(entry.url, { kind: 'web', url: entry.url, title: entry.title });
    }
    const tools: Choice[] = settings.widgetOrder.filter(id => {
      const widget = settings.widgets[id];
      return !!DETAILS[widget.type] || enabled(id) && (widget.type === 'stack' || widget.type === 'widget-stack');
    }).map(id => ({ kind: 'tool', id }));
    const files = this.plugin.sourceCatalog.all();
    if (files !== this.sourceFiles) {
      this.sourceFiles = files; this.sources = files.map(file => ({ kind: 'source', file }));
    }
    const items = [...pages.values(), ...tools, ...this.sources];
    const time = (choice: Choice) => choice.kind === 'source' ? times.get(choice.file.path) || 0 : choice.kind === 'web' ? times.get(choice.url) || 0 : 0;
    const recent = items.filter(choice => time(choice) > 0).sort((a, b) => time(b) - time(a)).slice(0, 8);
    const recentSet = new Set(recent);
    const actions: Choice[] = [{ kind: 'new-stack' }, { kind: 'new-widget-stack' }, { kind: 'new-url' },
      ...(settings.putAwayItems.length || savedTools.length ? [{ kind: 'put-away' } as Choice] : []),
      ...(!settings.pageTitle.trim() && this.onFinish ? [{ kind: 'restore-title' } as Choice] : [])];
    const others = items.filter(choice => !recentSet.has(choice));
    for (const [label, group] of [['Recently opened', recent], ['Actions', actions], ['All items', others]] as const) {
      if (group.length) this.sections.set(group[0], label);
    }
    this.choices = [...recent, ...actions, ...others];
  }
  private sourceKey(choice: Choice): string {
    if (choice.kind === 'source') return `${choice.file instanceof TFolder ? 'folder' : fileSourceType(choice.file.extension)}:${choice.file.path}`;
    if (choice.kind === 'web' || choice.kind === 'new-url' && choice.url) return `web:${choice.url}`;
    return choice.kind === 'tool' ? `tool:${choice.id}` : '';
  }

  refresh(): void { this.buildChoices(); this.inputEl.dispatchEvent(new Event('input', { bubbles: true })); }
  getItems(): Choice[] { return this.choices; }
  getSuggestions(query: string): FuzzyMatch<Choice>[] {
    const url = !this.savedOnly && sourceWebUrl(query);
    // A complete web address is one direct action, not a fuzzy search through history.
    if (url) return [{ item: { kind: 'new-url', url }, match: prepareFuzzySearch(url)(url)! }];
    return super.getSuggestions(query);
  }
  getItemText(choice: Choice): string {
    let text = this.searchText.get(choice);
    if (text === undefined) { text = this.itemText(choice); this.searchText.set(choice, text); }
    return text;
  }
  private itemText(choice: Choice): string {
    if (choice.kind === 'new-url') return `${choice.url || ''} ${COPY.addWebsite} URL link`;
    if (choice.kind === 'web') return `${choice.title} ${choice.url} URL website`;
    if (choice.kind === 'source') return `${choice.file.path === '/' ? 'Vault' : choice.file.path} ${choice.file instanceof TFolder ? 'folder' : fileSourceType(choice.file.extension) || 'file'} ${this.deskNames.get(this.sourceKey(choice)) || ''}`;
    if (choice.kind === 'saved') return `${this.itemName(choice.item)} ${choice.item.type === 'stack' ? choice.item.description || '' : choice.item.path}`;
    if (choice.kind === 'tool') { const widget = this.plugin.settings.widgets[choice.id]; return [widgetName(widget), ...(widget.members || []).map(id => widgetName(this.plugin.settings.widgets[id]))].join(' '); }
    return choice.kind === 'new-widget-stack' ? COPY.newStack : choice.kind === 'new-stack' ? 'New note stack' : choice.kind === 'restore-title' ? 'Restore desk title' : `${COPY.removedFromDesk} ${COPY.restoreToDesk}`;
  }
  renderSuggestion(match: FuzzyMatch<Choice>, el: HTMLElement): void {
    const choice = match.item;
    el.addClass('tod-add-result');
    let icon = 'files', title = '', detail = '';
    if (choice.kind === 'source') {
      const folder = choice.file instanceof TFolder;
      const type = folder ? 'folder' : fileSourceType((choice.file as TFile).extension)!;
      icon = SOURCE_TYPES[type].icon;
      title = folder ? choice.file.path === '/' ? 'Vault' : choice.file.name : (choice.file as TFile).basename;
      detail = `${SOURCE_TYPES[type].name} · ${choice.file.path}`;
    } else if (choice.kind === 'new-url') { title = choice.url ? COPY.addToDesk : COPY.addWebsite; detail = choice.url || 'Paste a web address.'; icon = SOURCE_TYPES.web.icon; }
    else if (choice.kind === 'web') { title = choice.title || choice.url; detail = choice.url; icon = SOURCE_TYPES.web.icon; }
    else if (choice.kind === 'saved') {
      title = this.itemName(choice.item); icon = choice.item.type === 'stack' ? 'files' : choice.item.type === 'folder' ? 'folder' : 'file-text';
      detail = this.plugin.putAwayBlocker(choice.item) || (choice.item.type === 'stack' ? formatCount(choice.item.paths.length, 'note') : choice.item.path);
    } else if (choice.kind === 'tool') {
      const widget = this.plugin.settings.widgets[choice.id];
      title = widgetName(widget); icon = WIDGET_ICONS[widget.type];
      detail = widget.members?.map(id => widgetName(this.plugin.settings.widgets[id])).join(' · ') || (widget.path ? `${widget.path}${widget.view ? ' · ' + widget.view : ''}` : DETAILS[widget.type] || '');
    } else if (choice.kind === 'new-stack') { title = 'New note stack'; detail = 'Notes stay in their folders.'; }
    else if (choice.kind === 'new-widget-stack') { title = COPY.newStack; detail = 'Switch between items in one place.'; icon = 'layers-2'; }
    else if (choice.kind === 'restore-title') { title = 'Restore desk title'; detail = 'Name your desk.'; icon = 'heading'; }
    else { title = COPY.removedFromDesk; detail = 'Bring removed items back to your desk.'; icon = DESK_ACTION_ICONS.remove; }
    const onDesk = !this.savedOnly && this.onDesk.has(this.sourceKey(choice));
    if (onDesk && choice.kind === 'new-url') title = COPY.showOnDesk;
    const section = !this.inputEl.value.trim() && this.sections.get(choice);
    if (section) el.createDiv({ cls: 'tod-add-section', text: section });
    el = el.createDiv('tod-add-choice');
    const symbol = el.createSpan({ cls: 'tod-add-choice-icon', attr: { 'aria-hidden': 'true' } });
    if (icon === 'folder' || icon === 'files') setCollectionIcon(symbol, icon === 'files' ? 'stack' : 'folder', false);
    else setIcon(symbol, icon);
    const text = el.createDiv('tod-add-choice-text');
    text.createDiv({ text: title });
    if (detail) text.createDiv({ cls: 'tod-source-path', text: detail });
    if (onDesk) el.createSpan({ cls: 'tod-add-status', text: 'On desk' });
  }
  private addSource(source: DeskSource): void {
    this.handledFocus = !!this.plugin.addSourceToDesk(source);
    if (!this.handledFocus) new Notice('This item is no longer available.');
  }
  onChooseItem(choice: Choice): void {
    this.handledFocus = choice.kind === 'new-url' || choice.kind === 'new-stack' || choice.kind === 'new-widget-stack' || choice.kind === 'put-away';
    if (choice.kind === 'new-url') {
      if (choice.url) this.addSource({ kind: 'web', path: choice.url });
      else new SourceWidgetModal(this.plugin, 'web').open();
    } else if (choice.kind === 'web') this.addSource({ kind: 'web', path: choice.url, title: choice.title });
    else if (choice.kind === 'new-stack') this.plugin.pickStackNotes();
    else if (choice.kind === 'new-widget-stack') this.plugin.pickWidgetStack();
    else if (choice.kind === 'put-away') new AddDeskModal(this.plugin, undefined, true).open();
    else if (choice.kind === 'restore-title') this.restoreTitle = true;
    else if (choice.kind === 'saved') this.plugin.restorePutAway(choice.item.id);
    else if (choice.kind === 'tool') { this.handledFocus = true; this.plugin.revealDeskWidget(choice.id); }
    else {
      const kind = choice.file instanceof TFolder ? 'folder' : fileSourceType(choice.file.extension);
      if (kind) this.addSource({ kind, path: choice.file.path });
    }
  }
  onClose(): void { super.onClose(); this.release(); if (this.onFinish) queueMicrotask(() => this.onFinish?.(this.restoreTitle, this.handledFocus)); }
}

/** Shared multi-selection for creating a stack and adding notes to one. */
export class StackNotesModal extends Modal {
  private release: () => void;
  private selected = new Set<string>();
  constructor(private plugin: DeskPlugin, private id?: string, private restoreFocus?: () => void, initialPaths: string[] = []) {
    super(plugin.app); this.release = plugin.trackWidgetDialog(this); this.selected = new Set(initialPaths);
  }
  onOpen(): void {
    const stack = this.plugin.settings.items.find(item => item.id === this.id);
    if (this.id && stack?.type !== 'stack') { this.close(); return; }
    this.setTitle(this.id ? 'Add notes' : 'New note stack');
    setupDialogHeader(this);
    const form = this.contentEl.createEl('form', { cls: 'tod-widget-form' });
    form.createEl('p', { cls: 'tod-form-help', text: `${this.id ? 'Choose notes to add.' : COPY.stackMinimum} Files stay in their folders.` });
    let name: HTMLInputElement | undefined;
    if (!this.id) {
      const label = form.createEl('label', { cls: 'tod-widget-field', text: COPY.name });
      name = label.createEl('input', { attr: { type: 'text', maxlength: '80', placeholder: 'Stack' } });
    }
    const search = form.createEl('input', { cls: 'tod-collection-search', attr: { type: 'search', placeholder: 'Find notes…', 'aria-label': 'Find notes' } });
    const list = form.createDiv({ cls: 'tod-note-choices', attr: { role: 'group', 'aria-label': 'Choose notes' } });
    const count = form.createDiv({ cls: 'tod-form-help', attr: { role: 'status' } });
    const excluded = new Set(this.plugin.settings.items.flatMap(item => item.type === 'stack' ? item.paths : []));
    const files = this.plugin.sourceCatalog.all().filter((file): file is TFile => file instanceof TFile && fileSourceType(file.extension) === 'note' && !excluded.has(file.path));
    const choices = files.map(file => ({ file, search: file.path.toLocaleLowerCase() }));
    let limit = 100, lastQuery = '';
    let matches = choices;
    const actions = form.createDiv('tod-dialog-actions');
    actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } }).onclick = () => this.close();
    const submit = actions.createEl('button', { cls: 'mod-cta', text: this.id ? COPY.add : COPY.create, attr: { type: 'submit' } });
    const updateCount = () => { count.setText(`${this.selected.size} selected`); submit.disabled = this.selected.size < (this.id ? 1 : 2); };
    const rows = new Map<string, { label: HTMLLabelElement; check: HTMLInputElement }>();
    const doc = list.ownerDocument;
    const empty = doc.createElement('p'); empty.className = 'tod-form-help';
    empty.textContent = `${COPY.noMatchingNotes} Notes already in a stack aren’t listed.`;
    const more = doc.createElement('button'); more.type = 'button'; more.textContent = 'Show more';
    const render = () => {
      const query = search.value.trim().toLocaleLowerCase();
      if (query !== lastQuery) {
        const terms = query.split(/\s+/).filter(Boolean);
        matches = terms.length ? choices.filter(choice => terms.every(term => choice.search.includes(term))) : choices;
        lastQuery = query;
      }
      const visible = matches.slice(0, limit), keep = new Set(visible.map(choice => choice.file.path));
      const children: HTMLElement[] = [];
      for (const { file } of visible) {
        let row = rows.get(file.path);
        if (!row) {
          const label = doc.createElement('label'); label.className = 'tod-note-choice';
          const check = label.createEl('input', { attr: { type: 'checkbox' } });
          const text = label.createSpan('tod-choice-text'); text.createSpan({ text: file.basename }); text.createSpan({ cls: 'tod-source-path', text: file.parent?.path || 'Vault' });
          check.onchange = () => { if (check.checked) this.selected.add(file.path); else this.selected.delete(file.path); updateCount(); };
          row = { label, check };
        }
        rows.delete(file.path); rows.set(file.path, row);
        row.check.checked = this.selected.has(file.path); children.push(row.label);
      }
      if (!matches.length) children.push(empty);
      if (matches.length > limit) children.push(more);
      reconcileChildren(list, children);
      for (const path of rows.keys()) {
        if (rows.size <= visible.length + 200) break;
        if (!keep.has(path)) rows.delete(path);
      }
    };
    more.onclick = event => {
      const top = list.scrollTop, previous = limit; limit += 100; render(); list.scrollTop = top;
      if (event.detail === 0) list.querySelectorAll<HTMLInputElement>('input')[previous]?.focus({ preventScroll: true });
    };
    search.oninput = () => { limit = 100; render(); };
    form.onsubmit = event => { event.preventDefault(); if (!submit.disabled && this.plugin.saveStackNotes([...this.selected], name?.value, this.id)) this.close(); };
    render(); updateCount(); (name || search).focus();
  }
  onClose(): void { this.contentEl.empty(); this.release(); if (this.restoreFocus) queueMicrotask(this.restoreFocus); }
}
