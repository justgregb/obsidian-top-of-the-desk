import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
const repo = resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifest = JSON.parse(await readFile(join(repo,'manifest.json'),'utf8'));
const pkg = JSON.parse(await readFile(join(repo,'package.json'),'utf8'));
const lock = JSON.parse(await readFile(join(repo,'package-lock.json'),'utf8'));
const versions = JSON.parse(await readFile(join(repo,'versions.json'),'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || pkg.version !== manifest.version || lock.version !== manifest.version || lock.packages[''].version !== manifest.version) throw new Error('Version fields do not match.');
if (versions[manifest.version] !== manifest.minAppVersion) throw new Error('versions.json must map this version to the manifest minimum Obsidian version.');
const main = await readFile(join(repo,'main.js'));
if (!main.toString('utf8').startsWith(`/* Top of the Desk — ${manifest.version} */`)) throw new Error('Bundle version does not match. Run npm run bundle.');
if(manifest.description.length > 250 || !manifest.description.endsWith('.')) throw new Error('Description must be at most 250 characters and end with a period.');
const dest = join(repo,'dist',manifest.version); await mkdir(dest,{recursive:true});
const checksums=[];
for(const name of ['main.js','manifest.json','styles.css']) {
  const bytes=await readFile(join(repo,name)); await copyFile(join(repo,name),join(dest,name));
  checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
}
await writeFile(join(dest,'SHA256SUMS.txt'),checksums.join('\n')+'\n');
console.log(`Release assets: ${dest}\nTag must be exactly ${manifest.version}, without a v prefix. This command does not publish anything.`);
