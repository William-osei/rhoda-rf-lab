/** Rebuild only the instructor surface for the cloud repo; keep its bearer bridge intact. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cloudBridgePath, createCloudBuildIfMissing } from './instructor-cloud-export-utils.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetArg = process.argv.indexOf('--target');
if (targetArg < 0 || !process.argv[targetArg + 1]) throw Error('Pass --target with the existing Lovable checkout.');
const target = path.resolve(root, process.argv[targetArg + 1]);
if (target === root) throw Error('The cloud target must be separate from the original app root.');
const read = async (base, name) => (await readFile(path.join(base, name), 'utf8')).replace(/\r\n/g, '\n');
const project = JSON.parse(await read(target, 'package.json'));
const instructions = await read(target, 'AGENTS.md');
if (!project.dependencies?.['@tanstack/react-start'] || !instructions.includes('public/rhoda/')) throw Error('Target is not the expected RHODA cloud project.');
const html = await read(target, 'public/rhoda/instructor.html');
const bridge = cloudBridgePath(html);
const bridgeFile = path.join(target, 'public', bridge.replace(/^\//, ''));
const bridgeBefore = await readFile(bridgeFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const prettier = await import(pathToFileURL(path.join(target, 'node_modules/prettier/index.mjs')).href);
const formatting = await prettier.resolveConfig(path.join(target, 'src/lib/rhoda-instructor.ts')) || {};
const format = source => prettier.format(source, { ...formatting, parser: 'typescript' });
const canonical = await read(root, 'src/instructor.ts');
const authoredCanonical = await read(root, 'src/instructorAuthoredReview.ts');
const aiCanonical = await read(root, 'src/instructorAiReview.ts');
const examplesCanonical = await read(root, 'src/instructorReviewExamples.ts');
const imports = [
  "import './labAccessUI';", "import {labFetch} from './authRequest';",
  "import {getLabAccess} from './labAccess';", "import {BACKEND} from './runtimeConfig';",
];
let source = canonical;
source = source.replace(/from\s*(['"])\.\/instructorAuthoredReview\1/g, "from './rhoda-authored-review'");
source = source.replace(/from\s*(['"])\.\/instructorAiReview\1/g, "from './rhoda-ai-review'");
for (const statement of imports) {
  if (!source.includes(statement)) throw Error(`Canonical entry changed: missing ${statement}`);
  source = source.replace(statement, '');
}
source = `// Generated from RHODA src/instructor.ts (SHA-256 ${hash(canonical)}).\n// Update the canonical source and rerun export-instructor-cloud.mjs.\nimport {labFetch,getLabAccess,BACKEND} from './rhoda-instructor-transport';\n${source.trim()}\n`;
const transport = [
  '// Reuse the existing cloud bridge; never bundle the local cookie/CSRF transport.',
  'type Access={enabled:boolean;authenticated:boolean;sessionId:string|null;user:{username:string;role:string}|null;permissions:Record<string,boolean>};',
  'type Bridge={B:string;e:()=>Promise<Access>;g:()=>Access|null;l:typeof fetch};',
  `const bridgePath=${JSON.stringify(bridge)};`,
  'const bridge=await import(/* @vite-ignore */bridgePath) as Bridge;',
  'await bridge.e();',
  'export const BACKEND=bridge.B;',
  'export const getLabAccess=bridge.g;',
  'export const labFetch=bridge.l;',
].join('\n');
await mkdir(path.join(target, 'scripts'), { recursive: true });
await writeFile(path.join(target, 'src/lib/rhoda-instructor.ts'), await format(source));
await writeFile(path.join(target, 'src/lib/rhoda-instructor-transport.ts'), await format(transport));
await writeFile(path.join(target, 'src/lib/rhoda-authored-review.ts'), await format(authoredCanonical));
await writeFile(path.join(target, 'src/lib/rhoda-ai-review.ts'), await format(aiCanonical
  .replace(/from\s*(['"])\.\/instructorAuthoredReview\1/g, "from './rhoda-authored-review'")
  .replace(/from\s*(['"])\.\/instructorReviewExamples\1/g, "from './rhoda-review-examples'")));
await writeFile(path.join(target, 'src/lib/rhoda-review-examples.ts'), await format(examplesCanonical));
const localHtml = await read(root, 'instructor.html');
const style = localHtml.match(/<style>[\s\S]*?<\/style>/)?.[0];
const body = localHtml.match(/<body[\s\S]*?<\/body>/)?.[0]
  .replace('<main>', '<main hidden>')
  .replace(/\s*<script type="module" src="\/src\/instructor\.ts"><\/script>/, '');
if (!style || !body || !body.includes('id="review-session"')) throw Error('Canonical instructor markup is incomplete.');
let nextHtml = html.replace(/<style>[\s\S]*?<\/style>/, style).replace(/<body[\s\S]*?<\/body>/, body);
nextHtml = nextHtml.replace(/await import\(['"]\/rhoda\/assets\/instructor-[\w-]+\.js(?:\?v=[a-f0-9]+)?['"]\)/, "await import('/rhoda/assets/instructor-session-review.js')");
if (!nextHtml.includes("await import('/rhoda/assets/instructor-session-review.js')") || !nextHtml.includes('access.permissions.inspectAllSessions')) throw Error('Cloud instructor gate is missing.');
nextHtml = nextHtml.replace(/instructor-theme\.css\?v=[a-f0-9]+/g, 'instructor-theme.css');
if (!nextHtml.includes('/rhoda/assets/instructor-theme.css')) nextHtml = nextHtml.replace('</head>', '  <link rel="stylesheet" href="/rhoda/assets/instructor-theme.css">\n</head>');
await writeFile(path.join(target, 'public/rhoda/instructor.html'), nextHtml);
await writeFile(path.join(target, 'public/rhoda/assets/instructor-theme.css'), await read(root, 'src/rs-theme.css'));
const buildScript = `// Rebuild the preserved instructor entry from editable TypeScript, not minified output.
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import process from 'node:process';
const binary=process.versions.bun?process.execPath:process.env.RHODA_BUN;
if(!binary)throw Error('Run this build with Bun, or set RHODA_BUN to its executable.');
const result=spawnSync(binary,['build','src/lib/rhoda-instructor.ts','--target','browser','--format','esm','--minify','--external','/rhoda/assets/*','--outfile','public/rhoda/assets/instructor-session-review.js'],{stdio:'inherit'});
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status||1);
const digest=async(file,text=false)=>{const bytes=await readFile(file);return createHash('sha256').update(text?bytes.toString('utf8').replace(/\\r\\n/g,'\\n'):bytes).digest('hex');};
const bundleHash=await digest('public/rhoda/assets/instructor-session-review.js');
const themeHash=await digest('public/rhoda/assets/instructor-theme.css',true);
const version=bundleHash.slice(0,12),themeVersion=themeHash.slice(0,12);
const pageFile='public/rhoda/instructor.html';
let page=await readFile(pageFile,'utf8');
page=page.replace(/await import\\(['"]\\/rhoda\\/assets\\/instructor-[\\w-]+\\.js(?:\\?v=[a-f0-9]+)?['"]\\)/,"await import('/rhoda/assets/instructor-session-review.js?v="+version+"')");
page=page.replace(/instructor-theme\\.css(?:\\?v=[a-f0-9]+)?/g,'instructor-theme.css?v='+themeVersion);
if(!page.includes('instructor-session-review.js?v='+version))throw Error('Missing instructor entry in the protected page.');
await writeFile(pageFile,page);
const manifestFile='public/rhoda/instructor-source.json';
let manifest={};try{manifest=JSON.parse(await readFile(manifestFile,'utf8'));}catch{}
const generatedHash=await digest('src/lib/rhoda-instructor.ts',true);
const transport=await readFile('src/lib/rhoda-instructor-transport.ts','utf8');
const bridge=transport.match(/const bridgePath\\s*=\\s*['"](\\/rhoda\\/assets\\/authRequest-[\\w-]+\\.js)['"]/)?.[1];
if(!bridge)throw Error('Cannot verify the cloud authentication bridge.');
manifest={...manifest,generated_source_sha256:generatedHash,transport_sha256:await digest('src/lib/rhoda-instructor-transport.ts',true),canonical_source_modified:!!manifest.generated_source_at_export_sha256&&manifest.generated_source_at_export_sha256!==generatedHash,entry_url:'/rhoda/assets/instructor-session-review.js?v='+version,bundle_sha256:bundleHash,theme_sha256:themeHash,auth_bridge:bridge,auth_bridge_sha256:await digest('public'+bridge)};
await writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\\n');
`;
// Keep cloud-specific authentication/versioning extensions in an existing build script.
const cloudBuildFile = path.join(target, 'scripts/build-rhoda-instructor.mjs');
await createCloudBuildIfMissing(cloudBuildFile, await prettier.format(buildScript, { ...formatting, parser: 'babel' }));
if (!process.versions.bun) throw Error('Sources exported. Run this command with Bun to generate the browser bundle.');
const result = spawnSync(process.execPath, ['scripts/build-rhoda-instructor.mjs'], { cwd: target, stdio: 'inherit' });
if (result.status !== 0) throw Error('Instructor cloud bundle failed.');
if (hash(await readFile(bridgeFile)) !== hash(bridgeBefore)) throw Error('Cloud authentication bridge changed unexpectedly.');
await writeFile(path.join(target, 'public/rhoda/instructor-source.json'), JSON.stringify({
  canonical_repository: 'William-osei/rohdes-and-schwarze-lab',
  canonical_source: 'src/instructor.ts', canonical_sha256: hash(canonical),
  canonical_authored_review_source: 'src/instructorAuthoredReview.ts',
  canonical_authored_review_sha256: hash(authoredCanonical),
  canonical_ai_review_source: 'src/instructorAiReview.ts',
  canonical_ai_review_sha256: hash(aiCanonical),
  canonical_review_examples_source: 'src/instructorReviewExamples.ts',
  canonical_review_examples_sha256: hash(examplesCanonical),
  generated_review_examples_sha256: hash(await read(target, 'src/lib/rhoda-review-examples.ts')),
  generated_review_examples_at_export_sha256: hash(await read(target, 'src/lib/rhoda-review-examples.ts')),
  generated_ai_review_sha256: hash(await read(target, 'src/lib/rhoda-ai-review.ts')),
  generated_ai_review_at_export_sha256: hash(await read(target, 'src/lib/rhoda-ai-review.ts')),
  generated_authored_review_sha256: hash(await read(target, 'src/lib/rhoda-authored-review.ts')),
  generated_authored_review_at_export_sha256: hash(await read(target, 'src/lib/rhoda-authored-review.ts')),
  generated_source_at_export_sha256: hash(await read(target, 'src/lib/rhoda-instructor.ts')),
  generated_source_sha256: hash(await read(target, 'src/lib/rhoda-instructor.ts')),
  transport_sha256: hash(await read(target, 'src/lib/rhoda-instructor-transport.ts')),
  canonical_source_modified: false,
  theme_sha256: hash(await read(root, 'src/rs-theme.css')), auth_bridge: bridge,
  auth_bridge_sha256: hash(bridgeBefore),
  entry_url: (await read(target, 'public/rhoda/instructor.html')).match(/['"]([^'"]*instructor-session-review\.js\?v=[a-f0-9]+)['"]/)?.[1],
  bundle_sha256: hash(await readFile(path.join(target, 'public/rhoda/assets/instructor-session-review.js'))),
}, null, 2) + '\n');
console.log('Instructor source, markup and theme exported; cloud bearer-auth bridge preserved.');
