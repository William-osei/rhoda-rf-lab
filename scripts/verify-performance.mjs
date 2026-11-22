/** Rendering budget boundaries and exact local font extraction; no browser/services. */
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const source=await readFile(new URL('../src/performanceBudget.ts',import.meta.url),'utf8');
const {desktopPixelRatio,frameSummary}=await import('data:text/javascript;base64,'+Buffer.from(compile(source)).toString('base64'));
for(const quality of ['balanced','detail','economy'])for(const width of [390,1440,3840])for(const height of [844,1000,2160])for(const dpr of [1,2,3]){
 const ratio=desktopPixelRatio(width,height,dpr,quality);
 const max=quality==='detail'?8_000_000:quality==='economy'?1_500_000:4_000_000;
 assert.ok(ratio>0&&ratio<=dpr);assert.ok(width*height*ratio*ratio<=max+1);
}
assert.equal(desktopPixelRatio(1440,1000,1,'balanced'),1,'Ordinary desktop resolution stays native');
assert.equal(desktopPixelRatio(1440,1000,3,'balanced'),1.5,'High DPR cannot silently allocate 9x pixels');
assert.equal(desktopPixelRatio(390,844,NaN,'balanced'),1);
assert.deepEqual(frameSummary([]),{samples:0,medianMs:null,p95Ms:null,over33ms:0});
assert.deepEqual(frameSummary([16,16,16,17,50,NaN,0,-1]),{samples:5,medianMs:16,p95Ms:50,over33ms:1});
// Run the actual Vite plugin hooks and compare every emitted glyph/texture byte.
await mkdir(new URL('../.tmp/',import.meta.url),{recursive:true});
const pluginModule=new URL('../.tmp/verify-spatial-font-plugin.mjs',import.meta.url);
await writeFile(pluginModule,compile(await readFile(new URL('./spatial-font-assets.ts',import.meta.url),'utf8')));
const {spatialFontAssets}=await import(pluginModule.href);
const plugin=spatialFontAssets();const config=await plugin.config();assert.match(config.resolve.alias[0].replacement,/rhoda-font-runtime\.js$/);
const files=new Map();plugin.generateBundle.call({emitFile:file=>{files.set(file.fileName,file.source);}});
const {inter}=await import('@pmndrs/msdfonts');
for(const [weight,data] of Object.entries(inter)){
 const name=[...files.keys()].find(name=>name.includes(`inter-${weight}-`)&&name.endsWith('.json'));assert.ok(name);
 const decoded=JSON.parse(files.get(name));const texture=files.get('fonts/'+decoded.pages[0]);
 assert.deepEqual({...decoded,pages:data.pages},data,'Exact glyph metrics and font metadata preserved');
 assert.deepEqual(texture,Buffer.from(data.pages[0].split(',')[1],'base64'),'Exact licensed WebP page preserved');
}
assert.match(files.get('fonts/LICENSE.txt'),/Inter:[\s\S]*The Inter Project Authors/);
const runtime=await readFile(config.resolve.alias[0].replacement,'utf8');assert.ok(runtime.length<1000);assert.ok(!runtime.includes('base64'));
const preservationModule=new URL('../.tmp/verify-preserve-plugin.mjs',import.meta.url);
await writeFile(preservationModule,compile(await readFile(new URL('./preserve-authored-gltf.ts',import.meta.url),'utf8')));
const {preserveAuthoredGLTF}=await import(preservationModule.href);
const preservation=preserveAuthoredGLTF();preservation.configResolved({publicDir:fileURLToPath(new URL('../public/',import.meta.url))});
const fileName='gltf/lab-companion.glb';const bundle={[fileName]:{type:'asset',source:Buffer.from('transformed asset')}};
preservation.generateBundle.handler({},bundle);
const original=await readFile(new URL('../public/'+fileName,import.meta.url));assert.deepEqual(bundle[fileName].source,original);
const fixture=new URL('../.tmp/verify-preserved-output/',import.meta.url);await mkdir(new URL('gltf/',fixture),{recursive:true});
await writeFile(new URL(fileName,fixture),original);preservation.writeBundle.handler({dir:fileURLToPath(fixture)});
await writeFile(new URL(fileName,fixture),Buffer.from('unexpected later transformation'));
assert.throws(()=>preservation.writeBundle.handler({dir:fileURLToPath(fixture)}),/Build changed the authored/);
console.log('PASS 81 viewport/DPR/quality budgets, frame percentiles, exact Inter assets/license, lightweight dictionary and authored companion restoration/fail-closed byte guard.');
