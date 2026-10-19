/** Narrow data from storage, YAML and internal APIs before reading its fields. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** Keep control-character handling explicit, without control-code regex ranges. */
export function hasControlCharacters(value: string): boolean {
  for (const character of value) if (character.charCodeAt(0) < 32) return true;
  return false;
}
export function stripControls(value: string, replacement = '', includeDelete = false): string {
  let result = '';
  for (const character of value) {
    const code = character.charCodeAt(0);
    result += code < 32 || includeDelete && code === 127 ? replacement : character;
  }
  return result;
}
export function singleLine(value: string, includeDelete = false): string {
  return stripControls(value, ' ', includeDelete).replace(/\s+/g, ' ').trim();
}
