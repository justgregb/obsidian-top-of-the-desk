import { Component, setTooltip } from 'obsidian';
import { calendarDate, localDay, type WritingActivity } from './writing-activity';
import { updateText, updateTooltip } from './ui';
import { HoverTooltip } from './hover-tooltip';
import { formatCount } from './copy';
import { formatDeskDate } from './date-format';

const LEVELS = ['No net words added', '1–249 words', '250–499 words', '500–999 words', '1,000+ words'];
function level(words: number): number { return words <= 0 ? 0 : words < 250 ? 1 : words < 500 ? 2 : words < 1000 ? 3 : 4; }
const monthName = new Intl.DateTimeFormat(undefined, { month: 'short' });
const weekdayName = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const weekdayLetter = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
const weekdays = Array.from({ length: 7 }, (_, day) => new Date(2026, 0, 5 + day, 12));
const shortWeekdays = weekdays.map(date => weekdayName.format(date));
const narrowWeekdays = weekdays.map(date => weekdayLetter.format(date));
const months = Array.from({ length: 12 }, (_, month) => monthName.format(new Date(2026, month, 1, 12)));
const CELL_GAP = 3, CHART_PADDING = 6, LABEL_GAP = 8, ROW_GAP = 6;

/** A measured calendar, with real square cells and one keyboard stop for the map. */
export class WritingHeatmap extends Component {
  private el: HTMLElement;
  private chart: HTMLElement;
  private footer: HTMLElement;
  private summary: HTMLElement;
  private totalValue: HTMLElement;
  private totalUnit: HTMLElement;
  private error: HTMLElement;
  private cells = new Map<string, HTMLButtonElement>();
  private signature = '';
  private focusDay: string | null = null;
  private vertical = false;
  private frame = 0;
  private stopped = false;
  private painted = new Map<string, string>();
  private dates: string[] = [];
  private tooltip: HoverTooltip;
  private measurementFont = '';
  private labelWidths = { weekday: 26, month: 36, narrow: 9 };

  constructor(private activity: WritingActivity, private body: HTMLElement, private dateFormat: () => string) {
    super();
    this.tooltip = this.addChild(new HoverTooltip(body.ownerDocument));
    this.el = body.createDiv('tod-writing-activity');
    this.chart = this.el.createDiv('tod-writing-chart');
    this.footer = this.el.createDiv('tod-writing-footer');
    this.summary = this.footer.createSpan('tod-writing-total tod-pill tod-metadata-pill');
    this.totalValue = this.summary.createSpan('tod-metadata-value');
    this.totalUnit = this.summary.createSpan('tod-metadata-unit');
    const legend = this.footer.createDiv({ cls: 'tod-writing-legend tod-pill tod-metadata-pill', attr: { role: 'group', 'aria-label': `Net words added per day, from less to more: ${LEVELS.join('; ')}` } });
    legend.createSpan({ cls: 'tod-writing-legend-label', text: 'Less', attr: { 'aria-hidden': 'true' } });
    LEVELS.forEach((label, index) => {
      const sample = legend.createSpan({ cls: 'tod-writing-sample', attr: { 'data-level': String(index), 'aria-label': label } });
      setTooltip(sample, label);
    });
    legend.createSpan({ cls: 'tod-writing-legend-label', text: 'More', attr: { 'aria-hidden': 'true' } });
    this.error = this.el.createDiv({ cls: 'tod-writing-error', attr: { role: 'status' } });
    const win = body.ownerDocument.defaultView!;
    this.register(activity.subscribe(() => this.schedule()));
    const observer = new win.ResizeObserver(() => { this.tooltip.hide(); this.schedule(); });
    observer.observe(body); observer.observe(this.footer); this.register(() => observer.disconnect());
    let lastDay = localDay();
    const timer = win.setInterval(() => {
      const today = localDay();
      if (today !== lastDay) { lastDay = today; this.schedule(); }
    }, 60000);
    this.register(() => win.clearInterval(timer));
    this.registerDomEvent(win, 'focus', () => this.schedule());
    this.registerDomEvent(win, 'blur', () => this.tooltip.hide());
    this.registerDomEvent(win, 'resize', () => this.tooltip.hide());
    this.registerDomEvent(body.ownerDocument, 'scroll', () => this.tooltip.hide(), true);
    this.registerDomEvent(body.ownerDocument, 'pointerdown', event => {
      if (!this.chart.contains(event.target as Node)) this.tooltip.hide();
    });
    this.registerDomEvent(this.chart, 'pointerover', event => {
      if (event.pointerType === 'touch') return;
      const cell = (event.target as HTMLElement).closest<HTMLButtonElement>('.tod-writing-day');
      if (cell) this.tooltip.schedule(cell, () => cell.getAttribute('aria-label') || '');
    });
    this.registerDomEvent(this.chart, 'pointerout', event => {
      const cell = (event.target as HTMLElement).closest<HTMLButtonElement>('.tod-writing-day');
      if (cell && !cell.contains(event.relatedTarget as Node | null)) this.tooltip.hide();
    });
    this.registerDomEvent(this.chart, 'click', event => {
      const cell = (event.target as HTMLElement).closest<HTMLButtonElement>('.tod-writing-day');
      if (cell) this.tooltip.show(cell, () => cell.getAttribute('aria-label') || '');
    });
    this.registerDomEvent(this.chart, 'focusout', () => this.tooltip.hide());
    this.registerDomEvent(this.chart, 'keydown', event => this.navigate(event));
    this.registerDomEvent(this.chart, 'focusin', event => {
      const cell = (event.target as HTMLElement).closest<HTMLButtonElement>('.tod-writing-day');
      if (!cell || !this.chart.contains(cell)) return;
      this.reveal(cell);
      this.tooltip.show(cell, () => cell.getAttribute('aria-label') || '');
      const day = cell.dataset.day!;
      if (this.focusDay === day) return;
      if (this.focusDay) this.cells.get(this.focusDay)?.setAttribute('tabindex', '-1');
      this.focusDay = day; cell.tabIndex = 0;
    });
    this.schedule();
  }

  private schedule(): void {
    if (this.stopped || this.frame) return;
    this.frame = this.body.ownerDocument.defaultView!.requestAnimationFrame(() => {
      this.frame = 0; this.render();
    });
  }

  /** Merge activity, layout and settings notifications into one paint per frame. */
  refresh(): void { this.schedule(); }

  private render(): void {
    if (this.stopped) return;
    if (!this.body.isConnected || !this.body.clientWidth || !this.body.clientHeight) { this.tooltip.hide(); return; }
    const today = localDay();
    const dateFormat = this.dateFormat();
    const width = this.body.clientWidth, height = this.body.clientHeight;
    this.error.hidden = !this.activity.error; updateText(this.error, this.activity.error);
    const total = this.activity.total(today), tracked = this.activity.tracking;
    updateText(this.totalValue, tracked ? total.toLocaleString() : '—');
    updateText(this.totalUnit, `${Math.abs(total) === 1 && tracked ? 'word' : 'words'} today`);
    const totalLabel = tracked ? `${formatCount(total, 'word')} today. Words added minus words removed in Obsidian. Earlier dates without tracking are empty.` : 'Today’s word count is unavailable.';
    updateTooltip(this.summary, totalLabel);
    // Both footer pills may wrap; reserve their measured height before sizing the map.
    const calendarHeight = Math.max(0, height - this.footer.offsetHeight - 4 - (this.error.hidden ? 0 : this.error.offsetHeight + 4));
    // Use the calendar's available space, not the card including its footer.
    // Hysteresis prevents orientation flicker around a square while resizing.
    if (!this.signature) this.vertical = calendarHeight > width * 1.2;
    else if (this.vertical ? width > calendarHeight * 1.2 : calendarHeight > width * 1.2) this.vertical = !this.vertical;
    const style = this.body.ownerDocument.defaultView!.getComputedStyle(this.chart);
    const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    if (this.measurementFont !== font) {
      this.measurementFont = font;
      const context = this.body.ownerDocument.adoptNode(createFragment()).createEl('canvas').getContext('2d');
      if (context) {
        context.font = font;
        const measure = (labels: string[]) => Math.ceil(Math.max(...labels.map(label => context.measureText(label).width)));
        this.labelWidths = { weekday: measure(shortWeekdays), month: measure(months), narrow: measure(narrowWeekdays) };
      }
    }
    const labelWidth = this.vertical ? this.labelWidths.month : this.labelWidths.weekday;
    const labelHeight = Math.ceil(parseFloat(style.lineHeight) || 18);
    const dayWidth = Math.max(0, width - labelWidth - LABEL_GAP - CHART_PADDING);
    const dayHeight = Math.max(0, calendarHeight - labelHeight - ROW_GAP - CHART_PADDING);
    // The short axis holds seven weekdays; the long axis determines the visible history.
    const size = Math.max(this.vertical ? Math.max(9, this.labelWidths.narrow) : 9,
      Math.min(24, Math.floor(((this.vertical ? dayWidth : dayHeight) - 6 * CELL_GAP) / 7)));
    const weeks = Math.max(1, Math.min(53, Math.floor(((this.vertical ? dayHeight : dayWidth) + CELL_GAP) / (size + CELL_GAP))));
    this.chart.style.setProperty('--tod-calendar-label-width', `${labelWidth}px`);
    const labelSpan = Math.max(1, Math.ceil(((this.vertical ? labelHeight : this.labelWidths.month) + CELL_GAP) / (size + CELL_GAP)));
    // Size-only changes reuse the day buttons and their keyboard/hover targets.
    this.chart.style.setProperty('--tod-day-size', `${size}px`);
    const signature = `${today}:${weeks}:${this.vertical}:${dateFormat}:${labelSpan}`;
    const rebuilt = signature !== this.signature;
    let restoreFocus = false;
    if (rebuilt) {
      restoreFocus = this.chart.contains(this.chart.ownerDocument.activeElement);
      this.signature = signature;
      this.draw(today, weeks, dateFormat, labelSpan);
    }
    for (const [day, cell] of this.cells) {
      const tracked = this.activity.tracking && day >= this.activity.startedOn;
      const words = this.activity.total(day);
      const state = `${tracked}:${words}:${!!this.activity.error}`;
      if (this.painted.get(day) === state) continue;
      this.painted.set(day, state);
      const label = `${formatDeskDate(calendarDate(day), dateFormat)}${day === today ? ' (today)' : ''}: ${tracked ? `${formatCount(words, 'word')} net` : this.activity.error ? 'Activity unavailable' : 'Not tracked'}`;
      cell.dataset.level = String(level(words));
      cell.toggleClass('is-untracked', !tracked);
      cell.setAttribute('aria-label', label);
    }
    if (restoreFocus) (this.cells.get(this.focusDay || today) || this.cells.get(today))?.focus({ preventScroll: true });
    // A short card may scroll: show the current day after rebuilding, without
    // scrolling the desk page or moving the user's position on a count update.
    if (rebuilt) {
      const cell = this.cells.get(restoreFocus ? this.focusDay || today : today);
      if (cell) this.reveal(cell);
    }
    this.tooltip.refresh();
  }

  private draw(today: string, weeks: number, dateFormat: string, labelSpan: number): void {
    this.tooltip.hide();
    this.cells.clear(); this.painted.clear(); this.dates = []; this.chart.empty();
    this.el.toggleClass('is-vertical', this.vertical);
    this.chart.style.setProperty('--tod-weeks', String(weeks));
    const end = calendarDate(today);
    end.setDate(end.getDate() + (6 - (end.getDay() + 6) % 7));
    const start = new Date(end); start.setDate(start.getDate() - weeks * 7 + 1);
    const labels = this.chart.createDiv({ cls: 'tod-writing-weekdays', attr: { 'aria-hidden': 'true' } });
    (this.vertical ? narrowWeekdays : shortWeekdays.map((name, index) => [0, 2, 4].includes(index) ? name : '')).forEach(label => labels.createSpan({ text: label }));
    const months = this.chart.createDiv({ cls: 'tod-writing-months', attr: { 'aria-hidden': 'true' } });
    const days = this.chart.createDiv({ cls: 'tod-writing-days', attr: { role: 'group', 'aria-label': `Writing activity from ${formatDeskDate(start, dateFormat)} to ${formatDeskDate(calendarDate(today), dateFormat)}. Use arrow keys to move between days.` } });
    let lastMonth = -1, lastLabelWeek = -labelSpan;
    for (let week = 0; week < weeks; week++) {
      const date = new Date(start); date.setDate(date.getDate() + week * 7);
      // Place a month's label over the week containing its first day.
      date.setDate(date.getDate() + 6);
      if (date.getMonth() !== lastMonth && week >= lastLabelWeek + labelSpan && (this.vertical || week === 0 || week + labelSpan <= weeks)) {
        const label = months.createSpan({ text: monthName.format(date) });
        if (this.vertical) label.style.gridRow = String(week + 1);
        else label.style.gridColumn = `${week + 1} / span ${Math.min(labelSpan, weeks - week)}`;
        lastLabelWeek = week;
      }
      lastMonth = date.getMonth();
      for (let row = 0; row < 7; row++) {
        const date = new Date(start); date.setDate(date.getDate() + week * 7 + row);
        const day = localDay(date);
        if (day > today) { days.createSpan({ cls: 'tod-writing-future', attr: { 'aria-hidden': 'true' } }); continue; }
        const cell = days.createEl('button', { cls: 'tod-writing-day', attr: { type: 'button', 'data-day': day, tabindex: day === (this.focusDay || today) ? '0' : '-1' } });
        cell.toggleClass('is-today', day === today);
        if (day === today) cell.setAttribute('aria-current', 'date');
        this.cells.set(day, cell); this.dates.push(day);
      }
    }
    if (!this.cells.has(this.focusDay || '')) { this.focusDay = today; this.cells.get(today)!.tabIndex = 0; }
  }

  private reveal(cell: HTMLElement): void {
    const viewport = this.chart.getBoundingClientRect(), bounds = cell.getBoundingClientRect();
    const right = viewport.left + this.chart.clientWidth, bottom = viewport.top + this.chart.clientHeight;
    if (bounds.left < viewport.left + 3) this.chart.scrollLeft -= viewport.left + 3 - bounds.left;
    else if (bounds.right > right - 3) this.chart.scrollLeft += bounds.right - right + 3;
    if (bounds.top < viewport.top + 3) this.chart.scrollTop -= viewport.top + 3 - bounds.top;
    else if (bounds.bottom > bottom - 3) this.chart.scrollTop += bounds.bottom - bottom + 3;
  }

  private navigate(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const index = this.dates.indexOf((event.target as HTMLElement).dataset.day || '');
    if (index < 0) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); this.cells.get(localDay())?.focus({ preventScroll: true }); this.tooltip.hide(); return;
    }
    const across = this.vertical ? 1 : 7, down = this.vertical ? 7 : 1;
    const delta = event.key === 'ArrowLeft' ? -across : event.key === 'ArrowRight' ? across : event.key === 'ArrowUp' ? -down : event.key === 'ArrowDown' ? down : 0;
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? this.dates.length - 1 : delta ? index + delta : -1;
    if (delta) {
      // Stop at the visible row/column edge instead of jumping into the next week.
      if (next < 0 || next >= this.dates.length || (Math.abs(delta) === 1 && Math.floor(index / 7) !== Math.floor(next / 7))) next = index;
    }
    if (next < 0) return;
    event.preventDefault(); event.stopPropagation(); this.cells.get(this.dates[next])?.focus({ preventScroll: true });
  }

  onunload(): void {
    this.stopped = true;
    this.tooltip.hide();
    if (this.frame) this.body.ownerDocument.defaultView!.cancelAnimationFrame(this.frame);
    this.frame = 0; this.cells.clear(); this.painted.clear(); this.dates = []; this.el.remove();
  }
}
