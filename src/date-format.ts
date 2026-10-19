import { moment } from 'obsidian';

/** Use the configured daily-note name, without its optional folder prefixes. */
export function formatDeskDate(date: Date, format: string): string {
  const day = moment(date);
  return day.format(format).split('/').pop() || day.format('YYYY-MM-DD');
}
