# Top of the Desk 0.9.51

Top of the Desk keeps your current work within reach.

Bring the things you’re working on together in Obsidian: a draft, a reading list, today’s note, and the references you keep returning to.

Add notes, folders, Bases, canvases, PDFs, audio, images, and websites. Arrange them your way, group related notes into stacks, and keep a scratchpad close for passing thoughts. Everything stays in its original place in your vault.

Return to recently opened items, continue your daily writing, and see your writing activity—all from your desk.

## Changes

- Fixed overlapping desk items when a window changes from four columns to two or one. The layout now reads the declared responsive column count instead of counting implicit CSS tracks left by older positions.
- Fixed TypeScript validation errors, guarded file-only event handlers, and used the supported popover cleanup lifecycle.
- Updated the desktop integration harness and added history, source validation, layout, and writing-activity regression tests.

## Verification and compatibility

Passed: 33 automated tests, TypeScript checking, production build and packaging, 52 checks inside Obsidian, reload persistence, and 10 interaction/layout checks. These include saving and conflict recovery, all eight source types, Undo, stacks, audio, writing counts, heading dragging, and layouts at 1400, 900, and 500 CSS pixels. A 1,000-note/200-added-desk-note performance smoke check also completed successfully.

This release requires **desktop Obsidian 1.14.4+**, with verification performed on macOS 1.14.4. Mobile and older Obsidian versions are excluded; Windows and Linux were not exercised. Keyboard Move was tested by event dispatch; full keyboard navigation and screen-reader coverage remain outside these checks. See `docs/RELEASE-CHECKLIST.md` for scope and limitations.

Distributed under MIT. Install `main.js`, `manifest.json`, and `styles.css` in `.obsidian/plugins/top-of-the-desk/`, then enable the plugin. When updating, preserve your existing `data.json`. The plugin is not yet listed in the Community directory.
