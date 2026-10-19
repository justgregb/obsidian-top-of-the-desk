# Release verification — 0.9.51

Verified 2026-10-19 in a separate fictional demo vault on macOS with Obsidian 1.14.4 (installer 1.14.4). Repository: `justgregb/obsidian-top-of-the-desk`. Tag: `0.9.51`. Regular release, MIT license. The existing 0.9.50 prerelease and tag remain unchanged.

## Passed

- 26 existing automated tests and 7 added regression tests.
- Strict TypeScript checking, production bundling, version consistency, and release packaging.
- 52 desktop integration assertions: eight source types and duplicate reuse; source preservation; remove/Undo; stacks; image sizing and movement; compact-source headings; note/folder renames; recent history; scratchpad and daily-note persistence/conflict recovery; embedded editor writes; writing totals; switching writing tools; audio mute/play/seek/pause; settings persistence.
- Plugin reload preserves saved settings.
- 10 interaction/layout checks: keyboard Move handler and Undo; actual mouse heading drag and Undo; Add dialog and Escape; no overlapping items or horizontal overflow at 1400, 900, and 500 CSS pixels; dark appearance capture. Screenshots visually reviewed.
- Fixed a failure caught by the responsive test: implicit CSS tracks left behind by saved positions caused the grid to retain four columns after narrowing. A declared responsive column count now drives the layout calculation.
- No captured runtime errors after the final integration run.
- Larger-vault smoke check with 1,000 generated notes and 200 additional desk notes: catalog indexing 1 ms, add/save/render 181 ms, Add picker 90 ms on this Mac. These are single-run observations, not performance guarantees or a benchmark suite.
- User-approved description and MIT license preserved; third-party notice included in the bundle. Fictional fixtures and original screenshot provenance retained. No personal vault files are included.

## Scope and limitations

The manifest now requires desktop Obsidian 1.14.4+, matching the tested minimum. Mobile is excluded. Windows, Linux, other Obsidian versions, native Files-sidebar drag gestures, complete keyboard traversal, and screen readers were not exercised. Keyboard Move uses dispatched key events; pointer dragging uses DevTools mouse events. Narrow desktop widths do not establish mobile support. Network website loading and all possible themes/plugins are outside this pass.

The five public demo screenshots retain their accurately labelled 0.9.50 capture provenance. Additional 0.9.51 verification screenshots were reviewed locally. Tests run in an isolated vault and do not modify the personal installation.

## Publication

Publish the exact reviewed source commit with tag `0.9.51`. Upload `main.js`, `manifest.json`, `styles.css`, and `SHA256SUMS.txt`. Verify GitHub asset digests, tag commit, and regular/latest release status. Community directory submission is separate and is not part of this release.

Machine-readable results: [verification/0.9.51.json](verification/0.9.51.json).
