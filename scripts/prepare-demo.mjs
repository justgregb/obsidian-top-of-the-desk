import { cp, mkdir, readFile, writeFile, access, rename } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(repo, 'manifest.json'), 'utf8'));
const target = process.argv[2];
if (!target) throw new Error('Choose a NEW empty destination: npm run demo -- "/path/to/Top of the Desk Demo"');
const dest = resolve(target);
try { await access(dest); throw new Error('Destination already exists. Choose a new folder; no existing vault will be overwritten.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const today = new Date(), day = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
await cp(join(repo, 'demo/vault'), dest, { recursive: true });
await rename(join(dest, 'Journal/TODAY.md'), join(dest, `Journal/${day}.md`));
const settings = join(dest, '.obsidian'), plugin = join(settings, 'plugins/top-of-the-desk');
await mkdir(plugin, { recursive: true });
for (const name of ['main.js','manifest.json','styles.css']) await cp(join(repo,name),join(plugin,name));
await cp(join(repo,'demo/config/data.json'),join(plugin,'data.json'));
for (const name of ['appearance.json','app.json','daily-notes.json','core-plugins.json']) await cp(join(repo,'demo/config',name),join(settings,name));
await writeFile(join(settings,'community-plugins.json'), JSON.stringify(['top-of-the-desk'])+'\n');
await mkdir(join(dest,'.demo'));
await writeFile(join(dest,'.demo/marker.json'),JSON.stringify({id:'top-of-the-desk-release-demo',version:manifest.version,createdDay:day})+'\n');
await cp(join(repo,'demo/config/history.json'),join(dest,'.demo/history.json'));
console.log(`Created separate demo vault: ${dest}\nOpen this folder as a vault in Obsidian. Enable Top of the Desk if prompted. Run seed-demo.mjs only against this vault.`);
