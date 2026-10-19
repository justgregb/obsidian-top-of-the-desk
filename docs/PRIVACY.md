# Storage and privacy

The desk keeps references to existing vault sources. Moving, resizing, stacking, or removing an item does not relocate or delete its source file.

- Plugin `data.json`: desk layout, source references, removed items, and appearance preferences.
- Ordinary Markdown files: Scratchpad and Daily note contents.
- Vault-scoped local Obsidian storage: recent file/folder history, writing totals, last-worked state, and draft recovery.
- Current session: folder search/scroll memory and preview caches.

Web history comes from Obsidian's Web viewer. The plugin does not read other browsers' histories or fetch website previews. Clicking a website uses Web viewer and therefore makes the normal web request. Native Base embeds and other Obsidian integrations retain their own behavior.

The release handoff contains only original demo material and source/build files. It excludes the author's personal plugin preferences, private notes, local browser databases, credentials, and account configuration. The supplied demo has its own explicitly synthetic preferences and history.
