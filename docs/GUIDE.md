# Top of the Desk

A quiet Obsidian home for the files, websites, and writing tools you want within reach.

Version **0.9.50** · The manifest declares Obsidian **1.11.0 or later**; minimum-version and mobile verification are pending. The supplied screenshots use macOS and Obsidian **1.14.4**.

## Make it yours

Open **Top of the Desk** from the ribbon or run **Open desk** from the command palette. Click the desk title to rename it; leave it blank to hide it. **Restore desk title** is available in **Add to desk**.

The top row provides Obsidian’s available actions for creating a note, Base or canvas, finding a file, and opening Web viewer. **Add to desk** stays at the end of that row. Actions appear or disappear as their core plugins are enabled or disabled.

Add any of these sources:

| Source | On the desk |
| --- | --- |
| Note | A title, short excerpt, and folder path. Click to preview; use the arrow to open it. |
| Folder | A cover or a browsable list. Notes stay in their original folders. |
| Base | A native Base view, with an optional heading and toolbar. |
| Canvas | A compact link that opens the canvas. |
| PDF | A compact link with a PDF document icon. |
| Audio | A compact player with play/pause, seeking, time, and mute. |
| Image | A fitted preview with adjustable width and height. |
| URL | A compact link that opens Web viewer. The site name appears only when it adds context. |

Use **Add to desk**, drag from Obsidian’s Files sidebar or Bookmarks, or use the action beside a **Recently opened** entry. Selecting a file or folder adds it immediately using its existing name and default view. Paste an HTTP or HTTPS address into the Add search and press Enter to add it directly; Web viewer history entries also add immediately. The empty search puts up to eight recent items first, followed by Actions and all other items. Sources already on the desk remain searchable and show **On desk**; selecting one reveals its existing location, including inside a stack. Existing sources are revealed instead of duplicated. Change the name or Base view later in **Edit**. **Add current file to desk** works with supported file types from the command palette. A locator icon means **Show on desk** for an item already there; an outward arrow opens its source. Adding a source keeps a reference; it does not move the original file.

Canvases, PDFs, audio, and URLs have one fixed compact size. Other items offer **Resize** (diagonal arrows), a small grid for choosing width and height. Two compact items and their gap fit in one half-height space; two half-height items fit in one standard-height space. The desk adapts to one, two, or four columns.

## Arrange and group

Hover over an item or focus it with the keyboard to reveal its toolbar. On touch, use the ellipsis button for actions. The floating toolbar follows one order: **Move**, **Resize**, **Edit**, then **Add notes**. Only available actions appear. **Edit** (horizontal sliders) contains heading and Base-toolbar visibility, **Unstack**, and **Remove from desk** where applicable. **Save** becomes available when you change a setting and applies the changes together; **Cancel** discards them. Unstack and removal are separate actions with Undo. Preview windows keep **Close** last. **Remove from desk** and visibility actions keep their full meaning. Forms use **Name**, **Display**, and **View**, with **Add** or **Create** to finish. Edit preferences apply only to the desk. Drag a heading to reposition an item. **Move** remains available when a heading is hidden, when using the keyboard, and on touch. Activate it, use the arrow keys, then press Enter to place the item. Escape cancels.

Drop one note onto another to create a note stack. Stacks require at least two notes; a stack with one remaining note becomes an individual note. Click a stack or folder cover to browse it, then choose a note to open. Use **New note stack** in Add to desk to select notes without dragging. Selections stay checked as you filter; **Show more** reveals the next set of results.

Other items and writing tools can share a stack. Choose **New stack**, or drag compatible items together. The icons at the bottom identify the members. Click an icon, swipe across the switcher, or use Left/Right when it has keyboard focus. Home and End choose the first and last member. Switching preserves mounted editors, playback, and scroll positions. Linked headings share a single-line frame; long names and date labels shorten with an ellipsis.

In **Edit**, **Hide heading** controls the title and icon together where the content can stand on its own. Turn it off to show the heading again. Canvases, PDFs, audio, and URLs always retain their heading and do not offer this control. In a stack, **Hide headings** applies only to members with optional headings. Editing a mixed stack changes the active item’s source details; **Unstack** and **Remove from desk** act on the whole stack. **Remove from desk**, shown with an archive-box icon, leaves the original source untouched. Restore removed items through **Add to desk → Removed from desk**. Moving, stacking, resizing, and removal offer Undo.

## Writing tools

- **Scratchpad** edits a regular Markdown note. The file is created only when needed. Select text to create a separate note and add it to the desk.
- **Daily note** follows Obsidian’s Daily notes folder, date format, and template. Choose **Create today’s note** to get started.
- **Recently opened** includes the same eight source types. Every entry follows one rule: **Today** or **Earlier**, covering today and the previous six local calendar days. Up to 100 distinct entries are shown. Web pages come from Obsidian’s local Web viewer history. Folder history records browsing or revealing a folder through the desk; expanding a sidebar folder alone does not count.
- **Writing activity** records net word changes: words added minus words removed. Tracking begins when the tool is first added. It does not reconstruct earlier activity or count synced changes as writing.

**Last worked on** marks the most recently edited eligible note. Its action resumes the original note, reusing an open tab where possible. Opening or previewing a note does not mark it as edited.

## Storage and recovery

Desk layout, source references, removed items, and appearance preferences live in the plugin’s `data.json`. Recent file/folder history, writing totals, last-worked state, and draft recovery use vault-scoped local Obsidian storage. Folder search and scroll memory last for the current plugin session.

Notes stay ordinary Markdown files. Scratchpad and Daily note editing preserve frontmatter and line endings, and check for external changes before saving. If a conflict occurs, **Save draft as new note** keeps both versions. An unsaved daily draft retains its original date and source across midnight.

The plugin does not fetch URL previews or use an external service. Images and audio load local vault resources; Base embeds retain Obsidian’s own behavior. Websites open in Web viewer. Clearing Web viewer history removes its pages from Recently opened; disabling Web viewer hides them. Other browsers’ histories are not read.

Supported audio extensions: `mp3`, `wav`, `m4a`, `3gp`, `flac`, `ogg`, `oga`, `opus`. Supported image extensions: `bmp`, `png`, `jpg`, `jpeg`, `gif`, `svg`, `webp`, `avif`.

## Install and update

Place `main.js`, `manifest.json`, and `styles.css` in `.obsidian/plugins/top-of-the-desk/`, then enable the plugin in Obsidian’s Community plugins settings. To update, replace those three files and reload the plugin. Keep your existing `data.json`.

This version retains settings schema 10. Older desks migrate automatically, preserving source references and responsive positions. Keep a copy of the previous runtime files and `data.json` before updating; restoring both is necessary when rolling back a schema migration.

