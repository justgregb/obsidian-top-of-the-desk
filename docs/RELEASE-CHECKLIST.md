# Release verification

## 0.9.53 — Description correction

Updates the manifest and shared release copy so the description no longer starts with the plugin name. Packaging now rejects that wording and mismatched package/manifest descriptions. The runtime code and stylesheet are unchanged from 0.9.52; only the bundle’s version banner changes. Local lint, all 38 automated tests, typechecking, build, and packaging are checked for this patch. The recorded 0.9.52 desktop checks remain the behavioral baseline.

## 0.9.52 — Obsidian review fixes

Prepared on 2026-10-19 against GitHub's 0.9.51 source. Desktop testing used macOS and Obsidian 1.14.4 in a separate fictional demo vault. No personal plugin preferences or note contents are included.

- Source lint uses the official `eslint-plugin-obsidianmd` recommended configuration and fails on warnings. The sentence-case rule retains canonical product, core-plugin, command, and keyboard-key names.
- CSS checks parse the stylesheet and reject relational `:has()` selectors, `!important`, `clip-path`, and `column-gap`. Grid gaps and classic visually-hidden clipping preserve the existing layout.
- Automated tests cover storage and conflict recovery, settings migration, source validation, layout, seven-day history, malformed input, control-character sanitization, and cached vault discovery.
- Obsidian integration covers source additions, stacks, Undo, writing, external-edit recovery, audio, and reload persistence. Focused review checks cover native settings, hidden controls, Base marker gutters, compact content, status-bar restoration, and stable geometry when switching writing tools.
- Interaction checks cover heading dragging, keyboard Move, Undo, dialogs, and overlap/overflow at 1400, 900, and 500 CSS pixels, with light/dark screenshots.

Current results are recorded in `verification/0.9.52.json`. Windows, Linux, screen-reader navigation, and separate pop-out windows have not been exercised in this pass. Native embedded editor and Web viewer adapters still depend on internal Obsidian interfaces.

## Publishing

1. Merge the reviewed changes after the Check workflow passes.
2. Push tag `0.9.53` on the reviewed source commit, without a `v` prefix.
3. The Prepare release workflow validates the version, installs locked dependencies, lints, tests, builds, verifies the committed bundle, and packages the three runtime files.
4. GitHub Actions generates provenance attestations for those exact assets and creates a **draft** release containing only `main.js`, `manifest.json`, and `styles.css`.
5. Review the draft and publish it. Do not replace files from an already published tag; use a new version for changes.

Attestations are created by GitHub Actions, not by a local build. After downloading a release asset, verify it with `gh attestation verify main.js --repo justgregb/obsidian-top-of-the-desk` (repeat for the other assets).

Local SHA-256 checksums remain in `dist/0.9.53-SHA256SUMS.txt`, outside the asset directory. They are not uploaded to releases. Previous releases retain their historical assets and verification records.

The vault-enumeration recommendation is intentional: Add to desk must list supported files and folders, and Daily notes needs a case-insensitive fallback. See [Storage and privacy](PRIVACY.md). It is not a claim that the plugin sends file paths elsewhere.

Historical 0.9.51 results remain in `verification/0.9.51.json`.
