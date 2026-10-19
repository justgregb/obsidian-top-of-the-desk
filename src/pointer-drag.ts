import { Component } from 'obsidian';

interface PointerDragHooks<T> {
  label(value: T): string;
  canStart?(value: T): boolean;
  begin(value: T, source: HTMLElement): void;
  move(value: T, x: number, y: number): boolean;
  drop(value: T, x: number, y: number): void;
  end(): void;
}

/** Local pointer gestures avoid native drag handling competing with Obsidian. */
export class PointerDrag<T> extends Component {
  private cancelGesture: (() => void) | null = null;
  private suppressClickUntil = 0;

  constructor(private hooks: PointerDragHooks<T>) { super(); }

  bind(handle: HTMLElement, value: T, source: HTMLElement, touchDrag = false): void {
    handle.draggable = false;
    handle.addClass('tod-drag-handle');
    handle.toggleClass('tod-touch-drag-handle', touchDrag);
    handle.addEventListener('dragstart', event => event.preventDefault());
    handle.addEventListener('click', event => {
      if (Date.now() < this.suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    handle.addEventListener('pointerdown', event => this.start(event, handle, value, source));
  }

  /** Resolve at gesture time: native Base rows can be recycled or replaced. */
  delegate(container: HTMLElement, resolve: (target: HTMLElement) => { handle: HTMLElement; value: T; source: HTMLElement } | null): () => void {
    const match = (event: Event) => {
      const target = event.target as HTMLElement | null;
      return target?.closest ? resolve(target) : null;
    };
    const down = (event: PointerEvent) => {
      const item = match(event);
      if (item) this.start(event, item.handle, item.value, item.source);
    };
    const nativeDrag = (event: DragEvent) => {
      const item = match(event);
      if (item && this.hooks.canStart?.(item.value) !== false) { event.preventDefault(); event.stopPropagation(); }
    };
    const click = (event: MouseEvent) => {
      if (Date.now() < this.suppressClickUntil && match(event)) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    container.addEventListener('pointerdown', down, true);
    container.addEventListener('dragstart', nativeDrag, true);
    container.addEventListener('click', click, true);
    return () => {
      container.removeEventListener('pointerdown', down, true);
      container.removeEventListener('dragstart', nativeDrag, true);
      container.removeEventListener('click', click, true);
    };
  }

  private start(event: PointerEvent, handle: HTMLElement, value: T, source: HTMLElement): void {
      if (event.button !== 0 || !event.isPrimary || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      // A swipe on content belongs to the browser. Only an explicit grip starts a touch drag.
      if (event.pointerType === 'touch' && !handle.hasClass('tod-touch-drag-handle')) return;
      if (this.hooks.canStart?.(value) === false) return;
      event.stopPropagation();
      this.cancel();
      const doc = handle.ownerDocument, win = doc.defaultView!;
      const id = event.pointerId, startX = event.clientX, startY = event.clientY;
      let x = startX, y = startY, started = false, ended = false, frame = 0;
      let ghost: HTMLElement | null = null;
      let ghostWidth = 0, ghostHeight = 0, transform = '', validDrop: boolean | undefined;

      const draw = () => {
        if (!started || ended || !ghost) return;
        if (!source.isConnected) { stop(false); return; }
        const valid = this.hooks.move(value, x, y);
        if (valid !== validDrop) { ghost.toggleClass('is-valid-drop', valid); validDrop = valid; }
        const left = Math.max(8, Math.min(x + 16, win.innerWidth - ghostWidth - 8));
        const top = Math.max(8, Math.min(y + 16, win.innerHeight - ghostHeight - 8));
        const nextTransform = `translate(${left}px, ${top}px)`;
        if (nextTransform !== transform) { ghost.style.transform = nextTransform; transform = nextTransform; }
        frame = win.requestAnimationFrame(draw);
      };
      const stop = (commit: boolean) => {
        if (ended) return;
        ended = true; this.cancelGesture = null;
        doc.removeEventListener('pointermove', move, true);
        doc.removeEventListener('pointerup', up, true);
        doc.removeEventListener('pointercancel', cancel, true);
        doc.removeEventListener('keydown', key, true);
        handle.removeEventListener('lostpointercapture', cancel);
        win.removeEventListener('blur', cancel);
        win.removeEventListener('resize', cancel);
        win.cancelAnimationFrame(frame);
        if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
        ghost?.remove(); doc.body.removeClass('tod-pointer-dragging');
        if (started) {
          this.suppressClickUntil = Date.now() + 300;
          try { if (commit) this.hooks.drop(value, x, y); }
          finally { this.hooks.end(); }
        }
      };
      const move = (next: PointerEvent) => {
        if (next.pointerId !== id) return;
        x = next.clientX; y = next.clientY;
        if (!started) {
          const threshold = event.pointerType === 'touch' ? 8 : 5;
          if (Math.hypot(x - startX, y - startY) < threshold) return;
          if (!source.isConnected) { stop(false); return; }
          started = true;
          handle.setPointerCapture(id);
          doc.getSelection()?.removeAllRanges();
          ghost = doc.body.createDiv({ cls: 'tod-drag-preview', text: this.hooks.label(value), attr: { 'aria-hidden': 'true' } });
          doc.body.addClass('tod-pointer-dragging');
          this.hooks.begin(value, source);
          // The label and its dimensions stay fixed for this gesture. Resize
          // cancels it, and valid-drop feedback changes only the border color.
          ghostWidth = ghost.offsetWidth; ghostHeight = ghost.offsetHeight;
          draw();
        }
        next.preventDefault(); next.stopPropagation();
      };
      const up = (next: PointerEvent) => {
        if (next.pointerId !== id) return;
        x = next.clientX; y = next.clientY;
        if (started) { next.preventDefault(); next.stopPropagation(); }
        stop(true);
      };
      const cancel = () => stop(false);
      const key = (next: KeyboardEvent) => {
        if (next.key !== 'Escape') return;
        next.preventDefault(); next.stopImmediatePropagation(); stop(false);
      };
      this.cancelGesture = cancel;
      doc.addEventListener('pointermove', move, { capture: true, passive: false });
      doc.addEventListener('pointerup', up, true);
      doc.addEventListener('pointercancel', cancel, true);
      doc.addEventListener('keydown', key, true);
      handle.addEventListener('lostpointercapture', cancel);
      win.addEventListener('blur', cancel);
      win.addEventListener('resize', cancel);
  }

  cancel(): void { this.cancelGesture?.(); }
  onunload(): void { this.cancel(); }
}
