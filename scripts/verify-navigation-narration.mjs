import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
async function source(path){return import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64'));}
const nav=await source('src/labNavigation.ts');
const points=[];for(let x=-3;x<=3;x+=.4)for(let z=-5.4;z<=1.2;z+=.4)if(nav.floorIsClear({x,z}))points.push({x,z});
let checks=0;
for(let i=0;i<points.length;i+=7)for(const target of [...points.filter((_,j)=>j%13===0),{x:10,z:-3},{x:2.4,z:-3.5},{x:0,z:-8}]){const start=points[i],route=nav.planLabRoute(start,target);assert(route.length,'reachable route');let current=start;for(const next of route){assert(nav.segmentIsClear(current,next),'route crosses furniture/wall');current=next;checks++;}if(nav.floorIsClear(target))assert(Math.hypot(current.x-target.x,current.z-target.z)<1e-8);}
assert.deepEqual(nav.planLabRoute({x:2.4,z:-3.5},{x:0,z:0}),[]);
console.log('PASS',checks,'route segments: bounds, furniture, projected destinations, invalid start');
const timers=[];globalThis.setTimeout=fn=>{timers.push(fn);return timers.length;};
const queue=[];let paused=0,resumed=0;globalThis.window={speechSynthesis:{}};
globalThis.speechSynthesis={cancel(){queue.length=0;},pause(){paused++;},resume(){resumed++;},getVoices(){return [{localService:true,lang:'en-US',name:'Test voice'}];},speak(u){queue.push(u);u.onstart?.();}};
globalThis.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
globalThis.document={getElementById(){return {value:'.9'};}};
const {LessonNarrator,narrationChunks}=await source('src/lessonNarrator.ts');let index=0,status='',cues=[],completedSteps=[];
const decimal='Set 0.5 volts per division. '+('A long phrase that must remain bounded without splitting decimals. '.repeat(20));const parts=narrationChunks(decimal);assert(parts.every(p=>p.length<=240));assert(parts.join(' ').includes('0.5'));assert.equal(parts.join(' '),decimal.trim());
const narrator=new LessonNarrator(()=>({title:'Tour',text:'Part one. '+('Explain this safely. '.repeat(40)),index,total:2,topic:'Ch 1'}),()=>index++,s=>status=s,(s,on)=>cues.push(on),()=>true,s=>completedSteps.push(s.index));
narrator.play();assert(queue.length);const resumesBeforePause=resumed;narrator.pause();narrator.resume();assert.equal(paused,1);assert.equal(resumed,resumesBeforePause+1);
assert.equal(completedSteps.length,0,'pause or visit must not complete step');
let completed;while(queue.length){completed=queue.shift();completed.onend();}assert.equal(index,0);assert(status.includes('Continuing'));
narrator.pause();timers.shift()();assert.equal(index,0);narrator.resume();assert.equal(index,1);assert(queue.length);
while(queue.length)queue.shift().onend();assert(status.includes('Lesson complete'));assert.equal(cues.at(-1),false);
assert.deepEqual(completedSteps,[0,1]);
index=0;narrator.play();const stale=queue[0];narrator.stop();stale.onend();for(const fn of timers.splice(0))fn();assert.equal(index,0);assert.equal(queue.length,0);
// Resume between completed steps must use the current Continue preference.
let auto=true,position=0,topic='original',lessonTitle='First lesson';const recordedCues=[],finished=[];
const sharedStep={title:lessonTitle,text:'A short complete step.',index:position,total:3,topic};
const snapshot=()=>Object.assign(sharedStep,{title:lessonTitle,index:position,topic});
const controlled=new LessonNarrator(snapshot,()=>position++,s=>status=s,(step,on)=>recordedCues.push({title:step.title,topic:step.topic,on}),()=>auto,step=>finished.push(step.index));
controlled.play();queue.shift().onend();assert.equal(controlled.state,'between');controlled.pause();auto=false;controlled.resume();
assert.equal(position,0);assert.equal(controlled.state,'idle');assert.equal(queue.length,0);assert(status.includes('Continue when ready'));assert.deepEqual(finished,[0]);assert.equal(recordedCues.at(-1).on,false);
for(const fn of timers.splice(0))fn();assert.equal(position,0,'an old advance timer cannot bypass Continue off');
// Changing a lesson while paused cannot resume the old chapter. The captured
// cue retains its identity even when snapshot() reuses a mutable object.
auto=true;controlled.play();const priorUtterance=queue[0];controlled.pause();lessonTitle='Replacement lesson';topic='replacement';snapshot();controlled.resume();
assert.equal(controlled.state,'idle');assert.equal(queue.length,0);assert(status.includes('Lesson changed'));assert.deepEqual(recordedCues.at(-1),{title:'First lesson',topic:'original',on:false});
controlled.play();assert.deepEqual(recordedCues.at(-1),{title:'Replacement lesson',topic:'replacement',on:true});const cueCount=recordedCues.length;
priorUtterance.onstart();priorUtterance.onend();priorUtterance.onerror({error:'canceled'});
assert.equal(recordedCues.length,cueCount,'old callbacks cannot clear or relabel the newer speaking cue');assert.equal(controlled.state,'reading');
controlled.stop();for(const fn of timers.splice(0))fn();
// The delayed advance also checks lesson identity when callers change it
// without an explicit stop, and never credits the newly selected chapter.
controlled.play();queue.shift().onend();const finishedCount=finished.length;lessonTitle='Third lesson';snapshot();timers.shift()();
assert.equal(position,0);assert.equal(controlled.state,'idle');assert.equal(queue.length,0);assert.equal(finished.length,finishedCount);
// A completion subscriber can start a new reading synchronously. The old
// callback must not install an automatic advance over that new reading.
let replaced=false;const reentrant=new LessonNarrator(snapshot,()=>position++,s=>status=s,(step,on)=>recordedCues.push({title:step.title,topic:step.topic,on}),()=>true,()=>{if(!replaced){replaced=true;lessonTitle='Subscriber lesson';reentrant.play();}});
reentrant.play();queue.shift().onend();assert.equal(reentrant.state,'reading');assert.equal(queue.length,1);assert.equal(timers.length,0);assert.equal(recordedCues.at(-1).title,'Subscriber lesson');reentrant.stop();
speechSynthesis.getVoices=()=>[];narrator.play();assert(status.includes('No installed local English voice'));assert.equal(queue.length,0);
console.log('PASS narration chunks, pause/resume, Continue-off resume, captured lesson identity, continuous steps, completion, stale callback and subscriber cancellation, voice fallback');
