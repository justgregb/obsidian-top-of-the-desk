import { isRecord } from './validation';
import { App, Component, Editor, MarkdownFileInfo, TFile } from 'obsidian';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, placeholder, type ViewUpdate } from '@codemirror/view';

interface EditorOwner extends MarkdownFileInfo {
  containerEl: HTMLElement;
  editMode?: NativeEditor;
  getMode(): 'source';
  syncScroll(): void;
}
interface NativeEditor extends Component {
  editor: Editor;
  editorEl: HTMLElement;
  cm: EditorView;
  get(): string;
  set(text: string, clear?: boolean): void;
  destroy(): void;
  buildLocalExtensions(): Extension[];
  onUpdate(update: ViewUpdate, changed: boolean): void;
}
type NativeConstructor = new (app: App, parent: HTMLElement, owner: EditorOwner) => NativeEditor;
interface MarkdownEmbed extends Component {
  editable: boolean;
  editMode?: NativeEditor;
  showEditor(): void;
  destroyEditor(): void;
}
const constructors = new WeakMap<App, NativeConstructor>();

/** Obsidian does not export its embeddable editor constructor. Keep that dependency here. */
function editorConstructor(app: App, doc: Document): NativeConstructor {
  const cached = constructors.get(app);
  if (cached) return cached;
  const registry = (app as App & {
    embedRegistry: { embedByExtension: { md(context: { app: App; containerEl: HTMLElement }, file: TFile | null, subpath: string): MarkdownEmbed } };
  }).embedRegistry;
  const containerEl = doc.adoptNode(createFragment()).createDiv();
  const embed = registry.embedByExtension.md({ app, containerEl }, null, '');
  try {
    embed.editable = true;
    embed.showEditor();
    // Embedded note editor -> scrollable Markdown editor, without the embed's file writer.
    const editorPrototype: unknown = embed.editMode ? Object.getPrototypeOf(embed.editMode) : null;
    const prototype: unknown = isRecord(editorPrototype) ? Object.getPrototypeOf(editorPrototype) : null;
    if (!isRecord(prototype) || typeof prototype.set !== 'function' || typeof prototype.buildLocalExtensions !== 'function' || typeof prototype.constructor !== 'function') {
      throw new Error('Obsidian’s embedded Markdown editor is unavailable');
    }
    const constructor = prototype.constructor as NativeConstructor;
    constructors.set(app, constructor);
    return constructor;
  } finally {
    embed.destroyEditor();
    embed.unload();
    containerEl.remove();
  }
}

/** Native Markdown input; the existing store remains the only writer of the full note. */
export class WidgetMarkdownEditor extends Component {
  readonly el: HTMLElement;
  private native: NativeEditor;
  private owner: EditorOwner;
  private path = '';
  private body = '';
  private syncing = false;
  private readOnly = true;
  private selectionAvailable = false;
  private editable = new Compartment();

  constructor(private app: App, parent: HTMLElement, label: string, hint: string, onChange: (body: string, update: ViewUpdate) => void, onBlur: () => void, onSelection?: (hasSelection: boolean) => void) {
    super();
    this.el = parent.createDiv('tod-note-editor');
    this.el.addClass('is-readonly');
    const file = () => app.vault.getFileByPath(this.path);
    const editor = () => this.native?.editor;
    const editMode = () => this.native;
    const editable = this.editable;
    const onUpdate = (native: NativeEditor, update: ViewUpdate, changed: boolean): void => {
      if (update.docChanged) this.body = native.get();
      if (changed && !this.syncing && !this.readOnly) onChange(this.body, update);
      if (onSelection && (update.selectionSet || update.docChanged)) {
        const selection = update.state.selection.main;
        const available = !this.readOnly && !selection.empty && !!update.state.sliceDoc(selection.from, selection.to).trim();
        if (available !== this.selectionAvailable) { this.selectionAvailable = available; onSelection(available); }
      }
    };
    this.owner = {
      app,
      containerEl: this.el,
      hoverPopover: null,
      get file() { return file(); },
      get editor() { return editor(); },
      get editMode() { return editMode(); },
      getMode: () => 'source',
      syncScroll: () => {},
    };
    const Native = editorConstructor(app, parent.ownerDocument);
    this.native = new class extends Native {
      buildLocalExtensions(): Extension[] {
        return [
          ...super.buildLocalExtensions(),
          placeholder(hint),
          editable.of([EditorState.readOnly.of(true), EditorView.editable.of(false)]),
          EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'true' }),
        ];
      }
      onUpdate(update: ViewUpdate, changed: boolean): void {
        super.onUpdate(update, changed);
        onUpdate(this, update, changed);
      }
    }(app, this.el, this.owner);
    this.native.set('', true);
    this.addChild(this.native);
    this.registerDomEvent(this.native.cm.contentDOM, 'blur', () => onBlur());
    // Native editors only handle clicks on their text surface. Include the
    // surrounding blank canvas without changing how existing text is selected.
    this.registerDomEvent(this.el, 'mousedown', event => this.focusBlankSpace(event), true);
    this.registerDomEvent(this.el, 'click', event => {
      // Mouse placement is handled on press; don't reset a completed drag selection.
      if (event.detail === 0 || ['touch', 'pen'].includes(event.pointerType)) this.focusBlankSpace(event);
    }, true);
  }

  private focusBlankSpace(event: MouseEvent): void {
    if (this.readOnly || event.defaultPrevented || event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (!target.closest || target.closest('button, a, input, select, textarea, [role="button"], .cm-tooltip, .cm-gutters, .cm-embed-block')) return;
    const cm = this.native.cm;
    if (cm.state.doc.length && target.closest('.cm-line, .cm-widgetBuffer')) return;
    // Leave native scrollbars usable when the document overflows the widget.
    const scroller = cm.scrollDOM;
    const bounds = scroller.getBoundingClientRect();
    if ((scroller.offsetWidth > scroller.clientWidth && event.clientX >= bounds.left + scroller.clientLeft + scroller.clientWidth) ||
        (scroller.offsetHeight > scroller.clientHeight && event.clientY >= bounds.top + scroller.clientTop + scroller.clientHeight)) return;
    event.preventDefault();
    event.stopPropagation();
    const position = cm.posAtCoords({ x: event.clientX, y: event.clientY }, false) ?? cm.state.doc.length;
    cm.dispatch({ selection: { anchor: position }, scrollIntoView: true });
    cm.focus();
  }

  selectedText(): string {
    if (this.readOnly) return '';
    const cm = this.native.cm, selection = cm.state.selection.main;
    return cm.state.sliceDoc(selection.from, selection.to);
  }
  focus(): void { if (this.el.isConnected) this.native.cm.focus(); }

  sync(body: string, path: string, readOnly: boolean): void {
    const changedFile = this.path !== path;
    this.path = path;
    this.syncing = true;
    try {
      // Native set() applies a minimal diff, preserving cursor and undo on ordinary saves.
      if (changedFile || this.body !== body) this.native.set(body, changedFile);
      this.body = body;
      if (this.readOnly !== readOnly || changedFile) {
        this.readOnly = readOnly;
        this.native.cm.dispatch({ effects: this.editable.reconfigure([
          EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly),
        ]) });
        this.el.toggleClass('is-readonly', readOnly);
      }
    } finally { this.syncing = false; }
  }

  onunload(): void {
    if (this.app.workspace.activeEditor === this.owner) this.app.workspace.activeEditor = null;
    this.owner.hoverPopover?.unload();
    this.removeChild(this.native);
    this.native.destroy();
    this.el.remove();
  }
}
