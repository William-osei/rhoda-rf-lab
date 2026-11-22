import * as THREE from 'three';
import {GLTFLoader,type GLTF} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {companionAnimation,companionNod} from './companionAnimation';
import {companionFace} from './companionFace';
import {AvatarActionTransition,AvatarAnimationController,registerAvatarAnimationController,type AvatarAnimationDefinition} from './avatarAnimations';

/** MIT Rocketbox lab companion with the independent CC0 character as fallback.
 * Source pins and licenses are linked from public/gltf/companion-credits.html.
 */
export async function loadHumanCompanion(root:THREE.Group,foot:number,onSelect:()=>void){
 const load=(path:string)=>new Promise<GLTF>((resolve,reject)=>new GLTFLoader().load(path,resolve,undefined,reject));
 let rich=true;
 const gltf=await load('/gltf/lab-companion.glb').catch(()=>{rich=false;return load('/gltf/research-companion.glb');});
 const model=gltf.scene;model.rotation.y=0;model.updateMatrixWorld(true);
 const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3());
 if(!Number.isFinite(size.y)||size.y<=0)throw Error('Character has no usable height.');
 const rootScale=root.getWorldScale(new THREE.Vector3());
 if(!Number.isFinite(rootScale.y)||rootScale.y<=0)throw Error('Character has no usable parent scale.');
 // Animation downloads are optional: keep the usable character if a clip fails.
 const optional=async(path:string)=>{try{return await load(path);}catch(error){console.warn('Research companion animation unavailable: '+path,error);return null;}};
 const [motions,walkData]=rich?[gltf,gltf]:await Promise.all([optional('/gltf/companion-motions.glb'),optional('/gltf/companion-walk.glb')]);
 // All three clips come from a differently proportioned source rig. Applying
 // its translation keys moved hand attachments by 6 cm and stretched fingers.
 // The new asset already bundles compatible native biped rotation clips. Only
 // the legacy Mesh2Motion clips need the source-rest correction.
 const clip=(name:string,data:GLTF|null)=>data?(rich?data.animations?.find(c=>c.name===name)??null:companionAnimation(data.animations?.find(c=>c.name===name),model,data.scene)):null;
 const walkClip=clip('Walk',walkData),idleClip=clip('Idle_Subtle',motions),waveClip=clip('Greeting',motions);
 const limitations:string[]=[];
 if(!rich)limitations.push('Detailed lab model unavailable; showing the lightweight CC0 companion.');
 if(!idleClip)limitations.push('Idle animation unavailable.');
 if(!waveClip)limitations.push('Greeting animation unavailable.');
 if(!walkClip)limitations.push('Walking animation unavailable.');
 const holder=new THREE.Group();holder.name='RHODA_ResearchCompanion';holder.position.y=foot;
 holder.scale.setScalar(1/rootScale.y);
 const normalized=new THREE.Group();normalized.scale.setScalar(1.68/size.y);
 model.position.sub(new THREE.Vector3((box.min.x+box.max.x)/2,box.min.y,(box.min.z+box.max.z)/2));
 normalized.add(model);holder.add(normalized);root.add(holder);holder.visible=false;
 model.traverse(o=>{if((o as THREE.Mesh).isMesh){o.userData.interactable=true;o.userData.onSelect=onSelect;}});
 const mixer=new THREE.AnimationMixer(model);
 const transition=new AvatarActionTransition(mixer);
 const walkingAction=walkClip?mixer.clipAction(walkClip):null;walkingAction?.setEffectiveTimeScale(rich?1:.8);
 const idle=idleClip?mixer.clipAction(idleClip).play():null;
 let currentAction=idle;
 // A saved reduced-motion preference should start in a relaxed authored pose,
 // not depend on receiving a first moving frame to leave the bind pose.
 mixer.update(0);
 const wave=waveClip?mixer.clipAction(waveClip):null;
 if(wave){wave.setLoop(THREE.LoopOnce,1);wave.clampWhenFinished=false;}
 let wasWalking=false,previousTime:number|null=null,motionEnabled=true;
 const head=model.getObjectByName(rich?'Bip01_Head':'head');let headOffset=0;
 const face=companionFace(model);
 const clearHeadOffset=()=>{if(head)head.rotation.x-=headOffset;headOffset=0;};
 const isWalking=()=>!!root.userData.walking;
 const nodClip=companionNod(idleClip||undefined,head),nod=nodClip?mixer.clipAction(nodClip):null;
 const explainClip=idleClip?.clone();
 if(explainClip){explainClip.name='Illustrative_Speaking_Demonstration';explainClip.duration=4.5;}
 const explain=explainClip?mixer.clipAction(explainClip):null;
 const resident=new Map<string,THREE.AnimationAction>();
 for(const [id,action] of [['idle',idle],['walk',walkingAction],['greeting',wave],['nod',nod],['explain',explain]] as const)if(action)resident.set(id,action);
 const definitions:AvatarAnimationDefinition[]=[
  {id:'idle',label:'Relaxed idle',group:'Native human clips',action:idle},
  {id:'walk',label:'Walk in place',group:'Native human clips',action:walkingAction},
  {id:'greeting',label:'Wave hello',group:'Native human clips',action:wave},
  {id:'nod',label:'Acknowledgement nod',group:'Shared previews',action:nod},
  {id:'explain',label:'Illustrative speaking cues',group:'Shared previews',action:explain},
 ].map(definition=>({...definition,...(!definition.action?{reason:'This compatible clip did not load; other poses remain usable.'}:{})}));
 const restoreAutomatic=()=>{
  clearHeadOffset();face.reset();wasWalking=isWalking();
  const action=wasWalking?walkingAction||idle:idle;
  if(action){action.paused=false;action.clampWhenFinished=false;action.setLoop(THREE.LoopRepeat,Infinity);transition.to(action,currentAction,motionEnabled);currentAction=action;}
  else{mixer.stopAllAction();currentAction=null;}
 };
 const preview=new AvatarAnimationController({mixer,definitions,
  context:()=>({visible:holder.visible,enabled:motionEnabled,walking:isWalking(),speaking:!!root.userData.narrating||!!root.userData.speaking}),
  load:async id=>resident.get(id)||null,
  start:action=>{clearHeadOffset();transition.to(action,currentAction,motionEnabled);currentAction=action;},
  restore:restoreAutomatic,
 });
 registerAvatarAnimationController('human',preview);
 const description=rich?'A separate male lab companion in a white coat, with a detailed face, articulated fingers, blinking and gentle speaking cues. Microsoft Rocketbox · MIT license. Speaking cues are illustrative; see model credits for details.':'The lightweight textured male character by Elbolilloduro, with its own human rig and clothing. CC0 licensed. See model credits.';
 return {holder,limitations,description,modelKind:rich?'rocketbox':'lightweight',facialControls:face.available,canWave:!!wave,isWalking,isWaving:()=>!!wave?.isRunning(),
  update(time:number,enabled:boolean,angle:number){
   if(!Number.isFinite(time))return;
   const delta=previousTime===null?0:Math.max(0,Math.min(.1,time-previousTime));previousTime=time;
   motionEnabled=enabled;preview.update();
   const moving=isWalking();
   const facing=moving?0:angle;
   const turn=Math.atan2(Math.sin(facing-holder.rotation.y),Math.cos(facing-holder.rotation.y));
   holder.rotation.y=enabled?holder.rotation.y+turn*(1-Math.exp(-12*delta)):facing;
   if(enabled&&moving!==wasWalking){
    wasWalking=moving;
    const action=moving?walkingAction||idle:idle;
    if(action){action.setLoop(THREE.LoopRepeat,Infinity);action.clampWhenFinished=false;transition.to(action,currentAction,enabled);currentAction=action;}
   }
   if(enabled&&holder.visible){
    clearHeadOffset();mixer.update(delta);transition.update(delta);
    const speaking=!!root.userData.narrating||!!root.userData.speaking||preview.activeAnimation()==='explain';
    face.update(delta,speaking,root.userData.speechLevel);
    if(speaking&&!moving&&head&&(!preview.isActive()||preview.activeAnimation()==='explain')){headOffset=Math.sin(time*2.7)*.025;head.rotation.x+=headOffset;}
   }
  },
  wave(){
   // Greeting contains full-body keys. Mixing it into Walk causes crossed legs
   // and sliding, so expose it only when the navigator is stationary.
   return preview.playAvailable('greeting');
  },
  reset(){
   preview.stop();clearHeadOffset();face.reset();restoreAutomatic();
  },
 };
}


