# Development

Top of the Desk 0.9.53 uses settings schema 10. Runtime dependencies on Obsidian and CodeMirror remain external to the production bundle.

```sh
npm ci
npm run lint
npm test
npm run typecheck
npm run build
npm run package
```

`npm test` runs 38 automated tests. `npm run build` typechecks before bundling; `npm run bundle` only bundles. `npm run package` checks coordinated versions, compatibility metadata, bundle banner, and description, then generates only the three runtime assets in `dist/<version>/`. Local SHA-256 checksums are written alongside that directory, never inside it.

## Desktop checks

Use a separate demo vault named `Top of the Desk Release QA`, created with `scripts/prepare-demo.mjs`. Open it in Obsidian with the CLI enabled. These scripts reject other vault names and require the demo marker.

```sh
npm run test:obsidian -- "Top of the Desk Release QA"
node scripts/test-ui.mjs "Top of the Desk Release QA"
node scripts/test-review-ui.mjs "Top of the Desk Release QA"
```

Integration checks exercise actual vault writes, draft recovery, source additions, layouts, audio, editor input, writing counts, and reload persistence. Interaction checks cover the Move key handler, actual DevTools mouse input, Undo, dialogs, and desktop responsive layouts. Reports and screenshots are saved under ignored `dist/verification/`.

The demo is disposable: checks create and trash synthetic files and alter demo-local history. Never run them on personal notes. The real synced plugin installation is separate and is not updated by these commands.

Internal interfaces remain in the embedded editor, Daily notes, and Web viewer integrations. Future Obsidian changes may require maintenance. See [release verification](RELEASE-CHECKLIST.md).

Source lint uses Obsidian’s official recommended rules. CSS is parsed with PostCSS and checked for the review’s compatibility and selector findings. GitHub Actions runs these checks before building or preparing a release. The development-only Moment override keeps Obsidian’s type-package dependency on its patched version; Moment is supplied by Obsidian at runtime and is not bundled.
