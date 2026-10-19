/** The same source catalog drives desk choices, identities and recent history. */
export const SOURCE_TYPES = {
  note: { name: 'Note', icon: 'file-text' },
  folder: { name: 'Folder', icon: 'top-of-the-desk-folder-closed' },
  base: { name: 'Base', icon: 'table' },
  canvas: { name: 'Canvas', icon: 'layout-dashboard' },
  pdf: { name: 'PDF', icon: 'top-of-the-desk-pdf' },
  audio: { name: 'Audio', icon: 'audio-lines' },
  image: { name: 'Image', icon: 'image' },
  web: { name: 'URL', icon: 'globe-2' },
} as const;
export type SourceType = keyof typeof SOURCE_TYPES;
export type FileWidgetType = 'base' | 'canvas' | 'pdf' | 'audio' | 'image';
export type SourceWidgetType = FileWidgetType | 'web';
export type ConfigurableSourceType = SourceWidgetType | 'folder';
export type CompactSourceType = 'canvas' | 'pdf' | 'audio' | 'web';
export const isCompactSourceType = (type: string): type is CompactSourceType => ['canvas', 'pdf', 'audio', 'web'].includes(type);

// Obsidian's supported audio extensions; video containers remain outside this set.
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', '3gp', 'flac', 'ogg', 'oga', 'opus']);
const IMAGE_EXTENSIONS = new Set(['bmp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif']);
export function fileSourceType(extension: string): 'note' | FileWidgetType | null {
  const ext = extension.toLowerCase();
  return ext === 'md' ? 'note' : ext === 'base' || ext === 'canvas' || ext === 'pdf' ? ext : AUDIO_EXTENSIONS.has(ext) ? 'audio' : IMAGE_EXTENSIONS.has(ext) ? 'image' : null;
}
export const isFileWidgetType = (type: string): type is FileWidgetType => ['base', 'canvas', 'pdf', 'audio', 'image'].includes(type);
export const isSourceWidgetType = (type: string): type is SourceWidgetType => type === 'web' || isFileWidgetType(type);
export function matchesSourceFile(type: string, extension: string): boolean { return type === fileSourceType(extension); }

/** Keep the full address, including query and hash, without accepting executable URLs. */
export function sourceWebUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function sourceWebName(value: string): string {
  try { const url = new URL(value); return url.host.replace(/^www\./i, '') + (url.pathname === '/' ? '' : url.pathname); }
  catch { return 'Website'; }
}

/** Show site context only when the visible title does not already contain it. */
export function sourceWebSite(value: string, title = ''): string {
  try {
    const site = new URL(value).host.replace(/^www\./i, '');
    return title.toLocaleLowerCase().includes(site.toLocaleLowerCase()) ? '' : site;
  } catch { return ''; }
}
