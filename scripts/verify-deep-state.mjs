/** Actual frontend modules with inert storage/network stubs. No provider/device calls. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
async function moduleFrom(path,replace=s=>s){const source=replace(await readFile(new URL(path,import.meta.url),'utf8'));const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));}

const {TrainingEvidenceStore,validateTrainingFrame}=await moduleFrom('../src/trainingEvidence.ts');
const frame={source:'CH1',scenario:'sine',time_s:[-.001,0,.001],voltage_v:[-1,0,1],clipped:false,undersampled:false,trigger_possible:true,provenance:'RHODA ideal training model; not captured instrument data',state:{timebase_scale:.0002,acquisition_state:'RUN',channels:{'1':{vertical_scale:.5,offset:0,coupling:'DCLimit',enabled:true}},trigger:{level:0,source:'CH1'}}};
validateTrainingFrame(frame);
for(const corrupt of [null,{}, {...frame,voltage_v:[0]}, {...frame,time_s:[0,0,1]}, {...frame,voltage_v:[0,Infinity,1]}, {...frame,provenance:'physical data'}, {...frame,state:{...frame.state,channels:{'1':{...frame.state.channels['1'],vertical_scale:0}}}}])assert.throws(()=>validateTrainingFrame(corrupt),/invalid/);
let saved=null;const storage={getItem:()=>saved,setItem:(_key,value)=>{saved=value;}};
let store=new TrainingEvidenceStore(()=>storage),readback=new Date().toISOString();
const first=store.capture(frame,readback,'=SUM(1,2)','quoted "observation"',null);frame.voltage_v[0]=99;
assert.equal(store.list()[0].frame.voltage_v[0],-1,'Captures cannot change with live frames');
const copy=store.list();copy[0].frame.voltage_v[1]=99;assert.equal(store.list()[0].frame.voltage_v[1],0);
store=new TrainingEvidenceStore(()=>storage);assert.equal(store.list().length,1);assert.equal(store.list()[0].id,first.id);
const csv=store.csv();assert.match(csv,/time_s,voltage_v/);assert.match(csv,/"'=SUM\(1,2\)"/);assert.match(csv,/quoted ""observation""/);assert.equal(csv.trim().split('\r\n').length,4);assert.match(csv,/"-0.001"/,'Numeric negative samples are not formula-escaped');
for(let i=1;i<8;i++)store.capture(frame,readback,'Capture '+i,'',null);assert.throws(()=>store.capture(frame,readback,'Ninth','',null),/eight/);
store.remove(first.id);assert.equal(store.list().length,7);assert.equal(JSON.parse(store.json()).mode,'training');
const blocked=new TrainingEvidenceStore(()=>{throw Error('Blocked');});blocked.capture(frame,readback,'Memory only','',null);assert.equal(blocked.list().length,1);assert.match(blocked.storageMessage,/memory/);
saved=JSON.stringify({version:1,captures:[{...first,frame:{}}]});store=new TrainingEvidenceStore(()=>storage);assert.equal(store.list().length,0);assert.match(store.storageMessage,/could not be loaded/);
const {bytesToBase64}=await moduleFrom('../src/audioEncoding.ts');const large=Uint8Array.from({length:2_000_000},(_,i)=>i%256);assert.equal(bytesToBase64(large),Buffer.from(large).toString('base64'));assert.equal(bytesToBase64(new Uint8Array()),'');
console.log('PASS validated frozen captures, bounded persistence, CSV units/escaping, invalid storage and large audio encoding.');

const records=new Map();globalThis.localStorage={getItem:k=>records.get(k)??null,setItem:(k,v)=>records.set(k,v),key:i=>[...records.keys()][i],get length(){return records.size;}};
globalThis.window=new EventTarget();globalThis.location={pathname:'/test'};
const originalInterval=globalThis.setInterval;globalThis.setInterval=()=>0;
records.set('rhoda_active_session_v2','bad\nsession');records.set('rhoda_event_v2_bad',JSON.stringify({event_id:'bad',session_id:'session_a',content:'Invalid timestamp',role:'user',timestamp:42}));
const requests=[];globalThis.fetch=async(_url,options)=>{requests.push(JSON.parse(options.body));return new Response(JSON.stringify({ack:true}),{status:200});};
const {sessionLogger}=await moduleFrom('../src/session.ts',source=>source.replace("import { BACKEND } from './runtimeConfig';","const BACKEND='http://inert.invalid';").replace("import {labFetch} from './authRequest';","const labFetch=(...args)=>fetch(...args);").replace("import {getLabAccess,ensureLabAccess,labAccess} from './labAccess';","const getLabAccess=()=>({enabled:false});const ensureLabAccess=async()=>getLabAccess();const labAccess={};"));
assert.match(sessionLogger.getSessionId(),/^session_/);assert.equal(sessionLogger.getAllLogs().length,0,'Malformed saved records do not block the outbox');
const initiating=sessionLogger.getSessionId();sessionLogger.logUserInput('Old question',undefined,initiating);await sessionLogger.flush();sessionLogger.resetSession();const active=sessionLogger.getSessionId();assert.notEqual(active,initiating);
sessionLogger.logAssistantResponse('Delayed reply',undefined,initiating);assert.equal(sessionLogger.getSessionLogs(initiating).length,2);assert.equal(sessionLogger.getSessionLogs(active).some(e=>e.content==='Delayed reply'),false);
const params={scale:.5};sessionLogger.logToolCall('set',params,'WRITE',undefined,true,initiating);params.scale=99;assert.equal(sessionLogger.getSessionLogs(initiating).find(e=>e.tool_call).tool_call.params.scale,.5);
sessionLogger.logAssistantResponse('x'.repeat(21000),undefined,initiating);assert.ok(sessionLogger.getSessionLogs(initiating).at(-1).content.length<=20000);
await sessionLogger.flush();globalThis.fetch=async(_url,options)=>{const entry=JSON.parse(options.body);return entry.content==='Rejected'?new Response('{}',{status:400}):new Response('{"ack":true}',{status:200});};
const rejected=sessionLogger.logSystemEvent('Rejected'),accepted=sessionLogger.logSystemEvent('Accepted');await sessionLogger.flush();await new Promise(r=>setTimeout(r,0));await sessionLogger.flush();
assert.equal(records.get('rhoda_ack_v2_'+accepted.event_id),'1');assert.equal(records.has('rhoda_ack_v2_'+rejected.event_id),false);assert.match(sessionLogger.getSyncStatus().error,/Other records synced/);
globalThis.setInterval=originalInterval;
console.log('PASS session-bound delayed logging, immutable tool records, bounded text, malformed storage and independent outbox recovery.');

globalThis.apiTest={session:'session_one',logs:[],changes:0};
const api=await moduleFrom('../src/instrumentApi.ts',source=>source.replace("import { sessionLogger } from './session';",`const sessionLogger={getSessionId:()=>globalThis.apiTest.session,log:(...a)=>globalThis.apiTest.logs.push(a),logToolCall:(...a)=>globalThis.apiTest.logs.push(a),logSystemEvent:(...a)=>globalThis.apiTest.logs.push(a)};`).replace("import {labFetch} from './authRequest';","const labFetch=(...args)=>fetch(...args);").replace("import { labFetch } from './authRequest';","const labFetch=(...args)=>fetch(...args);").replace("import { announceInstrumentChange } from './instrumentChanges';","const announceInstrumentChange=()=>globalThis.apiTest.changes++;").replace("import { BACKEND } from './runtimeConfig';","const BACKEND='http://inert.invalid';").replace("export { BACKEND } from './runtimeConfig';",''));
let issued=0,cancelFailure=false,delayedCancel=null,failPreview=false;const calls=[];
globalThis.fetch=async(url,options)=>{const body=options.body?JSON.parse(options.body):null;calls.push({url,body,session:options.headers['X-Rhoda-Session']});
 if(url.endsWith('/cancel')){if(delayedCancel)return await new Promise(resolve=>{delayedCancel=()=>resolve(new Response('{"ok":true}'));});if(cancelFailure)throw Error('Offline');return new Response('{"ok":true}');}
 if(url.includes('/state'))return new Response('{"ok":true,"result":{}}');
 if(body?.confirmed===false){issued++;if(failPreview&&issued%2===0)return new Response('{"ok":false,"error":"Second preview failed"}',{status:400});return new Response(JSON.stringify({ok:true,needsConfirmation:true,confirmationId:'token-'+issued,summary:String(body.value)}));}
 return new Response('{"ok":true,"result":{"value":0.5}}');};
const op={path:'channel.1.vertical_scale',value:.5};await api.previewOperations([op]);op.value=2;await api.confirmOperations();assert.equal(calls.find(c=>c.body?.confirmed===true).body.value,.5);assert.equal(globalThis.apiTest.changes,1);
await api.previewOperations([op]);cancelFailure=true;await assert.rejects(api.cancelOperations(),/Cancellation could not be verified/);assert.equal(api.hasPending(),true);cancelFailure=false;globalThis.apiTest.session='session_two';await assert.rejects(api.confirmOperations(),/session changed/);await api.cancelOperations();assert.equal(calls.at(-1).session,'session_one');assert.equal(api.hasPending(),false);
await api.previewOperations([op]);delayedCancel=true;const cancellation=api.cancelOperations();await new Promise(r=>setTimeout(r,0));await assert.rejects(api.previewOperations([op]),/already in progress/);await assert.rejects(api.confirmOperations(),/already in progress/);delayedCancel();await cancellation;delayedCancel=null;
issued=0;failPreview=true;cancelFailure=true;await assert.rejects(api.previewOperations([op,op]),/unapproved preview/);assert.equal(api.hasPending(),true);assert.equal(api.pendingNeedsCancellation(),true);await assert.rejects(api.confirmOperations(),/cancellation cleanup/);cancelFailure=false;failPreview=false;await api.cancelOperations();assert.equal(api.hasPending(),false);
await api.previewOperations([op]);cancelFailure=true;await api.confirmOperations();assert.equal(api.pendingNeedsCancellation(),true,'An already-sent confirmation never becomes approvable again after failed cleanup');await assert.rejects(api.confirmOperations(),/cancellation cleanup/);cancelFailure=false;await api.cancelOperations();
globalThis.fetch=async()=>new Response('<html>Proxy failed</html>',{status:502});await assert.rejects(api.api('/api/health'),/unreadable response \(502\)/);
globalThis.fetch=async()=>new Response('null');await assert.rejects(api.api('/api/health'),/invalid response/);
console.log('PASS exact cloned previews, cancellation failure/retry/serialization, origin-session cleanup, failed-preview rollback retention and proxy response errors.');
