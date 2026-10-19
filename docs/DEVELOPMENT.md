# Development

This snapshot is Top of the Desk 0.9.50, settings schema 10. It contains TypeScript source, the existing test harness and fixtures, locked development dependencies, build configuration, and the runtime bundle.

```sh
npm ci
npm run bundle
npm run package
```

`npm run bundle` uses esbuild only. `npm run build` runs TypeScript checking before bundling. `npm test` runs the existing suite. Automated tests/typechecking were intentionally not run in the recent development passes; keep this distinction when reporting verification. Screenshot capture is a visual smoke check, not a full regression run.

The runtime depends on Obsidian and its CodeMirror packages, which stay external to the bundle. Internal interfaces are used for embedded Markdown editors, Daily notes, new-tab handling, and Web viewer history. Future Obsidian changes may require maintenance.

The prebuilt bundle and this snapshot have matching source. Keep version fields in `manifest.json`, `package.json`, and both package-lock version entries aligned. The bundle banner in `esbuild.config.mjs` must match. If choosing a different release number, also update `versions.json`, documentation, and release commands before bundling. Do not relabel old screenshots as a new build without checking/recapturing them.

`npm run package` checks version metadata and the bundle banner, then prepares the three release assets and checksums in `dist/<version>/`. It does not publish, run tests, or modify a vault. `private: true` in package.json prevents accidental npm publication; it does not restrict GitHub publishing.

## Local safety

Keep the repository separate from the synced plugin installation. Never replace the real vault's `data.json` with demo preferences. Keep a backup of the installed runtime and current data before any future installation. A newer synced build should be compared with this snapshot before deciding what to release.
