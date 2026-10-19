interface WheelIntent {
  direction: number;
  distance: number;
  magnitude: number;
  trough: number;
  lastAt: number;
  consumedAt: number | null;
}

/** Separate a renewed swipe from its predecessor's decaying momentum. */
export class StackWheelGesture {
  private intent: WheelIntent | null = null;
  private idleTimer = 0;

  constructor(private win: Window) {}

  accept(delta: number): number {
    const magnitude = Math.abs(delta);
    // Zero/subpixel tail events must not keep a completed gesture alive.
    if (!Number.isFinite(delta) || magnitude < 1) return 0;
    const now = this.win.performance.now(), direction = Math.sign(delta);
    const previous = this.intent;
    const fresh = !previous || now - previous.lastAt >= 100 || direction !== previous.direction ||
      (previous.consumedAt !== null && now - previous.consumedAt >= 80 &&
        magnitude > previous.magnitude + 0.5 && magnitude >= Math.max(4, previous.trough * 1.6, previous.trough + 3));
    const intent: WheelIntent = fresh
      ? { direction, distance: 0, magnitude, trough: magnitude, lastAt: now, consumedAt: null }
      : previous;
    this.intent = intent;
    intent.lastAt = now; intent.magnitude = magnitude;
    intent.trough = Math.min(intent.trough, magnitude);
    this.win.clearTimeout(this.idleTimer);
    this.idleTimer = this.win.setTimeout(() => this.reset(), 100);
    if (intent.consumedAt !== null) return 0;
    intent.distance += magnitude;
    if (intent.distance < 48) return 0;
    intent.consumedAt = now; intent.trough = magnitude;
    return direction;
  }

  reset(): void {
    this.win.clearTimeout(this.idleTimer); this.idleTimer = 0; this.intent = null;
  }
}
