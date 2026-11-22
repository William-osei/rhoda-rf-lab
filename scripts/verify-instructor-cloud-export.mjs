/** Export compatibility and build-file preservation; controlled temporary files, no services. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cloudBridgePath, createCloudBuildIfMissing } from './instructor-cloud-export-utils.mjs';

const bridge = '/rhoda/assets/authRequest-BIHGywTT.js';
for (const suffix of ['', '?v=8f91e61f7ebf']) {
  const html = `<link rel="modulepreload" href="${bridge}${suffix}"><script type="module">await import('${bridge}${suffix}')</script>`;
  assert.equal(cloudBridgePath(html), bridge);
  assert.equal(path.posix.join('public', cloudBridgePath(html)), 'public' + bridge,
    'The content-version query must never become part of the asset filename');
}
for (const html of [
  '<script src="/rhoda/assets/other.js"></script>',
  `<script src="https://foreign.invalid${bridge}?v=123abc"></script>`,
  `<script src="${bridge}?v=not-a-content-hash"></script>`,
  `<script src="/rhoda/assets/../authRequest-BIHGywTT.js?v=123abc"></script>`,
  `<script src="${bridge}"></script><script src="/rhoda/assets/authRequest-other.js?v=123abc"></script>`,
]) assert.throws(() => cloudBridgePath(html), /one existing cloud authentication bridge/);

const fixture = await mkdtemp(path.join(tmpdir(), 'rhoda-export-test-'));
const directory = path.join(fixture, 'scripts');
const file = path.join(directory, 'build-rhoda-instructor.mjs');
await mkdir(directory);
try {
  // Two exporters racing to bootstrap must never overwrite one another's build file.
  const created = await Promise.all([
    createCloudBuildIfMissing(file, '// bootstrap A\n'),
    createCloudBuildIfMissing(file, '// bootstrap B\n'),
  ]);
  assert.equal(created.filter(Boolean).length, 1);
  assert.match(await readFile(file, 'utf8'), /^\/\/ bootstrap [AB]\n$/);
  const extended = "import { versionAccessFile } from './version-access-imports.mjs';\n// Cloud-specific auth and asset-version extensions\n";
  await writeFile(file, extended);
  assert.equal(await createCloudBuildIfMissing(file, '// obsolete template\n'), false);
  assert.equal(await readFile(file, 'utf8'), extended,
    'A later source export must preserve the existing extended Cloud build byte for byte');
  await assert.rejects(createCloudBuildIfMissing(path.join(fixture, 'absent', 'build.mjs'), '// test\n'),
    error => error.code === 'ENOENT', 'Unrelated filesystem errors must not be swallowed');
} finally {
  // Remove only the one fixture file and empty directories just created, never recursively.
  await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rmdir(directory);
  await rmdir(fixture);
}
console.log('PASS instructor Cloud export: versioned/unversioned bridge paths, ambiguous/foreign rejection, atomic bootstrap and existing build preservation.');
