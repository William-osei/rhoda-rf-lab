import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Export current files, never Git history. No git command, remote, credential or
// visibility setting is used by this preparation step.
const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const temporary = path.resolve(root, '.tmp');
const destination = path.resolve(temporary, 'public-source');
const marker = 'PUBLIC-SOURCE-MANIFEST.json';
const exists = async (file) => access(file, constants.F_OK).then(() => true, () => false);
const within = (parent, child) => child === parent || (!path.relative(parent, child).startsWith('..') && !path.isAbsolute(path.relative(parent, child)));

await mkdir(temporary, { recursive: true });
if (!within(root, await realpath(temporary)) || (await lstat(temporary)).isSymbolicLink())
  throw new Error('The temporary export directory must remain inside this checkout.');
if (await exists(destination)) {
  if ((await lstat(destination)).isSymbolicLink() || !within(temporary, await realpath(destination)))
    throw new Error('Refusing to replace an export through a link or outside the temporary workspace.');
  if (await exists(path.join(destination, '.git')))
    throw new Error('The export already has Git history. Review and update that repository deliberately; this script will not replace it.');
  if (!await exists(path.join(destination, marker)))
    throw new Error('Refusing to replace a directory that was not created by this exporter.');
  // Absolute destination was resolved, checked inside .tmp and ownership-marked.
  await rm(destination, { recursive: true });
}
await mkdir(destination);

const sourceRoots = new Set(['src', 'server', 'API-control', 'desktop', 'scripts', 'ui', 'modules']);
const rootFiles = new Set(['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts',
  '.gitignore', '.gitattributes', '.env.example', 'start.sh', 'PUBLIC-RELEASE.md', 'CONTRIBUTING.md', 'INSTRUMENT-TOURS.md']);
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.py', '.cs', '.css', '.html', '.uikitml', '.json', '.txt', '.ps1', '.cmd', '.sh']);
const publicExtensions = new Set(['.html', '.css', '.js', '.mjs', '.json', '.txt', '.md', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.ogg', '.wav', '.mp3', '.mp4', '.ktx2']);
const allowedModelFiles = new Set(['public/gltf/lab-companion.glb', 'public/gltf/research-companion.glb',
  'public/gltf/companion-motions.glb', 'public/gltf/companion-walk.glb']);
const skippedDirectoryNames = new Set(['.git', 'node_modules', '.venv', 'venv', 'env', '__pycache__',
  '.pytest_cache', '.tmp', '.temp', '.vite', '.vscode', '.idea', 'dist', 'bin', 'obj', 'artifacts',
  'coverage', 'data', 'docs', 'reports', 'RS_virtual_lab_assistant', 'khaya-xr-app']);
const excluded = new Map();
const included = [];
const noteExclusion = (reason) => excluded.set(reason, (excluded.get(reason) ?? 0) + 1);

function accepted(relative) {
  const name = path.posix.basename(relative);
  const extension = path.posix.extname(relative).toLowerCase();
  const parts = relative.split('/');
  if (name === '.env.example') return relative === '.env.example';
  if (name.startsWith('.env') || /(?:^|[-_.])(?:credentials|secrets?|service-account)(?:[-_.]|$)/i.test(name)
      || /\.(?:pem|key|p12|pfx|sqlite|sqlite3|db|log|pyc|pyo|zip|pdf|docx|pptx)$/i.test(name)) return false;
  if (relative.startsWith('public/gltf/motion/') || relative.startsWith('public/webp/')
      || relative.startsWith('public/gltf/webp/') || /rhode_schwarz-character/i.test(relative)) return false;
  if (parts.length === 1) return rootFiles.has(name) || extension === '.html';
  if (parts[0] === 'public') {
    if (relative.startsWith('public/ui/')) return false; // Generated from ui/ by the build.
    if (extension === '.glb') return allowedModelFiles.has(relative);
    return publicExtensions.has(extension);
  }
  if (!sourceRoots.has(parts[0])) return false;
  // These short Markdown files are the authored built-in teaching corpus, not
  // the separately supplied document collection or historical private docs/.
  if (relative.startsWith('server/rag/corpus/') && extension === '.md') return true;
  if (parts[0] === 'modules' && parts[1] !== 'vna-lab') return false;
  if (parts[0] === 'modules' && extension === '.md') return ['README.md', 'REFERENCES.md'].includes(name);
  if (parts[0] === 'modules' && extension === '.png') return relative === 'modules/vna-lab/src/assets/rs-lab-icon.png';
  if (parts[0] === 'desktop' && ['.ico', '.png'].includes(extension)) return true;
  return sourceExtensions.has(extension);
}

async function walk(directory, prefix = '') {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const source = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) { noteExclusion('links'); continue; }
    if (entry.isDirectory()) {
      if (skippedDirectoryNames.has(entry.name) || entry.name.startsWith('.')) { noteExclusion('private-runtime-generated-or-duplicate-directories'); continue; }
      if (!prefix && !sourceRoots.has(entry.name) && entry.name !== 'public') { noteExclusion('unlisted-root-directories'); continue; }
      if (relative === 'public/gltf/motion' || relative === 'public/webp' || relative === 'public/gltf/webp') { noteExclusion('restricted-animation-and-preview-directories'); continue; }
      await walk(source, relative);
      continue;
    }
    if (!entry.isFile() || !accepted(relative)) { noteExclusion('unlisted-private-or-restricted-files'); continue; }
    const target = path.join(destination, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    if (relative === 'index.html') {
      const original = await readFile(source, 'utf8');
      const patched = original.replace(/<body\b([^>]*)>/i, (_match, attributes) =>
        `<body${attributes.replace(/\sdata-original-avatar=(['"])[\s\S]*?\1/i, '')} data-original-avatar="unavailable">`);
      if (patched === original) throw new Error('Expected a body element in the spatial-studio entry page.');
      await writeFile(target, patched);
    } else if (relative === 'src/animation-manifest.json') {
      await writeFile(target, JSON.stringify({ idle: [], dance: [], expression: [], locomotion: [] }, null, 2) + '\n');
    } else if (relative === 'public/gltf/companion-credits.html') {
      const original = await readFile(source, 'utf8');
      await writeFile(target, original.replace(/<p>The original Rhoda avatar remains available;[\s\S]*?<\/p>/,
        '<p>This public source snapshot includes the credited MIT research companion and CC0 fallback only. The original Ready Player Me avatar and its separate animation library are not redistributed.</p>'));
    } else {
      await copyFile(source, target);
    }
    included.push(relative);
  }
}
await walk(root);

const publicReadme = `# RHODA RF learning lab

An educational lab companion with an oscilloscope practice bench, a shared **Instrument tours** workspace for the oscilloscope and ZNLE6 VNA, guided lessons, resources and an optional local Python service. Responses are simulated; this project does not certify hardware performance or student proficiency.

## Contributor setup

Use Node.js 24 and a supported Python 3 installation. From this folder:

\x60\x60\x60powershell
npm ci
npm --prefix modules/vna-lab ci
npm run typecheck
npm run build
npm run dev
\x60\x60\x60

Open the URL shown by Vite, then **desktop.html** for the workspace home or **instruments.html** for both instrument tours. The VNA module is bundled independently to preserve its pinned Three.js version. Its model, built-in lessons and bench run without a cloud account or API key. The oscilloscope uses the mock local service for generated waveform data.

For that service, in another terminal:

\x60\x60\x60powershell
python -m venv .venv
.venv\\Scripts\\python.exe -m pip install -r server/requirements-mock.txt
$env:SCOPE_RESOURCE=\"\"
$env:SCOPE_SIMULATE=\"1\"
$env:RHODA_AI_ENABLED=\"0\"
$env:RHODA_RAG_ENABLED=\"0\"
.venv\\Scripts\\python.exe server/app.py
\x60\x60\x60

Use a disposable development session. Real instrument connections and paid AI services are outside this setup. External manuals require internet; the local document collection and learner records are deliberately not included. Configure optional services only after reading the source and their provider requirements. Never commit real keys, account files, student records, local documents or recordings.

## Source and asset provenance

This is a fresh source snapshot, without the private repository's Git history, personal resource collection or runtime data. The old Ready Player Me avatar, its animation library and preview images are excluded. The permitted MIT Rocketbox male and credited CC0 fallback remain; see **public/gltf/companion-credits.html**, **rocketbox-LICENSE.txt** and the credit JSON files. Do not re-add excluded assets without the necessary redistribution permission.

The VNA teaching geometry and explanations are original, photo-referenced educational work. Manufacturer marks identify the referenced lab/instruments and do not indicate endorsement. Source references and dependency notices remain under **modules/vna-lab/**.

No blanket licence for all project code or artwork is asserted by making this repository public. Each third-party component retains its own terms. The project owner can invite collaborators through the repository's Settings → Collaborators page; sending a repository URL alone does not grant write access. Forks and pull requests are another review workflow.

Read **PUBLIC-RELEASE.md** and **PUBLIC-SOURCE-MANIFEST.json** for the export scope and remaining verification boundaries.
`;
await writeFile(path.join(destination, 'README.md'), publicReadme.replaceAll('\x60', '`'));
included.push('README.md');
const records = [];
for (const relative of included.sort()) {
  const bytes = await readFile(path.join(destination, ...relative.split('/')));
  records.push({ path: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(path.join(destination, marker), JSON.stringify({
  schema: 1,
  kind: 'rhoda-public-source-preparation',
  historyIncluded: false,
  excludedAssetPolicy: ['Ready Player Me avatar', 'Ready Player Me animation library and previews', 'unlisted GLB assets'],
  exclusionsByReason: Object.fromEntries([...excluded].sort(([a], [b]) => a.localeCompare(b))),
  files: records,
}, null, 2) + '\n');
console.log(JSON.stringify({ output: '.tmp/public-source', files: records.length + 1,
  bytes: records.reduce((sum, record) => sum + record.bytes, 0), historyIncluded: false,
  published: false, excluded: Object.fromEntries(excluded) }, null, 2));
