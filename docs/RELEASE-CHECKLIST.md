# Release verification — 0.9.50

Prepared 2026-10-19 from the supplied 2026-10-16 handoff. Repository: `justgregb/top-of-the-desk`. Tag: `0.9.50`, without a `v` prefix. Release status: prerelease. License: MIT, selected by Greg on 2026-10-19.

## Completed

- Verified all 148 original handoff file checksums before editing.
- Compared the synced installation's manifest and runtime hashes with the handoff; all matched its recorded installed snapshot.
- Applied Greg's full replacement description to the README, description document, and release notes. Used its opening sentence for compact manifest, package, and GitHub metadata.
- Added the approved MIT License and package license metadata.
- Included the existing third-party notice in the JavaScript bundle; executable content otherwise matches the supplied runtime exactly.
- Installed locked dependencies and rebuilt with `npm run bundle`; packaged using `npm run package`.
- Checked version metadata, bundle banner, three asset checksums, local documentation/image links, and all five supplied screenshots.
- Reviewed the publication tree for personal files, local machine paths, and credential patterns. Only the standalone source repository and fictional demo fixtures are published.

## Verification limits

Automated tests, TypeScript checking, broad runtime regression checks, mobile/touch checks, minimum-version checks, and performance benchmarks were not run for this prerelease. The handoff records prior screenshot capture on macOS with Obsidian 1.14.4; visual review does not establish every interaction's correctness.

The manifest retains its existing declared Obsidian 1.11.0 minimum and mobile eligibility. These remain unverified and are disclosed in the README and release notes. Before a stable release, validate or revise those compatibility declarations and exercise persistence, Undo, source additions, duplicate reveal, dragging, stacks, editors, audio, history, and keyboard/touch behavior.

## Publication checks

Publish from the exact reviewed commit. Upload `main.js`, `manifest.json`, and `styles.css` separately, plus the checksum file. Verify the remote tag, asset contents, README image paths, and public prerelease status after upload.

GitHub publication is separate from Obsidian Community directory acceptance. No directory submission is part of this release. Consult the current official submission instructions before any future directory submission.
