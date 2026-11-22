/** Deterministic local-answer regression; no network, AI or instrument access. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const compile = source => 'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText).toString('base64');
const concepts=compile(await readFile(new URL('../src/concepts.ts',import.meta.url),'utf8'));
const paths=compile(await readFile(new URL('../src/readingPaths.ts',import.meta.url),'utf8'));
const source=(await readFile(new URL('../src/offlineAnswer.ts',import.meta.url),'utf8'))
 .replace("'./concepts'",JSON.stringify(concepts)).replace("'./readingPaths'",JSON.stringify(paths))
 .replace("import { BACKEND } from './runtimeConfig';","const BACKEND='http://local-test.invalid';").replace("import {labFetch} from './authRequest';","const labFetch=(...args)=>fetch(...args);");
const {offlineAnswer}=await import(compile(source));
let calls=0;
globalThis.fetch=async()=>{calls++;throw Error('Local backend unavailable');};
for(const [question,expected] of [
 ['Explain the main lab instruments and when I would use each one.',/Oscilloscope.*voltage versus time/s],
 ['intruments',/document collection, not a confirmed equipment inventory/],
 ['Help me plan a measurement. Ask me about my signal and available equipment first.',/Signal and question/],
 ['Help me outline a lab report using only the observations I provide.',/leave observations blank.*Observations/s],
 ['Explain probe compensation',/Official explanation/],
 ['Explain RBW versus VBW',/Resolution bandwidth/],
]){
 const answer=await offlineAnswer(question); assert.match(answer,expected);
}
assert.equal(calls,0,'Authored starters and fundamentals do not depend on the catalogue');
const unavailable=await offlineAnswer('xyz-undocumented topic');
assert.equal(calls,1); assert.match(unavailable,/Local catalogue unavailable/);assert.match(unavailable,/No AI request was made/);assert.match(unavailable,/area=courses/);
globalThis.fetch=async()=>new Response('unavailable',{status:503});
assert.match(await offlineAnswer('xyz-undocumented topic'),/Local catalogue unavailable/);
globalThis.fetch=async()=>new Response(JSON.stringify({unexpected:'shape'}),{headers:{'Content-Type':'application/json'}});
assert.match(await offlineAnswer('xyz-undocumented topic'),/Local catalogue unavailable/);
globalThis.fetch=async()=>new Response(JSON.stringify({results:[]}),{headers:{'Content-Type':'application/json'}});
assert.match(await offlineAnswer('xyz-undocumented topic'),/No matching source found/);
globalThis.fetch=async()=>new Response(JSON.stringify({results:[{id:'source1',title:'Local reference',family:'Example',page:2,excerpt:'A quoted <tag> and [not a link].'},{id:'source1',title:'Duplicate source',family:'Example',page:3,excerpt:'Duplicate'}]}),{headers:{'Content-Type':'application/json'}});
const excerpt=await offlineAnswer('xyz-undocumented topic');assert.match(excerpt,/From your local resources/);assert.match(excerpt,/source1#page=2/);assert.ok(!excerpt.includes('Duplicate source'));assert.ok(!excerpt.includes('<tag>'));assert.match(excerpt,/\\\[not a link\\\]/);
console.log('PASS offline answers: backend-independent starters/fundamentals, unreachable/failed/malformed catalogue recovery, no-match distinction, source de-duplication and escaping.');
