import { Component, setIcon } from 'obsidian';
import { updateAttribute, updateText, updateTooltip } from './ui';

const clock = (seconds: number): string => {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(value / 3600), minutes = Math.floor(value / 60) % 60;
  return `${hours ? hours + ':' + String(minutes).padStart(2, '0') : Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};

/** Local media with a compact, accessible transport instead of clipped browser chrome. */
export class DeskAudioPlayer extends Component {
  private media: HTMLAudioElement;
  private row: HTMLElement;
  private play: HTMLButtonElement;
  private seek: HTMLInputElement;
  private time: HTMLElement;
  private mute: HTMLButtonElement;
  private name = '';
  private stopped = false;
  private failed = false;
  private seeking = false;
  private playing: boolean | null = null;
  private muted: boolean | null = null;
  private playRequest = 0;

  constructor(parent: HTMLElement, source: string, name: string) {
    super();
    this.media = parent.createEl('audio', { attr: { preload: 'metadata', hidden: '' } });
    this.row = parent.createDiv({ cls: 'tod-audio-player', attr: { role: 'group' } });
    this.play = this.row.createEl('button', { cls: 'tod-audio-button', attr: { type: 'button' } });
    this.seek = this.row.createEl('input', { cls: 'tod-audio-seek', attr: { type: 'range', min: '0', max: '0', step: '0.1', value: '0' } });
    this.time = this.row.createSpan({ cls: 'tod-audio-time', attr: { 'aria-hidden': 'true' } });
    this.mute = this.row.createEl('button', { cls: 'tod-audio-button', attr: { type: 'button', 'aria-label': 'Mute audio', 'aria-pressed': 'false' } });
    this.registerDomEvent(this.play, 'click', () => {
      const request = ++this.playRequest;
      if (!this.media.paused && !this.media.ended) { this.media.pause(); return; }
      this.failed = false;
      if (this.media.error) this.media.load();
      void this.media.play().catch(() => {
        if (!this.stopped && request === this.playRequest) { this.failed = true; this.sync(); }
      });
    });
    this.registerDomEvent(this.mute, 'click', () => {
      const unmute = this.media.muted || this.media.volume === 0;
      this.media.muted = !unmute;
      if (unmute && this.media.volume === 0) this.media.volume = 1;
    });
    this.registerDomEvent(this.seek, 'input', () => {
      if (this.seek.disabled) return;
      try { this.media.currentTime = Number(this.seek.value); } catch { /* The source may have been removed while seeking. */ }
      this.sync();
    });
    this.registerDomEvent(this.seek, 'pointerdown', () => { this.seeking = true; });
    const finishSeek = () => { if (this.seeking) { this.seeking = false; this.sync(); } };
    this.registerDomEvent(parent.ownerDocument, 'pointerup', finishSeek);
    this.registerDomEvent(parent.ownerDocument, 'pointercancel', finishSeek);
    this.registerDomEvent(this.seek, 'blur', finishSeek);
    this.registerDomEvent(parent.ownerDocument.defaultView!, 'blur', finishSeek);
    for (const event of ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'ended', 'volumechange'] as const) {
      this.registerDomEvent(this.media, event, () => this.sync());
    }
    this.registerDomEvent(this.media, 'error', () => { this.failed = true; this.sync(); });
    this.registerDomEvent(this.media, 'canplay', () => { this.failed = false; this.sync(); });
    this.setName(name);
    this.media.src = source;
  }

  setName(name: string): void {
    if (this.name === name) return;
    this.name = name;
    this.row.setAttribute('aria-label', `Audio player for ${name}`);
    this.seek.setAttribute('aria-label', 'Playback position');
    this.sync();
  }

  private sync(): void {
    if (this.stopped) return;
    const playing = !this.media.paused && !this.media.ended;
    if (playing !== this.playing) { setIcon(this.play, playing ? 'pause' : 'play'); this.playing = playing; }
    const label = this.failed ? 'Retry playback' : playing ? 'Pause' : 'Play';
    updateTooltip(this.play, label);
    updateAttribute(this.play, 'aria-label', label);
    const muted = this.media.muted || this.media.volume === 0;
    if (muted !== this.muted) { setIcon(this.mute, muted ? 'volume-x' : 'volume-2'); this.muted = muted; }
    updateTooltip(this.mute, muted ? 'Unmute audio' : 'Mute audio');
    updateAttribute(this.mute, 'aria-pressed', String(muted));
    const duration = Number.isFinite(this.media.duration) && this.media.duration > 0 ? this.media.duration : 0;
    const disabled = !duration || this.failed;
    if (this.seek.disabled !== disabled) this.seek.disabled = disabled;
    updateAttribute(this.seek, 'max', String(duration));
    if (!this.seeking) {
      const value = String(Math.min(this.media.currentTime || 0, duration));
      if (this.seek.value !== value) this.seek.value = value;
    }
    const progress = `${duration ? Math.round(Number(this.seek.value) / duration * 1000) / 10 : 0}%`;
    if (this.seek.style.getPropertyValue('--tod-audio-progress') !== progress) this.seek.style.setProperty('--tod-audio-progress', progress);
    const current = clock(this.seeking ? Number(this.seek.value) : this.media.currentTime);
    const total = clock(duration);
    // Reserve the full elapsed/duration width so digit changes do not move the seek track.
    const timeWidth = `${total.length * 2 + 3}ch`;
    if (this.time.style.getPropertyValue('--tod-audio-time-width') !== timeWidth) this.time.style.setProperty('--tod-audio-time-width', timeWidth);
    updateAttribute(this.seek, 'aria-valuetext', duration ? `${current} of ${total}` : current);
    updateText(this.time, this.failed ? 'Can’t play' : duration ? `${current} / ${total}` : current);
    updateTooltip(this.time, this.failed ? 'Couldn’t play this audio. Retry playback or open the original file.' : 'Playback time');
  }

  onunload(): void {
    this.stopped = true;
    this.media.pause(); this.media.removeAttribute('src'); this.media.load(); this.media.remove();
    this.row.remove();
  }
}
