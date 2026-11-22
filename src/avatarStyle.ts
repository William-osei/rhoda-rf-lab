import { loadHumanCompanion } from './humanCompanion';
import {getAvatarAnimationOptions,getAvatarAnimationSnapshot,playAvatarAnimation,stopAvatarAnimation} from './avatarAnimations';
import * as THREE from 'three';

export type AvatarStyle='rhoda'|'human'|'hidden';
const styles:AvatarStyle[]=['rhoda','human','hidden'];
const labels={rhoda:'Rhoda avatar',human:'Research companion',hidden:'Avatar hidden'};
const descriptions:Record<AvatarStyle,string>={
 rhoda:'Original animated human avatar. Inspect the face and hands, or preview its compatible motions below.',
 human:'A separate male lab companion with an articulated human rig. Loads when selected. See model credits.',
 hidden:'Avatar hidden for a clear workspace. Offline lessons and the spatial panel remain available.'
};
let current:AvatarStyle='rhoda';
let selectionRevision=0;
let selectionPending=false;
let human:Awaited<ReturnType<typeof loadHumanCompanion>>|undefined;
let originalHolder:THREE.Group|undefined;
let originalAvailable=true;
let requestHuman:((revision:number,persist:boolean)=>void)|undefined;
let inspectAngle=0;
let controlsSignature='';
let lastSyncTime=-Infinity;
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
let motionPreference:boolean|null=null;
// Retain the existing preference key so removing the android preserves motion choices.
try{const value=localStorage.getItem('rhoda-robot-motion');if(value==='true'||value==='false')motionPreference=value==='true';}catch{}
let motionEnabled=motionPreference??!reducedMotion.matches;
try{
 const saved=localStorage.getItem('rhoda-avatar-style');
 if(saved==='robot'||saved==='ceramic'){
  current=saved==='robot'?'human':'rhoda';localStorage.setItem('rhoda-avatar-style',current);
 }else if(styles.includes(saved as AvatarStyle))current=saved as AvatarStyle;
}catch{}
const visibleHuman=()=>current!=='hidden'&&!selectionPending;
const friendlyId=()=>current==='human'?'greeting':'explain';
export function avatarMotionEnabled(){return motionEnabled;}
export function selectedAvatarStyle(){return current;}
export function avatarLabel(){return labels[current];}

function syncAnimationControls(){
 const panel=document.getElementById('robot-controls');panel?.toggleAttribute('hidden',current==='hidden');
 const picker=document.getElementById('companion-animation') as HTMLSelectElement|null;
 const play=document.getElementById('companion-animation-play') as HTMLButtonElement|null;
 const stop=document.getElementById('companion-animation-stop') as HTMLButtonElement|null;
 const status=document.getElementById('companion-animation-status');
 const style=current==='hidden'?'rhoda':current;
 const options=getAvatarAnimationOptions(style),snapshot=getAvatarAnimationSnapshot(style);
 const signature=style+':'+options.map(o=>o.id+'|'+o.label+'|'+o.group+'|'+o.availability).join(';');
 if(picker&&signature!==controlsSignature){
  const selected=picker.value;picker.replaceChildren();const groups=new Map<string,HTMLOptGroupElement>();
  for(const item of options){
   let group=groups.get(item.group);
   if(!group){group=document.createElement('optgroup');group.label=item.group;groups.set(item.group,group);picker.append(group);}
   const option=document.createElement('option');option.value=item.id;option.textContent=item.label;
   option.disabled=item.availability==='unavailable';if(item.reason)option.title=item.reason;group.append(option);
  }
  picker.value=options.some(o=>o.id===selected&&o.availability!=='unavailable')?selected:(options.find(o=>o.id==='nod'&&o.availability!=='unavailable')??options.find(o=>o.availability!=='unavailable'))?.id??'';
  controlsSignature=signature;
 }
 if(picker)picker.disabled=!visibleHuman()||!options.some(o=>o.availability!=='unavailable');
 if(play)play.disabled=!visibleHuman()||!motionEnabled||!snapshot.canPlay||!picker?.value;
 if(stop)stop.disabled=!visibleHuman()||!snapshot.canStop;
 for(const id of ['robot-turn','robot-reset']){const control=document.getElementById(id) as HTMLButtonElement|null;if(control)control.disabled=!visibleHuman();}
 const message=selectionPending?'Loading the selected character…':!motionEnabled&&current!=='hidden'?'Animation paused. Enable gentle animation to continue.':snapshot.message;
 if(status&&status.textContent!==message)status.textContent=message;
 const wave=document.getElementById('robot-wave') as HTMLButtonElement|null;
 const friendly=options.find(o=>o.id===friendlyId());
 if(wave){
  const active=snapshot.activeId===friendlyId()&&(snapshot.phase==='playing'||snapshot.phase==='paused'||snapshot.phase==='loading');
  wave.disabled=!visibleHuman()||!motionEnabled||!snapshot.canPlay||active||!friendly||friendly.availability==='unavailable';
  wave.textContent=active?(snapshot.phase==='loading'?'Preparing gesture…':snapshot.phase==='paused'?'Gesture paused':'Playing gesture…'):
   snapshot.phase==='busy'?(snapshot.message.startsWith('Walking')?(current==='human'?'Stop walking to wave':'Stop walking to gesture'):'Pause narration to gesture'):
   friendly?.availability==='unavailable'?'Gesture unavailable':current==='human'?'Wave hello':'Friendly gesture';
  wave.setAttribute('aria-busy',String(active&&snapshot.phase!=='paused'));
  wave.title=friendly?.reason??(current==='human'?'Play the native greeting':'Play a friendly explanation gesture');
 }
 const motionStatus=document.getElementById('robot-motion-status');
 const motionText=(motionPreference===null?'Following device preference':'Using your saved preference')+' - animation '+(motionEnabled?'on':'off');
 if(motionStatus&&motionStatus.textContent!==motionText)motionStatus.textContent=motionText;
 const motion=document.getElementById('robot-motion') as HTMLInputElement|null;if(motion)motion.checked=motionEnabled;
}
window.addEventListener('rhoda-animation-change',syncAnimationControls);
reducedMotion.addEventListener('change',()=>{if(motionPreference===null){motionEnabled=!reducedMotion.matches;syncAnimationControls();}});
export function useDeviceMotion(){motionPreference=null;motionEnabled=!reducedMotion.matches;try{localStorage.removeItem('rhoda-robot-motion');}catch{}syncAnimationControls();}
export function setAvatarMotion(enabled:boolean){motionPreference=enabled;motionEnabled=enabled;try{localStorage.setItem('rhoda-robot-motion',String(enabled));}catch{}syncAnimationControls();}
export function companionGreetingLabel(){
 if(current==='hidden')return 'Show companion';
 if(selectionPending)return 'Loading companion…';
 const snapshot=getAvatarAnimationSnapshot(current);
 if(snapshot.phase==='unavailable')return 'Preparing animations…';
 const friendly=getAvatarAnimationOptions(current).find(option=>option.id===friendlyId());
 if(!friendly||friendly.availability==='unavailable')return 'Gesture unavailable';
 if(!motionEnabled)return 'Enable animation';
 if(snapshot.activeId===friendlyId())return snapshot.phase==='loading'?'Preparing gesture…':snapshot.phase==='paused'?'Gesture paused':'Playing gesture…';
 if(!snapshot.canPlay)return snapshot.phase==='busy'?(snapshot.message.startsWith('Walking')?'Stop walking to gesture':'Pause narration to gesture'):'Animation paused';
 return current==='human'?'Wave hello':'Friendly gesture';
}
export function activateCompanionGreeting(){
 if(selectionPending)return;
 if(current==='hidden'){setAvatar(human?'human':'rhoda');return;}
 if(!getAvatarAnimationOptions(current).some(option=>option.id===friendlyId()&&option.availability!=='unavailable'))return;
 if(!motionEnabled){setAvatarMotion(true);return;}
 waveCompanion();
}
export function waveCompanion(){if(visibleHuman()&&motionEnabled){void playAvatarAnimation(current as 'rhoda'|'human',friendlyId()).then(syncAnimationControls);syncAnimationControls();}}
function announcePose(){
 if(current==='hidden')return;
 const facing=['front','quarter turn','back','three-quarter turn'][Math.round(inspectAngle/(Math.PI/2))%4];
 const status=document.getElementById('avatar-status');if(status)status.textContent=labels[current]+' - '+facing+' - visual preference only';
}
export function turnCompanion(){if(visibleHuman()){inspectAngle=(inspectAngle+Math.PI/2)%(Math.PI*2);announcePose();}}
export function resetCompanionPose(){
 inspectAngle=0;
 if(current!=='hidden')stopAvatarAnimation(current);
 human?.reset();if(originalHolder)originalHolder.rotation.y=0;
 syncAnimationControls();announcePose();
}
// Compatibility for older integration scripts; application UI uses neutral names.
export const robotGreetingLabel=companionGreetingLabel;
export const activateRobotGreeting=activateCompanionGreeting;
export const waveRobot=waveCompanion;
export const turnRobot=turnCompanion;
export const resetRobotPose=resetCompanionPose;
export const setRobotMotion=setAvatarMotion;

export function updateAvatarVisual(time:number){
 if(!Number.isFinite(time))return;
 human?.update(time,motionEnabled,inspectAngle);
 if(originalHolder)originalHolder.rotation.y=current==='rhoda'&&!(originalHolder.parent?.userData.walking)?inspectAngle:0;
 if(time<lastSyncTime||time-lastSyncTime>=.15){lastSyncTime=time;syncAnimationControls();}
}
let apply:((style:AvatarStyle)=>void)|undefined;
export function setAvatar(style:AvatarStyle,persist=true){
 if(!styles.includes(style))return;
 if(style==='rhoda'&&!originalAvailable)style='human';
 selectionRevision++;
 if(style!==current||style==='hidden'||(style==='human'&&!human)){
  if(current!=='hidden')stopAvatarAnimation(current);
  inspectAngle=0;
 }
 selectionPending=false;
 if(style==='human'&&!human){
  selectionPending=true;
  if(persist)try{localStorage.setItem('rhoda-avatar-style','human');}catch{}
  const picker=document.getElementById('avatar-style') as HTMLSelectElement|null;if(picker)picker.value='human';
  const description=document.getElementById('avatar-description');if(description)description.textContent='Loading the detailed lab companion. '+labels[current]+' remains visible while it loads.';
  const status=document.getElementById('avatar-status');if(status)status.textContent='Loading research companion…';
  syncAnimationControls();requestHuman?.(selectionRevision,persist);return;
 }
 if(current!==style&&current==='human')human?.reset();
 current=style;apply?.(style);
 if(persist)try{localStorage.setItem('rhoda-avatar-style',style);}catch{}
 const picker=document.getElementById('avatar-style') as HTMLSelectElement|null;if(picker)picker.value=style;
 const description=document.getElementById('avatar-description');
 if(description)description.textContent=(style==='human'?human?.description??descriptions.human:descriptions[style])+(style==='human'&&human?.limitations.length?' '+human.limitations.join(' '):'');
 const status=document.getElementById('avatar-status');if(status)status.textContent=labels[style]+' · visual preference only';
 const controls=document.getElementById('robot-controls'),views=document.getElementById('avatar-view-controls');
 if(style==='hidden'&&(controls?.contains(document.activeElement)||views?.contains(document.activeElement)))picker?.focus();
 controls?.toggleAttribute('hidden',style==='hidden');views?.toggleAttribute('hidden',style==='hidden');
 syncAnimationControls();announcePose();
}
export function cycleAvatar(){const available=originalAvailable?styles:styles.filter(style=>style!=='rhoda');setAvatar(available[(available.indexOf(current)+1)%available.length]);}

/** Both human rigs share placement and controls; no procedural android is created. */
export function installAvatarStyles(root:THREE.Group,onSelect:()=>void){
 root.updateWorldMatrix(true,true);const box=new THREE.Box3().setFromObject(root);
 const foot=box.isEmpty()?0:root.worldToLocal(new THREE.Vector3(box.min.x,box.min.y,box.min.z)).y;
 originalAvailable=root.userData.originalAvatarUnavailable!==true;
 originalHolder=new THREE.Group();originalHolder.name='RHODA_OriginalVisual';
 for(const child of [...root.children])originalHolder.add(child);root.add(originalHolder);
 apply=style=>{if(originalHolder)originalHolder.visible=style==='rhoda';if(human)human.holder.visible=style==='human';};
 const wire=(id:string,handler:()=>void)=>{const control=document.getElementById(id);if(control)control.onclick=handler;};
 wire('robot-wave',waveCompanion);wire('robot-motion-system',useDeviceMotion);wire('robot-turn',turnCompanion);wire('robot-reset',resetCompanionPose);
 wire('companion-animation-play',()=>{const picker=document.getElementById('companion-animation') as HTMLSelectElement|null;if(current!=='hidden'&&visibleHuman()&&motionEnabled&&picker?.value){void playAvatarAnimation(current,picker.value).then(syncAnimationControls);syncAnimationControls();}});
 wire('companion-animation-stop',()=>{if(current!=='hidden')stopAvatarAnimation(current);syncAnimationControls();});
 const animationPicker=document.getElementById('companion-animation') as HTMLSelectElement|null;if(animationPicker)animationPicker.onchange=syncAnimationControls;
 const motion=document.getElementById('robot-motion') as HTMLInputElement;motion.checked=motionEnabled;motion.onchange=()=>setAvatarMotion(motion.checked);
 const picker=document.getElementById('avatar-style') as HTMLSelectElement;picker.disabled=false;picker.onchange=()=>setAvatar(picker.value as AvatarStyle);
 const originalOption=picker.querySelector('option[value=rhoda]') as HTMLOptionElement|null;
 if(originalOption){originalOption.disabled=!originalAvailable;if(!originalAvailable)originalOption.textContent='Original avatar · not bundled';}
 const humanOption=picker.querySelector('option[value=human]') as HTMLOptionElement;humanOption.disabled=false;
 let loading:Promise<Awaited<ReturnType<typeof loadHumanCompanion>>>|undefined;
 requestHuman=(revision,persist)=>{
  if(!loading)loading=loadHumanCompanion(root,foot,onSelect).then(model=>{human=model;return model;});
  loading.then(()=>{
   humanOption.textContent='Research companion';
   if(selectionRevision===revision)setAvatar('human',persist);else apply?.(current);
  }).catch(error=>{
   loading=undefined;humanOption.textContent='Research companion · retry';
   if(selectionRevision===revision){
    selectionPending=false;picker.value=current;syncAnimationControls();
    const status=document.getElementById('avatar-status');if(status)status.textContent='Companion unavailable; choose Research companion again to retry.';
    const description=document.getElementById('avatar-description');if(description)description.textContent=descriptions[current]+' Both human model downloads failed. '+(originalAvailable?'The original character and offline lessons remain available.':'Offline lessons and the spatial controls remain available; choose Research companion again to retry.');
   }
   console.warn('Research companion failed to load',error);
  });
 };
 const saved=current;
 if(!originalAvailable&&saved!=='hidden'){
  // A missing optional asset must not overwrite a saved original-avatar choice.
  current='hidden';apply('hidden');setAvatar('human',false);
 }else{if(saved==='human')current='rhoda';setAvatar(saved);if(saved==='human')apply?.('rhoda');}
}
