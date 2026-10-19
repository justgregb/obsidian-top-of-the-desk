import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const vault = process.argv[2];
if (!vault) throw new Error('Usage: node scripts/seed-demo.mjs "Top of the Desk Demo"');
function run(args) {
  const result = spawnSync('obsidian', [`vault=${vault}`,...args], {encoding:'utf8'});
  if(result.error) throw result.error;
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  if(result.status !== 0 || /(?:Error:|This is not the release demo)/.test(result.stdout)) throw new Error('Demo setup failed; stopped.');
}
const here = new URL('.',import.meta.url);
run(['eval',`code=${await readFile(new URL('seed-demo.js',here),'utf8')}`]);
run(['plugin:reload','id=top-of-the-desk']);
run(['command','id=top-of-the-desk:open-desk']);
run(['eval',`code=${await readFile(new URL('seed-demo-web.js',here),'utf8')}`]);
