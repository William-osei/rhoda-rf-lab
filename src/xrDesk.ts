import {LessonNarrator,type NarratedStep} from './lessonNarrator';
import {READING_PATHS} from './readingPaths';
import {LessonProgress} from './lessonProgress';

let narrator:LessonNarrator|undefined;
let storage:Storage|undefined;try{storage=localStorage;}catch{}
const progress=new LessonProgress(storage);
export const xrLesson={path:0,step:0};
try{const saved=JSON.parse(storage?.getItem('rhoda-xr-lesson')||'null');const path=READING_PATHS.findIndex(p=>p.id===saved?.id);if(path>=0&&Number.isInteger(saved.step)&&saved.step>=0&&saved.step<READING_PATHS[path].steps.length){xrLesson.path=path;xrLesson.step=saved.step;}}catch{}

const chapterTitles:Record<string,string[]>={
 'scope-tour':['Channel input & probe ratio','Probe compensation','Vertical scale · volts/div','Horizontal scale · time/div','Trigger level & slope','Frequency & amplitude','Save the training evidence'],
 'first-connection':['Identify the instrument','Choose the supported interface','Plan the physical connection','Prepare the computer','Verify the identity','Diagnose and close the session'],
 'scope-start':['Check the manual & source','Match probe and channel','Set up the waveform','Predict the period','Compare measurements','Preserve the evidence'],
 'scope-workbook':['Select an exercise','Write a prediction','Plan the settings','Capture actual evidence','Explain disagreement','Define the next test'],
 'fpc-start':['Confirm model & options','Review the input limits','Define the signal question','Select spectrum settings','Plan calibration','Save trace & context'],
 'generator-start':['Check model & commands','Define the waveform','Understand the load','Plan cable & termination','Prepare with output off','Compare receiving readings'],
 'supply-start':['Confirm the supply model','Plan channel & limits','Separate settings from readings','Review output controls','Check automation support','Record shutdown & results']
};
function chapterTitle(index:number){return chapterTitles[READING_PATHS[xrLesson.path].id]?.[index]||`Part ${index+1}`;}
export function stepLesson(delta:number){if(!Number.isFinite(delta))return;xrLesson.step=Math.max(0,Math.min(READING_PATHS[xrLesson.path].steps.length-1,xrLesson.step+Math.trunc(delta)));renderLesson();}
function visitStep(index:number){xrLesson.step=Math.max(0,Math.min(READING_PATHS[xrLesson.path].steps.length-1,index));renderLesson();}
function selectPath(index:number){if(index<0||index>=READING_PATHS.length)return;xrLesson.path=index;const p=READING_PATHS[index];xrLesson.step=progress.position(p.id,p.steps.length);renderLesson();}
export function nextLesson(){selectPath((xrLesson.path+1)%READING_PATHS.length);}
export function lessonSnapshot(){const p=READING_PATHS[xrLesson.path];const topics=p.id==='scope-tour'?['Ch 1','Probe compensation','Vertical scale','Horizontal','Trigger level','Frequency measurement','Save/Load']:['Ch 1','Probe compensation','Horizontal','Trigger level','Frequency measurement','Save/Load'];return {title:p.title,part:chapterTitle(xrLesson.step),text:p.steps[xrLesson.step],count:`${xrLesson.step+1} / ${p.steps.length}`,index:xrLesson.step,total:p.steps.length,topic:topics[xrLesson.step]||'Display'};}
function renderProgress(){
 const p=READING_PATHS[xrLesson.path],completed=progress.completedCount(p.id,p.steps.length),current=progress.completion(p.id,xrLesson.step);
 for(const prefix of ['lesson','station']){
  const meter=document.getElementById(`${prefix}-progress`) as HTMLProgressElement|null;if(meter){meter.max=p.steps.length;meter.value=completed;meter.setAttribute('aria-label',`${completed} of ${p.steps.length} parts reviewed or listened to`);}
  const label=document.getElementById(`${prefix}-progress-label`);if(label)label.textContent=`${completed} of ${p.steps.length} completed · ${current==='listened'?'current part listened to':current==='reviewed'?'current part reviewed':'current part not completed'}`;
  const storageStatus=document.getElementById(`${prefix}-storage-status`);if(storageStatus)storageStatus.textContent=progress.storageMessage;
  const button=document.getElementById(`${prefix}-complete`);if(button){button.textContent=current?'Undo completion':'Mark this part reviewed';button.setAttribute('aria-pressed',String(!!current));}
  const list=document.getElementById(`${prefix}-chapters`);if(!list)continue;list.replaceChildren();
  p.steps.forEach((_,index)=>{const li=document.createElement('li'),button=document.createElement('button'),number=document.createElement('span'),title=document.createElement('span'),state=document.createElement('span');const done=progress.completion(p.id,index);button.type='button';button.className='chapter-button';button.dataset.step=String(index);if(index===xrLesson.step)button.setAttribute('aria-current','step');button.setAttribute('aria-label',`Part ${index+1}: ${chapterTitle(index)}${done?', '+done:', not completed'}`);number.className='chapter-number';number.textContent=done?'✓':String(index+1);number.setAttribute('aria-hidden','true');title.className='chapter-title';title.textContent=chapterTitle(index);state.className='chapter-state';state.textContent=done|| (index===xrLesson.step?'Current':'');button.append(number,title,state);button.onclick=()=>{visitStep(index);(document.getElementById(prefix==='station'?'station-read':'lesson-read') as HTMLButtonElement).focus();};li.append(button);list.append(li);});
 }
}
function renderLesson(){
 narrator?.stop('Ready for this part.');const p=READING_PATHS[xrLesson.path];progress.savePosition(p.id,xrLesson.step);
 try{storage?.setItem('rhoda-xr-lesson',JSON.stringify({id:p.id,step:xrLesson.step}));}catch{}
 (document.getElementById('xr-path') as HTMLSelectElement).value=String(xrLesson.path);
 document.getElementById('lesson-count')!.textContent=`PART ${xrLesson.step+1} OF ${p.steps.length} · OFFLINE LESSON`;
 document.getElementById('lesson-text')!.textContent=p.steps[xrLesson.step];
 document.getElementById('lesson-part-title')!.textContent=chapterTitle(xrLesson.step);
 document.getElementById('station-part-title')!.textContent=chapterTitle(xrLesson.step);
 for(const prefix of ['lesson','station']){(document.getElementById(`${prefix}-prev`) as HTMLButtonElement).disabled=xrLesson.step===0;(document.getElementById(`${prefix}-next`) as HTMLButtonElement).disabled=xrLesson.step===p.steps.length-1;}
 document.getElementById('lesson-intro')!.textContent=p.intro;
 document.getElementById('lesson-evidence')!.textContent=p.evidence;
 (document.getElementById('lesson-source') as HTMLAnchorElement).href=`library.html?${new URLSearchParams({q:p.search})}`;
 renderProgress();window.dispatchEvent(new CustomEvent('rhoda-lesson-cue',{detail:{...lessonSnapshot(),speaking:false}}));
}
const picker=document.getElementById('xr-path') as HTMLSelectElement;READING_PATHS.forEach((p,i)=>picker.add(new Option(p.title,String(i))));picker.onchange=()=>selectPath(Number(picker.value));
document.getElementById('lesson-prev')!.onclick=()=>stepLesson(-1);document.getElementById('lesson-next')!.onclick=()=>stepLesson(1);
for(const prefix of ['lesson','station']){
 document.getElementById(`${prefix}-complete`)!.onclick=()=>{const p=READING_PATHS[xrLesson.path];if(progress.completion(p.id,xrLesson.step))progress.clearCompletion(p.id,xrLesson.step);else progress.complete(p.id,xrLesson.step,'reviewed');renderProgress();};
 document.getElementById(`${prefix}-restart`)!.onclick=()=>visitStep(0);
}
renderLesson();
document.getElementById('focus-view')!.onclick=()=>{const on=document.body.classList.toggle('focus');document.getElementById('focus-view')!.focus();document.getElementById('focus-view')!.setAttribute('aria-pressed',String(on));document.getElementById('focus-view')!.textContent=on?'Show learning desk':'Focus view';window.dispatchEvent(new Event('rhoda-focus-change'));};
window.addEventListener('keydown',event=>{if(event.key!=='Escape'||event.defaultPrevented||!document.body.classList.contains('focus'))return;if((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]'))return;document.getElementById('focus-view')!.click();event.preventDefault();});
(async()=>{const xr=(navigator as any).xr;let supported=false;try{supported=!!xr&&await xr.isSessionSupported('immersive-ar');}catch{}document.getElementById('xr-capability')!.textContent=supported?'Browser reports immersive AR support. A compatible headset and secure connection are required.':'Immersive AR is unavailable in this browser. The desktop scene and offline learning desk remain available.';})();
export function sceneStatus(text:string){document.getElementById('xr-status')!.textContent=text;document.getElementById('xr-loading')!.textContent=text;}

/** Returning to a station resumes its plan; Start at first part is a separate, explicit action. */
export function chooseLesson(id:string){const i=READING_PATHS.findIndex(p=>p.id===id);if(i>=0)selectPath(i);}
export function stopLessonSpeech(){narrator?.stop();}
export function readLessonAloud(){narrator?.play();}
export function pauseLessonSpeech(){narrator?.pause();}
export function resumeLessonSpeech(){narrator?.resume();}
function lessonCue(s:NarratedStep,speaking:boolean){window.dispatchEvent(new CustomEvent('rhoda-lesson-cue',{detail:{...s,speaking}}));document.getElementById('station-narration')!.textContent=s.text;document.getElementById('station-lesson-title')!.textContent=s.title+' · step '+(s.index+1)+' of '+s.total;}
function syncSpeechControls(){const state=narrator?.state||'idle';for(const prefix of ['lesson','station']){(document.getElementById(`${prefix}-pause`) as HTMLButtonElement).disabled=state==='idle'||state==='paused';(document.getElementById(`${prefix}-resume`) as HTMLButtonElement).disabled=state!=='paused';(document.getElementById(`${prefix}-stop`) as HTMLButtonElement).disabled=state==='idle';}}
narrator=new LessonNarrator(lessonSnapshot,()=>stepLesson(1),text=>{document.getElementById('speech-status')!.textContent=text;document.getElementById('station-speech-status')!.textContent=text;syncSpeechControls();},lessonCue,()=>!!(document.getElementById('speech-auto') as HTMLInputElement).checked,step=>{const p=READING_PATHS[xrLesson.path];if(step.index!==xrLesson.step||step.total!==p.steps.length||step.title!==p.title)return;progress.complete(p.id,step.index,'listened');renderProgress();});
syncSpeechControls();
for(const [id,handler] of [['lesson-read',readLessonAloud],['lesson-stop',stopLessonSpeech],['lesson-pause',pauseLessonSpeech],['lesson-resume',resumeLessonSpeech],['station-read',readLessonAloud],['station-stop',stopLessonSpeech],['station-pause',pauseLessonSpeech],['station-resume',resumeLessonSpeech]] as const)document.getElementById(id)!.onclick=handler;
document.getElementById('station-next')!.onclick=()=>stepLesson(1);document.getElementById('station-prev')!.onclick=()=>stepLesson(-1);window.addEventListener('pagehide',stopLessonSpeech);

// Keep both reading surfaces in sync, including after a reload. Pace applies at the next spoken phrase.
try{const settings=JSON.parse(storage?.getItem('rhoda-lesson-speech-v1')||'null');if(typeof settings?.auto==='boolean')for(const id of ['speech-auto','station-auto'])(document.getElementById(id) as HTMLInputElement).checked=settings.auto;if(['0.75','0.9','1.05'].includes(settings?.rate))for(const id of ['speech-rate','station-rate'])(document.getElementById(id) as HTMLSelectElement).value=settings.rate;}catch{}
function saveSpeechSettings(){try{storage?.setItem('rhoda-lesson-speech-v1',JSON.stringify({auto:(document.getElementById('speech-auto') as HTMLInputElement).checked,rate:(document.getElementById('speech-rate') as HTMLSelectElement).value}));}catch{}}
for(const id of ['speech-auto','station-auto'])document.getElementById(id)!.onchange=()=>{const checked=(document.getElementById(id) as HTMLInputElement).checked;for(const target of ['speech-auto','station-auto'])(document.getElementById(target) as HTMLInputElement).checked=checked;saveSpeechSettings();};
for(const id of ['speech-rate','station-rate'])document.getElementById(id)!.onchange=()=>{const rate=(document.getElementById(id) as HTMLSelectElement).value;for(const target of ['speech-rate','station-rate'])(document.getElementById(target) as HTMLSelectElement).value=rate;saveSpeechSettings();};
const transcript=document.getElementById('station-transcript') as HTMLDetailsElement;const compact=matchMedia('(max-width: 600px)');let transcriptPreference:string|null=null;try{transcriptPreference=storage?.getItem('rhoda-tour-transcript')||null;}catch{}transcript.open=transcriptPreference?transcriptPreference==='open':!compact.matches;transcript.addEventListener('toggle',()=>{try{storage?.setItem('rhoda-tour-transcript',transcript.open?'open':'closed');}catch{}});
const initialLesson=new URLSearchParams(location.search).get('lesson');if(initialLesson)chooseLesson(initialLesson);
