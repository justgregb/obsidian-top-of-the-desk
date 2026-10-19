# Demo vault

This is original, fictional sample material for Top of the Desk. It demonstrates all eight source types: notes, folders, Bases, canvases, PDFs, audio, images, and URLs. It also includes a note stack, a Daily note/Scratchpad stack, Recently opened, and Writing activity.

## Create a fresh demo

From the repository root, with Node.js available:

```sh
node scripts/prepare-demo.mjs "/path/to/Top of the Desk Demo"
```

Choose a NEW folder outside your real vault and outside any synced vault. The script refuses an existing destination. It copies `demo/vault`, creates today's daily note, installs the bundled plugin, and writes only demo preferences. It does not need npm dependencies or network access.

Open that folder as a vault in Obsidian. Enable the bundled **Top of the Desk** plugin if asked. Enable Daily notes and Bases; their demo settings are included. Web viewer is needed to open the website reference. Do not copy this demo's `.obsidian` folder into your own vault.

If the Obsidian CLI is enabled, seed the demo history:

```sh
node scripts/seed-demo.mjs "Top of the Desk Demo"
```

The command uses a marker to refuse non-demo vaults. It stores fictional recent-file/folder history, the example Last worked on marker, and synthetic writing totals in this demo vault's local Obsidian storage. It reloads the plugin and adds one synthetic, in-memory website-history entry. Real browser navigation or another reload may replace that entry; rerun the seed command if needed.

Without CLI, the sample files and layout still work. Open a few sample files to populate Recently opened. Writing activity will start empty; it cannot reconstruct historical writing from files.

## Contents

- `vault/`: original Markdown notes, a native Base and canvas, SVG artwork, a one-page PDF, and a 12-second synthesized WAV tone.
- `config/`: the default desk layout, standard Obsidian appearance/core-plugin settings, and relative-date history fixtures.
- The demo PDF and illustration are original, not copied from a website. Audio is synthesized; it is not a person's voice or a recording made on the user's device.
- The website reference uses `https://obsidian.md/`. No remote page is fetched to create screenshots.

## Sync and dates

Obsidian's vault-local history is not portable just by syncing the plugin folder. Run the seed script in the demo on the receiving Mac. The supplied daily note is dated when the demo is generated. For a fresh session on a later day, generate a new destination and seed again.

This demo does not alter the plugin's normal tracking rules. Synthetic activity is presentation data and must not be described as actual writing or evidence of performance.
