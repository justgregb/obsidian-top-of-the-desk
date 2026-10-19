import { splitFrontmatter } from './model';

type WordSegment = { isWordLike?: boolean };
type WordSegmenter = { segment(text: string): Iterable<WordSegment> };
const Segmenter = (Intl as unknown as {
  Segmenter?: new (locale: string | undefined, options: { granularity: 'word' }) => WordSegmenter;
}).Segmenter;
const segmenter = Segmenter ? new Segmenter(undefined, { granularity: 'word' }) : null;

/** Count the note's text, not YAML, comment text, link destinations, or embedded files. */
export function noteWordCount(markdown: string): number {
  const text = splitFrontmatter(markdown).body
    .replace(/<!--([\s\S]*?)-->|%%[\s\S]*?%%/g, ' ')
    .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, path, alias) => alias || path.split('/').pop())
    .replace(/^\s*\[(?!\^)[^\]]+\]:\s+\S+.*$/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\^([^\]]+)\]/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/gm, ' ')
    .replace(/^\s*(?:```|~~~).*$/gm, ' ');
  if (!segmenter) return text.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu)?.length || 0;
  let count = 0;
  for (const part of segmenter.segment(text)) if (part.isWordLike) count++;
  return count;
}
