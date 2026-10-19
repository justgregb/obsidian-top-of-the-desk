# Top of the Desk 0.9.52

This update addresses the Obsidian plugin review while preserving the desk’s layout and interactions.

- Validates saved settings, recent history, Base views, and writing activity before using them.
- Uses Obsidian’s element helpers, window-safe element checks, supported active-view access, and browser timers.
- Makes plugin preferences searchable through Obsidian’s native settings definitions.
- Replaces relational CSS selectors and important overrides with local state and scoped styles. Stacked editors retain their spacing; floating controls and compact items retain their visibility rules.
- Shares cached file discovery with Daily notes. Appearance changes do not rescan the vault.
- Adds source and CSS lint checks, regression coverage, and GitHub Actions checks.
- Builds release assets from their source tag and records GitHub artifact attestations. Only `main.js`, `manifest.json`, and `styles.css` are attached to releases.

Requires desktop Obsidian 1.14.4 or later. Settings schema remains 10; existing layouts and source files are preserved. Install the three runtime files and reload the plugin, keeping your existing `data.json`.

See [release verification](RELEASE-CHECKLIST.md) for test results and limitations. The release workflow creates a draft for final review before publication.
