import { TFile, TFolder, type Vault } from 'obsidian';
import { fileSourceType, type SourceType } from './source-types';
import { compareNames } from './ui';

/** Shared file choices. Appearance changes never enumerate or sort the vault. */
export class SourceCatalog {
  revision = 0;
  private notePaths?: Map<string, TFile>;
  private files?: (TFile | TFolder)[];
  private types = new Map<SourceType, (TFile | TFolder)[]>();
  constructor(private vault: Vault) {}
  invalidate(): void { this.revision++; this.files = undefined; this.notePaths = undefined; this.types.clear(); }
  note(path: string): TFile | null {
    const exact = this.vault.getFileByPath(path);
    if (exact) return exact;
    if (!this.notePaths) {
      this.notePaths = new Map();
      for (const file of this.vault.getMarkdownFiles()) {
        const key = file.path.toLowerCase();
        // Preserve the original fallback's first-match behavior for case variants.
        if (!this.notePaths.has(key)) this.notePaths.set(key, file);
      }
    }
    return this.notePaths.get(path.toLowerCase()) || null;
  }
  all(): (TFile | TFolder)[] {
    if (!this.files) {
      const root = this.vault.getRoot();
      this.files = [root, ...this.vault.getAllLoadedFiles().filter(file => file !== root)]
        .filter((file): file is TFile | TFolder => file instanceof TFolder || file instanceof TFile && !!fileSourceType(file.extension))
        .sort((a, b) => compareNames(a instanceof TFile ? a.basename : a.name, b instanceof TFile ? b.basename : b.name) || compareNames(a.path, b.path));
    }
    return this.files;
  }
  ofType(type: SourceType): (TFile | TFolder)[] {
    let files = this.types.get(type);
    if (!files) {
      files = this.all().filter(file => (file instanceof TFolder ? 'folder' : fileSourceType(file.extension)) === type)
        .sort((a, b) => compareNames(a.path, b.path));
      this.types.set(type, files);
    }
    return files;
  }
}
