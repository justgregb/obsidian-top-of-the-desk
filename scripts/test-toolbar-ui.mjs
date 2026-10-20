import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const vault = process.argv[2];
if (vault !== 'Top of the Desk Release QA') throw new Error('Use the isolated release QA vault.');
const run = args => {
  const result = spawnSync('obsidian', [`vault=${vault}`, ...args], {encoding:'utf8',timeout:30000});
  if (result.error || result.status!==0 || /^Error:/m.test(result.stdout)) throw new Error(result.error?.message || result.stderr || result.stdout);
  return result.stdout.trim();
};
run(['dev:cdp','method=Emulation.setFocusEmulationEnabled','params={"enabled":true}']);
try {
  const code = await readFile(new URL('../tests/obsidian-toolbar.js',import.meta.url),'utf8');
  const report = JSON.parse(run(['eval',`code=${code}`]).replace(/^=>\s*/,''));
  await mkdir('dist/verification',{recursive:true});
  await writeFile('dist/verification/toolbar-ui.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2)); if(report.error)process.exitCode=1;
} finally { run(['dev:cdp','method=Emulation.setFocusEmulationEnabled','params={"enabled":false}']); }
