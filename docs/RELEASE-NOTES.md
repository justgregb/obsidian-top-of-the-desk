# Top of the Desk 0.9.53

Corrects the plugin description to meet Obsidian’s submission guidelines:

> Keep notes, files, websites, and writing tools together on a customizable desk.

The manifest, package metadata, README, and release copy use the same description. Packaging now rejects descriptions that start with the plugin name, preventing this warning from returning.

Runtime behavior and styles are unchanged from 0.9.52. Vault enumeration remains necessary for file search and the case-insensitive Daily note lookup; discovery is cached and documented in [Storage and privacy](https://github.com/justgregb/obsidian-top-of-the-desk/blob/main/docs/PRIVACY.md).

Requires desktop Obsidian 1.14.4 or later. Download `main.js`, `manifest.json`, and `styles.css`, replace those three files, and reload the plugin. Preserve your existing `data.json`.
