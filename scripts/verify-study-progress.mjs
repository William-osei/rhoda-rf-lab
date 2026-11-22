/** Storage/citation regression: no backend, browser, AI provider or instrument calls. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function moduleFrom(path) {
 const source = await readFile(new URL(path, import.meta.url), 'utf8');
 const code = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
 return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
}
const {StudyProgressStore} = await moduleFrom('../src/studyProgress.ts');
const {documentCitation} = await moduleFrom('../src/libraryCitation.ts');
const actions = {waveform:['scale','compare','explain'],ml:['split','baseline','shift']};
let saved = null;
const memory = {getItem:()=>saved,setItem:(_key,value)=>{saved=value;}};
let store = new StudyProgressStore(actions,()=>memory);
store.visit('waveform');
store.update('waveform',{read:true});
assert.equal(store.get('waveform').read,true);
assert.equal(store.exerciseComplete('waveform'),false,'Opening or reading a guide cannot complete the exercise');
store.update('waveform',{checks:['scale','compare','unknown','scale']});
assert.deepEqual(store.get('waveform').checks,['scale','compare']);
store.update('waveform',{checks:['scale','compare','explain'],note:'simulation/capture-01.png'});
assert.equal(store.exerciseComplete('waveform'),true);
store.update('waveform',{read:false});
assert.equal(store.exerciseComplete('waveform'),true,'Read/exercise flags remain independently recorded');
store = new StudyProgressStore(actions,()=>memory);
assert.equal(store.lastTrack,'waveform');
assert.equal(store.get('waveform').note,'simulation/capture-01.png');
assert.equal(store.exerciseComplete('waveform'),true,'The action evidence survives reload');
const copy=store.get('waveform'); copy.checks.length=0;
assert.equal(store.exerciseComplete('waveform'),true,'Callers cannot mutate persisted checks through returned values');
store.update('ml',{note:'a'.repeat(2000)}); assert.equal(store.get('ml').note.length,1500);
store.visit('toString'); assert.equal(store.lastTrack,'ml'); assert.equal(store.exerciseComplete('toString'),false);
for(const id of ['toString','constructor','__proto__','missing'])assert.deepEqual(store.get(id),{read:false,checks:[],note:'',updatedAt:''},'Unknown and inherited IDs safely return a blank record');
store.reset('waveform'); assert.deepEqual(store.get('waveform').checks,[]); assert.equal(store.get('waveform').read,false);
const mlBefore=store.get('ml'); store.reset('waveform'); assert.deepEqual(store.get('ml'),mlBefore,'Clearing a guide preserves the other guide records');

saved=JSON.stringify({version:1,lastTrack:'removed-guide',tracks:{waveform:{read:'yes',checks:['scale','bad',null,1],note:42,updatedAt:'yesterday'},unknown:{read:true}}});
store=new StudyProgressStore(actions,()=>memory);
assert.equal(store.lastTrack,null); assert.deepEqual(store.get('waveform'),{read:false,checks:['scale'],note:'',updatedAt:''});
for(const raw of ['invalid JSON','null',JSON.stringify({version:1,tracks:[]}),JSON.stringify({version:9,tracks:{}})]) {
 saved=raw; store=new StudyProgressStore(actions,()=>memory); assert.equal(store.get('waveform').read,false); assert.match(store.storageMessage,/could not be loaded/);
}
const blocked=()=>{throw Error('Storage disabled');};
store=new StudyProgressStore(actions,blocked);
store.update('ml',{read:true,checks:['split'],note:'retain during this page session'});
assert.equal(store.get('ml').read,true); assert.equal(store.get('ml').note,'retain during this page session'); assert.match(store.storageMessage,/only until this page closes/);

const official={id:'official-pdf',title:'Oscilloscope fundamentals',pages:48,family:'Oscilloscope',source_kind:'Supplied company resource',source_url:'https://cdn.rohde-schwarz.com/document.pdf',retrieved:'2026-10-03'};
const citation=documentCitation(official,7);
assert.match(citation,/File page 7 of 48/); assert.match(citation,/Source: https:\/\/cdn.rohde-schwarz.com\/document.pdf/); assert.match(citation,/Retrieved: 2026-10-03/);
const local=documentCitation({...official,source_url:undefined,retrieved:undefined},3);
assert.match(local,/Publisher and revision are not recorded/); assert.ok(!local.includes('Source: https'));
console.log('PASS study progress: independent read/exercise evidence, persistence, resume, scoped reset, corrupt/blocked storage, invalid IDs, citation provenance.');
