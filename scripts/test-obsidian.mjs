import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const vault = process.argv[2];
if(vault !== 'Top of the Desk Release QA') throw new Error('Use the dedicated Top of the Desk Release QA demo vault.');
const run = args => {
  const r=spawnSync('obsidian',[`vault=${vault}`,...args],{encoding:'utf8',timeout:60000,maxBuffer:5*1024*1024});
  if(r.error || r.status!==0 || /^Error:/m.test(r.stdout)) throw new Error(r.error?.message || r.stderr || r.stdout);
  return r.stdout.trim();
};
const code=await readFile(new URL('../tests/obsidian-integration.js',import.meta.url),'utf8');
const output=run(['eval',`code=${code}`]);
const result=JSON.parse(output.replace(/^=>\s*/,''));
await mkdir('dist/verification',{recursive:true});
await writeFile('dist/verification/obsidian-integration.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
if(result.error) process.exitCode=1;
else {
  run(['plugin:reload','id=top-of-the-desk']);
  const reload=run(['eval',`code=(async()=>{const marker=JSON.parse(await app.vault.adapter.read('.demo/marker.json'));if(marker.id!=='top-of-the-desk-release-demo')throw Error('Not demo');const p=app.plugins.plugins['top-of-the-desk'];const saved=JSON.parse(await app.vault.adapter.read('.demo/expected-reload.json'));if(JSON.stringify(saved)!==JSON.stringify(p.settings))throw Error('Reload changed settings');await p.openDesk();return {reload:true,version:p.manifest.version};})()`]);
  console.log(reload);
  await writeFile('dist/verification/reload.json',reload.replace(/^=>\s*/,'')+'\n');
}
