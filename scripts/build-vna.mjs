import { access, copyFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleRoot = path.join(root, 'modules', 'vna-lab');
const tsc = path.join(moduleRoot, 'node_modules', 'typescript', 'bin', 'tsc');
try { await access(tsc); }
catch { throw new Error('VNA build dependencies are missing. Run: npm --prefix modules/vna-lab ci'); }
for (const args of [[tsc, '--noEmit'], [path.join(moduleRoot, 'scripts', 'build-offline.mjs')], [path.join(moduleRoot, 'scripts', 'verify-offline.mjs')]]) {
  await mkdir(path.join(moduleRoot, 'dist'), { recursive: true });
  const result = spawnSync(process.execPath, args, { cwd: moduleRoot, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('The isolated VNA build failed; the RHODA build was stopped.');
}
const destination = path.join(root, 'public', 'learning', 'vna');
await mkdir(destination, { recursive: true });
await copyFile(path.join(moduleRoot, 'dist', 'VNA-Lab-Offline.html'), path.join(destination, 'index.html'));
await copyFile(path.join(moduleRoot, 'THIRD-PARTY-NOTICES.txt'), path.join(destination, 'THIRD-PARTY-NOTICES.txt'));
console.log('Built isolated ZNLE6 lab → public/learning/vna/index.html');
