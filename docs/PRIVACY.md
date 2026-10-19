# Storage and privacy

The desk keeps references to existing vault sources. Moving, resizing, stacking, or removing an item does not relocate or delete its source file.

- Plugin `data.json`: desk layout, source references, removed items, and appearance preferences.
- Ordinary Markdown files: Scratchpad and Daily note contents.
- Vault-scoped local Obsidian storage: recent file/folder history, writing totals, last-worked state, and draft recovery.
- Current session: folder search/scroll memory and preview caches.

Web history comes from Obsidian's Web viewer. The plugin does not read other browsers' histories or fetch website previews. Clicking a website uses Web viewer and therefore makes the normal web request. Native Base embeds and other Obsidian integrations retain their own behavior.

The release handoff contains only original demo material and source/build files. It excludes the author's personal plugin preferences, private notes, local browser databases, credentials, and account configuration. The supplied demo has its own explicitly synthetic preferences and history.

## File discovery

Add to desk reads the vault’s loaded file/folder index to offer all supported sources. That sorted index is shared and cached until a file or folder is created, renamed, or deleted. Typing into the picker and changing appearance do not rescan the vault. Daily notes tries an exact path lookup first, then uses a cached Markdown path index for case-insensitive matching. These discovery operations use paths and file metadata; they do not read every note’s contents.

Content previews and word counts read the notes needed by displayed items through Obsidian’s API and a shared read cache. The plugin does not transmit the vault index or note contents. The automated review will therefore still report vault enumeration as a capability; it is required for these features.
