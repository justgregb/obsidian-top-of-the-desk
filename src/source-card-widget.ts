import { Component } from 'obsidian';
import { COPY } from './copy';
import type DeskPlugin from './main';
import { widgetName, type WidgetSettings } from './model';
import { isCompactSourceType, matchesSourceFile, sourceWebSite, sourceWebUrl } from './source-types';
import { updateText, updateTooltip } from './ui';
import { DeskAudioPlayer } from './audio-player';

/** Lightweight source cards; images resize and only audio mounts a media control. */
export class SourceCardWidget extends Component {
  private key = '';
  private audio: DeskAudioPlayer | null = null;
  private site: HTMLElement | null = null;
  constructor(private plugin: DeskPlugin, private id: string, private body: HTMLElement) { super(); }

  render(settings: WidgetSettings): void {
    if (!isCompactSourceType(settings.type) && settings.type !== 'image') return;
    const url = settings.type === 'web' ? sourceWebUrl(settings.path) : null;
    const candidate = settings.type !== 'web' ? this.plugin.app.vault.getFileByPath(settings.path) : null;
    const file = candidate && matchesSourceFile(settings.type, candidate.extension) ? candidate : null;
    const available = settings.type === 'web' ? !!url : !!file;
    const key = JSON.stringify([settings.type, settings.enabled, settings.path, available, settings.type === 'image' ? file?.stat.mtime : null]);
    if (key !== this.key) {
      this.key = key; this.releaseAudio(); this.body.empty(); this.site = null;
      if (!settings.enabled) { this.syncContent(); return; }
      if (!available) {
        const message = settings.type === 'web'
          ? settings.path ? 'Enter a valid web address.' : 'Enter a web address.'
          : settings.path ? 'This file is no longer available.' : 'Choose a file.';
        this.recovery(message,
          settings.type === 'web' ? 'Edit web address' : 'Choose file', () => this.plugin.configureWidget(this.id));
        return;
      }
      if (settings.type === 'audio' && file) {
        this.audio = this.addChild(new DeskAudioPlayer(this.body, this.plugin.app.vault.getResourcePath(file), widgetName(settings)));
      } else if (settings.type === 'image' && file) {
        const image = this.body.createEl('img', { cls: 'tod-source-image', attr: { alt: file.basename, loading: 'lazy', decoding: 'async', draggable: 'false' } });
        image.onerror = () => {
          if (!image.isConnected || this.key !== key) return;
          this.body.empty();
          this.recovery('Couldn’t load this image.', COPY.tryAgain, () => {
            const current = this.plugin.settings.widgets[this.id];
            if (current?.enabled) { this.key = ''; this.render(current); }
          });
        };
        image.src = this.plugin.app.vault.getResourcePath(file);
      } else if (url) {
        this.site = this.body.createSpan('tod-compact-site');
        updateTooltip(this.site, url);
      }
    }
    this.audio?.setName(widgetName(settings));
    if (this.site && url) {
      const site = sourceWebSite(url, widgetName(settings));
      updateText(this.site, site);
      this.site.hidden = !site;
    }
    this.syncContent();
  }
  private syncContent(): void {
    const visible = Array.from(this.body.children).some(child => !child.hasAttribute('hidden'));
    this.body.toggleClass('has-content', visible);
    this.body.closest('.tod-widget')?.toggleClass('has-source-content', visible);
    this.body.closest('.tod-widget')?.toggleClass('has-site-context', !!this.site && !this.site.hidden);
  }
  private releaseAudio(): void {
    if (!this.audio) return;
    this.removeChild(this.audio); this.audio = null;
  }
  private recovery(message: string, label: string, run: () => void): void {
    const button = this.body.createEl('button', { cls: 'tod-source-recovery', text: label,
      attr: { type: 'button', 'aria-label': `${message} ${label}` } });
    updateTooltip(button, `${message} ${label}`); button.onclick = run;
    this.syncContent();
  }
  onunload(): void { this.releaseAudio(); this.key = ''; this.body.empty(); }
}
