import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
const notices = readFileSync(new URL('./THIRD-PARTY-NOTICES.md', import.meta.url), 'utf8').trim();
await build({
  entryPoints: ['src/main.ts'], bundle: true, external: ['obsidian', '@codemirror/state', '@codemirror/view'],
  format: 'cjs', platform: 'browser', target: 'es2020', outfile: 'main.js',
  minify: true, keepNames: true, legalComments: 'eof',
  banner: { js: `/* Top of the Desk — 0.9.50 */\n/*!\n${notices}\n*/` },
  logLevel: 'info'
});
