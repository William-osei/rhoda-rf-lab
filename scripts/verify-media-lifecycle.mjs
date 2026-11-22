/** Real lifecycle code with inert browser/provider fakes. No device or network. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const timers=new Map(),intervals=new Map();let nextTimer=1;
const fakeWindow=new EventTarget();
Object.assign(fakeWindow,{
 setTimeout(callback){const id=nextTimer++;timers.set(id,callback);return id;},clearTimeout(id){timers.delete(id);},
 setInterval(callback){const id=nextTimer++;intervals.set(id,callback);return id;},clearInterval(id){intervals.delete(id);},
});
globalThis.window=fakeWindow;
globalThis.requestAnimationFrame=callback=>{queueMicrotask(()=>callback(0));return 1;};
globalThis.cancelAnimationFrame=()=>{};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function stream(){const track={readyState:'live',stopCount:0,stop(){this.readyState='ended';this.stopCount++;}};return {track,getTracks:()=>[track]};}
let cameraRequests=0,microphoneRequests=0,permission=async()=>stream();
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia(options){if(options.audio)microphoneRequests++;else cameraRequests++;return permission(options);}}}});

let recorderFailure='',supported=true;const recorders=[],contexts=[];
class FakeRecorder{
 static isTypeSupported(){return supported;}
 constructor(input,options){if(recorderFailure==='constructor')throw Error('constructor failed');this.input=input;this.options=options;this.mimeType=options.mimeType||'audio/browser-default';this.state='inactive';this.stops=0;recorders.push(this);}
 start(){if(recorderFailure==='start')throw Error('start failed');this.state='recording';}
 stop(){this.stops++;if(recorderFailure==='stop')throw Error('stop failed');this.state='inactive';if(recorderFailure==='hang')return;queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['final'],{type:this.mimeType})});this.onstop?.();});}
}
globalThis.MediaRecorder=FakeRecorder;
class FakeContext{
 constructor(){this.state='suspended';this.closed=0;contexts.push(this);}
 resume(){return Promise.reject(Error('optional visualization suspended'));}
 createAnalyser(){return {fftSize:256,frequencyBinCount:128,getByteTimeDomainData:array=>array.fill(128),disconnect(){}};}
 createMediaStreamSource(){return {connect(){},disconnect(){}};}
 close(){this.closed++;return Promise.resolve();}
}
fakeWindow.AudioContext=FakeContext;
async function loadSource(relative,transform=source=>source){const source=transform(await readFile(new URL(relative,import.meta.url),'utf8'));const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));}
const {AudioRecorder}=await loadSource('../src/audioRecorder.ts');

// Permission races: duplicated start, cancelled start and late old permission.
{
 const permissionResult=deferred(),input=stream();permission=()=>permissionResult.promise;
 const recorder=new AudioRecorder(),before=microphoneRequests;
 const first=recorder.start(),again=recorder.start();assert.equal(first,again);assert.equal(microphoneRequests,before+1);
 const rejected=assert.rejects(first,error=>error.name==='AbortError');
 await assert.rejects(recorder.stop(),error=>error.name==='AbortError');permissionResult.resolve(input);await rejected;
 assert.equal(input.track.readyState,'ended');assert.equal(recorder.isRecording(),false);
 const late=deferred(),oldInput=stream(),newInput=stream();permission=()=>late.promise;
 const old=recorder.start();const oldRejected=assert.rejects(old,error=>error.name==='AbortError');recorder.release();
 permission=async()=>newInput;await recorder.start();late.resolve(oldInput);await oldRejected;
 assert.equal(oldInput.track.readyState,'ended');assert.equal(newInput.track.readyState,'live');assert.equal(recorder.isRecording(),true);recorder.release();
}

// Real final chunks, idempotent stop, released indicators and retry after failures.
{
 const input=stream();permission=async()=>input;const recorder=new AudioRecorder();await recorder.start();
 const actual=recorders.at(-1);actual.ondataavailable({data:new Blob(['hello'])});await recorder.start();
 const one=recorder.stop(),two=recorder.stop();assert.equal(one,two);const blob=await one;
 assert.equal(await blob.text(),'hellofinal');assert.equal(actual.stops,1);assert.equal(input.track.readyState,'ended');assert.equal(contexts.at(-1).closed,1);assert.equal(recorder.getAudioLevel(),0);
 for(const stage of ['constructor','start']){
  recorderFailure=stage;const failedInput=stream();permission=async()=>failedInput;await assert.rejects(recorder.start(),/failed/);assert.equal(failedInput.track.readyState,'ended');
 }
 recorderFailure='';supported=false;const defaultInput=stream();permission=async()=>defaultInput;await recorder.start();assert.equal('mimeType' in recorders.at(-1).options,false);supported=true;await recorder.stop();
 const errorInput=stream();permission=async()=>errorInput;await recorder.start();recorders.at(-1).onerror({error:Error('device disconnected')});await assert.rejects(recorder.stop(),/disconnected/);assert.equal(errorInput.track.readyState,'ended');
 const hiddenInput=stream();permission=async()=>hiddenInput;await recorder.start();fakeWindow.dispatchEvent(new Event('pagehide'));assert.equal(hiddenInput.track.readyState,'ended');assert.equal(recorder.isRecording(),false);
 recorderFailure='hang';const hangingInput=stream();permission=async()=>hangingInput;await recorder.start();const finishing=recorder.stop();const failed=assert.rejects(finishing,/did not finish/);for(const callback of [...timers.values()])callback();await failed;assert.equal(hangingInput.track.readyState,'ended');recorderFailure='';
}
console.log('PASS microphone: concurrent and cancelled permission, late results, final chunks, duplicate stop, failed construction/start, recorder errors, default format, pagehide, bounded stop and track/context cleanup.');

let videoFailure='',videoPlay=async()=>{},provider,connections=[];const videos=[];
globalThis.testProvider=()=>provider;
globalThis.document={createElement(type){
 if(type==='video'){const video={srcObject:null,muted:false,readyState:3,videoWidth:640,videoHeight:480,setAttribute(){},play(){if(videoFailure==='play')return Promise.reject(Error('play failed'));return videoPlay();},pause(){this.paused=true;}};videos.push(video);return video;}
 if(type==='canvas')return {width:0,height:0,getContext(){if(videoFailure==='context')return null;return {drawImage(){if(videoFailure==='draw')throw Error('draw failed');}};},toDataURL(){if(videoFailure==='encode')throw Error('encode failed');return 'data:image/jpeg;base64,AAAA';}};
 throw Error('Unexpected element '+type);
}};
function liveProvider(connectOverride){return {live:{async connect(options){
 const session={options,closed:0,sent:0,close(){this.closed++;options.callbacks.onclose({});},sendRealtimeInput(){this.sent++;}};
 connections.push(session);return connectOverride?connectOverride(session):session;
}}};}
const vision=await loadSource('../src/vision.ts',source=>source
 .replace(/^import[^\n]*sessionLogger[^\n]*\n/m,'const sessionLogger={logToolCall(){},logAssistantResponse(){},logSystemEvent(){}};\n')
 .replace(/import\.meta\.env\.VITE_GEMINI_API_KEY/g,"''")
 .replace(/async function getGemini\(\) \{[\s\S]*?\n\}/,"async function getGemini(){return globalThis.testProvider();}")
 .replace(/import\('@google\/genai'\)/g,"Promise.resolve({Modality:{TEXT:'text'}})"));

// Pending starts have one camera owner and cannot revive after cancellation.
{
 const deniedProvider=()=>{throw Error('not configured');};globalThis.testProvider=deniedProvider;const before=cameraRequests;
 await vision.startLiveStream(()=>{});assert.equal(cameraRequests,before);assert.equal(vision.isLiveStreamActive(),false);
 globalThis.testProvider=()=>provider;
 const permissionResult=deferred(),input=stream();permission=()=>permissionResult.promise;provider=liveProvider();
 const beforePermission=cameraRequests;const first=vision.startLiveStream(()=>{});assert.equal(first,vision.startLiveStream(()=>{}));await flush();assert.equal(cameraRequests,beforePermission+1);
 vision.stopLiveStream();permissionResult.resolve(input);await first;assert.equal(input.track.readyState,'ended');assert.equal(vision.isLiveStreamActive(),false);
 const oldConnection=deferred(),oldInput=stream();permission=async()=>oldInput;provider=liveProvider(()=>oldConnection.promise);
 const oldStart=vision.startLiveStream(()=>{});await flush();const old=connections.at(-1);vision.stopLiveStream();
 const newInput=stream();permission=async()=>newInput;provider=liveProvider();const messages=[];await vision.startLiveStream(text=>messages.push(text));const current=connections.at(-1);
 oldConnection.resolve(old);await oldStart;old.options.callbacks.onclose({});old.options.callbacks.onerror({});old.options.callbacks.onmessage({serverContent:{outputTranscription:{text:'stale'}}});
 assert.equal(old.closed,1);assert.equal(newInput.track.readyState,'live');assert.equal(current.closed,0);assert.deepEqual(messages,[]);
 current.options.callbacks.onerror({message:'failure'});assert.equal(newInput.track.readyState,'ended');assert.equal(vision.isLiveStreamActive(),false);assert.match(messages.at(-1),/stopped.*retry/);assert.equal(intervals.size,0);
}

// Frame send and setup failures stop the camera; one-shot finally always runs.
{
 for(const stage of ['play','context']){
  videoFailure=stage;const input=stream();permission=async()=>input;provider=liveProvider();await vision.startLiveStream(()=>{});assert.equal(input.track.readyState,'ended');assert.equal(vision.isLiveStreamActive(),false);
 }
 videoFailure='';const frameInput=stream();permission=async()=>frameInput;provider=liveProvider();const messages=[];await vision.startLiveStream(text=>messages.push(text));
 connections.at(-1).sendRealtimeInput=()=>Promise.reject(Error('transport unavailable'));
 for(const callback of [...intervals.values()])callback();await flush();assert.equal(frameInput.track.readyState,'ended');assert.equal(intervals.size,0);assert.match(messages.at(-1),/delivery failed/);
 for(const stage of ['play','context','draw','encode','']){
  videoFailure=stage;const input=stream();permission=async()=>input;const result=await vision.captureFrame();assert.equal(result,stage?null:'AAAA');assert.equal(input.track.readyState,'ended');assert.equal(videos.at(-1).srcObject,null);
 }
 videoFailure='';const waiting=deferred(),captureInput=stream();videoPlay=()=>waiting.promise;permission=async()=>captureInput;
 const first=vision.captureFrame();assert.equal(first,vision.captureFrame());await flush();fakeWindow.dispatchEvent(new Event('pagehide'));assert.equal(captureInput.track.readyState,'ended');assert.equal(videos.at(-1).srcObject,null);waiting.resolve();assert.equal(await first,null);
 videoPlay=async()=>{};const latePermission=deferred(),lateInput=stream();permission=()=>latePermission.promise;const late=vision.captureFrame();fakeWindow.dispatchEvent(new Event('pagehide'));latePermission.resolve(lateInput);assert.equal(await late,null);assert.equal(lateInput.track.readyState,'ended');
}
vision.stopLiveStream();assert.equal(intervals.size,0);assert.equal(timers.size,0);
console.log('PASS vision: configuration before permission, duplicate/pending starts, Stop during permission/connect, stale callbacks, failed playback/canvas/send, one-shot cleanup and pagehide/late permission. No real media or provider calls.');
