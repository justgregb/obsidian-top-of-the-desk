import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const vault = 'Top of the Desk Release QA';
const run = args => new Promise((resolve, reject) => {
  const process = spawn('obsidian', [`vault=${vault}`, ...args]);
  let output = '', error = '';
  process.stdout.on('data', chunk => { output += chunk; }); process.stderr.on('data', chunk => { error += chunk; });
  process.on('error', reject);
  process.on('close', code => code || /^Error:/m.test(output) ? reject(new Error(error || output)) : resolve(output.trim()));
});
const server = createServer((_request, response) => {
  response.writeHead(200, {'Content-Type':'text/html'});
  response.end('<!doctype html><title>Web revisit check</title><p>Local demo page.</p>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  await run(['dev:cdp', 'method=Emulation.setFocusEmulationEnabled', 'params={"enabled":true}']);
  const source = await readFile(new URL('../tests/obsidian-web-visits.js', import.meta.url), 'utf8');
  const code = source.replace('LOCAL_TEST_URL', JSON.stringify(`http://127.0.0.1:${server.address().port}/revisit`));
  const report = JSON.parse((await run(['eval', `code=${code}`])).replace(/^=>\s*/, ''));
  console.log(JSON.stringify(report, null, 2));
  if (report.error) process.exitCode = 1;
} finally {
  await run(['dev:cdp', 'method=Emulation.setFocusEmulationEnabled', 'params={"enabled":false}']);
  await new Promise(resolve => server.close(resolve));
}
