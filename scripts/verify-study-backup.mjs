/** Backup restore and external-reference trust boundaries; no service calls. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
async function moduleFrom(path){const source=await readFile(new URL(path,import.meta.url),'utf8');return import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText).toString('base64'));}
const {StudyProgressStore}=await moduleFrom('../src/studyProgress.ts');
const {safeReferenceUrl}=await moduleFrom('../src/libraryCitation.ts');
const actions={waveform:['scale','compare','explain'],ml:['split','baseline','shift']};
let saved=null;const memory={getItem:()=>saved,setItem:(_key,value)=>{saved=value;}};
const source=new StudyProgressStore(actions,()=>memory);source.update('waveform',{read:true,checks:['scale','compare'],note:'SIMULATION capture-01.png <img src=x onerror=alert(1)>'});
const backup=source.exportBackup();saved=null;
const target=new StudyProgressStore(actions,()=>memory);target.update('ml',{checks:['split'],note:'Held-out session evidence'});
const oldMl=target.get('ml'),before=saved,preview=target.previewBackup(backup);
assert.equal(saved,before,'Review cannot mutate the current progress');assert.equal(preview.guideCount,1);assert.equal(preview.readCount,1);assert.equal(preview.actionCount,2);assert.equal(preview.noteCount,1);
target.restoreBackup(preview);assert.deepEqual(target.get('waveform'),source.get('waveform'));assert.deepEqual(target.get('ml'),oldMl,'Absent guide records remain intact');
assert.deepEqual(new StudyProgressStore(actions,()=>memory).get('waveform'),source.get('waveform'),'The restored file persists through reload');
preview.tracks.waveform.checks.length=0;assert.equal(target.get('waveform').checks.length,2,'Callers cannot mutate a restored record through the preview');
for(const invalid of ['{','null',JSON.stringify({kind:'other',version:1,tracks:{}}),JSON.stringify({kind:'rhoda-study-backup',version:2,selfReported:true,tracks:{}}),' '.repeat(150001)])assert.throws(()=>target.previewBackup(invalid));
const parsed=JSON.parse(backup);for(const change of [{read:'yes'},{checks:['foreign-action']},{note:'x'.repeat(1501)},{updatedAt:'bad-date'}]){const bad=structuredClone(parsed);Object.assign(bad.tracks.waveform,change);const unchanged=saved;assert.throws(()=>target.previewBackup(JSON.stringify(bad)));assert.equal(saved,unchanged,'An invalid backup cannot partially replace guide records');}
const foreign=structuredClone(parsed);foreign.tracks.removed={read:true};assert.equal(target.previewBackup(JSON.stringify(foreign)).guideCount,1);
const inherited=JSON.parse('{"kind":"rhoda-study-backup","version":1,"selfReported":true,"tracks":{"__proto__":{"read":true},"toString":{"read":true}}}');assert.throws(()=>target.previewBackup(JSON.stringify(inherited)));assert.equal({}.read,undefined);
const blocked=new StudyProgressStore(actions,()=>{throw Error('Storage disabled');});blocked.restoreBackup(target.previewBackup(backup));assert.equal(blocked.get('waveform').read,true);assert.match(blocked.storageMessage,/only until this page closes/);
// Different tabs rebase their scoped changes against the latest file.
saved=null;const tabA=new StudyProgressStore(actions,()=>memory),tabB=new StudyProgressStore(actions,()=>memory);
tabA.update('waveform',{read:true,note:'waveform evidence'});tabB.update('ml',{checks:['split'],note:'ML evidence'});
assert.equal(tabA.get('ml').note,'ML evidence');assert.equal(tabB.get('waveform').note,'waveform evidence');
tabA.reset('waveform');tabB.visit('ml');assert.equal(tabB.get('waveform').read,false);assert.equal(tabA.get('ml').note,'ML evidence');
// Failed writes stay in memory while later external records are incorporated.
let denyWrites=true;const flaky={getItem:()=>saved,setItem:(key,value)=>{if(denyWrites)throw Error('Storage full');memory.setItem(key,value);}};
const unsaved=new StudyProgressStore(actions,()=>flaky);unsaved.update('waveform',{note:'not yet persisted'});tabB.update('ml',{read:true});assert.equal(unsaved.get('waveform').note,'not yet persisted');assert.equal(unsaved.get('ml').read,true);
denyWrites=false;unsaved.visit('waveform');assert.equal(new StudyProgressStore(actions,()=>memory).get('waveform').note,'not yet persisted');
assert.equal(safeReferenceUrl('https://www.rohde-schwarz.com/path?q=scope'),'https://www.rohde-schwarz.com/path?q=scope');
for(const url of ['javascript:alert(1)','data:text/html,hello','vbscript:msgbox(1)','https://user:secret@example.com/a','/relative',null,{}])assert.equal(safeReferenceUrl(url),null);
console.log('PASS portable study backup: review-only validation, atomic restore, reload, preserved guides, corrupt/oversized/foreign records, blocked storage and safe external references.');
