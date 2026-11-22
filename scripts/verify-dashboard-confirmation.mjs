/** Exercise the real spatial dashboard handlers with inert UIKit/backend stubs.
 * No camera, AI provider, browser speech or instrument requests are made.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source=await readFile(new URL('../src/dashboard.ts',import.meta.url),'utf8');
const stubs=`
const PanelUI={},PanelDocument={data:{document:[]}},eq=()=>null;
const createSystem=()=>class {world={};queries={dashboard:{subscribe(){}}};};
const avatarLabel=()=> 'Rhoda',robotGreetingLabel=()=> 'Greeting',avatarMotionEnabled=()=>true;
const cycleAvatar=()=>{},activateRobotGreeting=()=>{},setRobotMotion=()=>{};
const lessonSnapshot=()=>({title:'Scope lesson',count:'1/7',text:'Learning step'});
const stepLesson=()=>{},nextLesson=()=>{},readLessonAloud=()=>{},stopLessonSpeech=()=>{},pauseLessonSpeech=()=>{},resumeLessonSpeech=()=>{};
const getPendingConfirmation=()=>globalThis.testBackend.pending?{pending:true}:null;
const confirmPending=()=>globalThis.testBackend.confirm();
const denyPending=()=>globalThis.testBackend.deny();
const captureFrame=()=>{throw Error('Camera flow must not run');};
const identifyComponent=()=>{throw Error('AI identification flow must not run');};
const geminiTTS=()=>{throw Error('AI speech flow must not run');};
`;
const replaced=stubs+source.replace(/^import[\s\S]*?from\s*["'][^"']+["'];\r?\n/gm,'');
const code=ts.transpileModule(replaced,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {DashboardSystem}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const nodes=new Map();
function element(id){if(!nodes.has(id))nodes.set(id,{properties:{},handlers:{},setProperties(value){Object.assign(this.properties,value);},addEventListener(type,handler){this.handlers[type]=handler;}});return nodes.get(id);}
const doc={getElementById:element};
globalThis.document={getElementById:()=>null};
globalThis.window={dispatchEvent(){}};
let clock=1000;
const originalPerformance=globalThis.performance;
Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>clock}});
let actualLabel='Listening…', actualState='LISTENING';
const rhoda={getStatusLabel:()=>actualLabel,getState:()=>actualState,isMuted:()=>false,isAutoFollowEnabled:()=>false,
 setState(){throw Error('Dashboard outcomes must not overwrite assistant state');},setStatusLabel(){throw Error('Dashboard outcomes must not overwrite assistant status');}};
const system=new DashboardSystem();system.document=doc;system.world.rhodeSchwarz=rhoda;system.wire(doc);
const text=()=>element('status-mode').properties.text;
const click=id=>element(id).handlers.click();
let confirms=0,denials=0,resolve;
globalThis.testBackend={pending:true,
 confirm(){confirms++;return new Promise(r=>{resolve=result=>{globalThis.testBackend.pending=false;r(result);};});},
 deny(){denials++;return Promise.resolve({status:'ok'});}};

try{
 system.update(0,0);assert.equal(text(),'Listening…');assert.equal(element('btn-allow').properties.pointerEvents,'auto');
 const first=click('btn-allow');click('btn-allow');click('btn-deny');
 assert.equal(confirms,1);assert.equal(denials,0,'Duplicate and opposing taps cannot issue a second request');
 assert.equal(element('btn-allow').properties.pointerEvents,'none');assert.equal(element('btn-deny').properties.pointerEvents,'none');
 clock+=10000;system.update(0,0);assert.equal(text(),'Applying approved operation…','Long requests retain their processing feedback');
 resolve({status:'ok'});await first;assert.equal(text(),'Confirmed');
 actualLabel='Speaking about the waveform';actualState='SPEAKING';
 clock+=2999;system.update(0,0);assert.equal(text(),'Confirmed','A frame refresh cannot immediately erase the outcome');
 clock+=2;system.update(0,0);assert.equal(text(),'Speaking about the waveform','Expiry returns to the current assistant state, never a forced Ready');
 assert.equal(element('btn-allow').properties.class,'btn-hidden');

 globalThis.testBackend.pending=true;
 globalThis.testBackend.deny=async()=>{denials++;return {status:'error',error:'An instrument operation is already in progress'};};
 await click('btn-deny');assert.match(text(),/^Cancellation failed: An instrument operation/);assert.notEqual(text(),'Cancelled');
 assert.equal(element('btn-deny').properties.pointerEvents,'auto','A retained pending operation can be retried');
 clock+=5999;system.update(0,0);assert.match(text(),/^Cancellation failed:/);
 globalThis.testBackend.deny=async()=>{denials++;globalThis.testBackend.pending=false;return {status:'ok'};};
 await click('btn-deny');assert.equal(text(),'Cancelled');clock+=3001;system.update(0,0);assert.equal(text(),'Speaking about the waveform');

 globalThis.testBackend.pending=true;
 globalThis.testBackend.confirm=async()=>{throw Error('Test connection failed');};
 await click('btn-allow');assert.equal(text(),'Approval failed: Test connection failed');assert.equal(system.confirmationBusy,false,'Thrown requests release the busy guard');
 globalThis.testBackend.pending=false;system.update(0,0);assert.equal(element('btn-allow').properties.pointerEvents,'none','External cancellation also hides approval controls');
 clock+=6001;delete system.world.rhodeSchwarz;system.update(0,0);assert.equal(text(),'Offline');
 console.log('PASS spatial dashboard: cancellation errors, duplicate/opposing taps, processing feedback, retained success/error outcomes, current-state restoration, retry, thrown-error recovery and externally cleared confirmations.');
}finally{Object.defineProperty(globalThis,'performance',{configurable:true,value:originalPerformance});}
