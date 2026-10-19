import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
const notices = readFileSync(new URL('./THIRD-PARTY-NOTICES.md', import.meta.url), 'utf8').trim();
await build({
  entryPoints: ['src/main.ts'], bundle: true, external: ['obsidian', '@codemirror/state', '@codemirror/view'],
  format: 'cjs', platform: 'browser', target: 'es2020', outfile: 'main.js',
  minify: true, keepNames: true, legalComments: 'eof',
  banner: { js: `/* Top of the Desk — ${version} */\n/*!\n${notices}\n*/` },
  logLevel: 'info'
});
