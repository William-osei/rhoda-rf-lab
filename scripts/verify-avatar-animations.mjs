import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';

const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const url=source=>'data:text/javascript;base64,'+Buffer.from(compile(source)).toString('base64');
const three=JSON.stringify(import.meta.resolve('three'));
const controllerUrl=url(fs.readFileSync('src/avatarAnimations.ts','utf8').replace("from 'three'",'from '+three));
const api=await import(controllerUrl);
const helperUrl=url(fs.readFileSync('src/companionAnimation.ts','utf8').replace("from 'three'",'from '+three));
const {companionNod}=await import(helperUrl);
const walkUrl=url(fs.readFileSync('src/inPlaceWalk.ts','utf8'));
const {inPlaceWalk}=await import(walkUrl);
const manifest=JSON.parse(fs.readFileSync('src/animation-manifest.json','utf8'));
const readJson=path=>{const b=fs.readFileSync(path);return JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));};
function authoredNodes(data){
 const bones=new Set(data.skins?.flatMap(s=>s.joints)||[]);
 const nodes=data.nodes.map((d,i)=>{const o=bones.has(i)?new THREE.Bone():new THREE.Object3D();o.name=d.name||'';if(d.translation)o.position.fromArray(d.translation);if(d.rotation)o.quaternion.fromArray(d.rotation);if(d.scale)o.scale.fromArray(d.scale);return o;});
 data.nodes.forEach((d,i)=>d.children?.forEach(c=>nodes[i].add(nodes[c])));
 const group=new THREE.Group();data.scenes[data.scene||0].nodes.forEach(n=>group.add(nodes[n]));return group;
}
const parse=async path=>{const b=fs.readFileSync('public'+path);return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');};
const original=authoredNodes(readJson('public/gltf/rhode_schwarz-character.glb'));
let checked=0;
for(const [category,paths]of Object.entries(manifest))for(const path of paths){
 const source=(await parse(path)).animations[0];assert(source&&source.tracks.length>50);
 for(const track of source.tracks){assert(original.getObjectByName(THREE.PropertyBinding.parseTrackName(track.name).nodeName),path+' target');assert(Array.from(track.values).every(Number.isFinite));}
 const clip=category==='locomotion'||category==='dance'?inPlaceWalk(source):source.clone();
 for(const track of clip.tracks.filter(t=>/(?:^|[./])hips\.position$/i.test(t.name)))if(category==='locomotion'||category==='dance'){
  for(let i=0;i<track.values.length;i+=3){assert.equal(track.values[i],track.values[0]);assert.equal(track.values[i+2],track.values[2]);}
 }
 const mixer=new THREE.AnimationMixer(original),action=mixer.clipAction(clip);action.play();
 for(let i=0;i<8;i++){mixer.setTime(clip.duration*i/8);original.traverse(o=>{assert([...o.position,...o.quaternion,...o.scale].every(Number.isFinite),path+' finite pose');});assert.equal(original.position.length(),0,'preview must not move navigation root');}
 mixer.stopAllAction();mixer.uncacheRoot(original);checked++;
}
assert.equal(checked,44);

// The mounted original adapter uses real clip assets, with an inert media layer.
globalThis.window=new EventTarget();globalThis.__animationStyle='rhoda';globalThis.__animationEnabled=true;
let failPath='',loadCounts=new Map();
globalThis.__animationLoader=class{load(path,resolve,_progress,reject){loadCounts.set(path,(loadCounts.get(path)||0)+1);if(path===failPath){queueMicrotask(()=>reject(Error('bounded test failure')));return;}parse(path).then(resolve,reject);}};
const originalSource=fs.readFileSync('src/rhode_schwarz.ts','utf8').replace(/^import[\s\S]*?;\r?$/gm,'');
const prefix=`import * as THREE from ${three};import {AvatarActionTransition,AvatarAnimationController,registerAvatarAnimationController} from ${JSON.stringify(controllerUrl)};import {companionNod} from ${JSON.stringify(helperUrl)};import {inPlaceWalk} from ${JSON.stringify(walkUrl)};const manifest=${JSON.stringify(manifest)};const GLTFLoader=globalThis.__animationLoader;const selectedAvatarStyle=()=>globalThis.__animationStyle,avatarMotionEnabled=()=>globalThis.__animationEnabled;class AudioRecorder{release(){}}class AudioFeedback{click(){}}`;
const {RhodeSchwarzAssistant}=await import(url(prefix+originalSource));
const assistant=new RhodeSchwarzAssistant(new THREE.Scene());assistant.mesh=original;assistant.headBone=original.getObjectByName('Head');
await assistant.loadAnimations();await assistant.loadStartupAnimations();
assert.equal(api.getAvatarAnimationOptions('rhoda').length,48);assert.equal(api.getAvatarAnimationOptions('rhoda').filter(o=>o.id.startsWith('clip:')).length,44);
const camera=new THREE.PerspectiveCamera();camera.position.set(0,1.6,3);
const advance=n=>{for(let i=0;i<n;i++){assistant.update(camera,1/60);}};
assert(await api.playAvatarAnimation('rhoda','nod'));const head=assistant.headBone,rest=head.quaternion.clone();advance(22);assert(rest.angleTo(head.quaternion)>.01,'generated nod changes actual head');
globalThis.__animationEnabled=false;advance(1);const paused=head.quaternion.clone(),pausedTime=assistant.currentAction.time;advance(30);
assert.equal(api.getAvatarAnimationSnapshot('rhoda').phase,'paused');assert.equal(assistant.currentAction.time,pausedTime);assert.deepEqual(head.quaternion.toArray(),paused.toArray());
globalThis.__animationEnabled=true;advance(120);assert.equal(api.getAvatarAnimationSnapshot('rhoda').phase,'idle');assert.equal(assistant.idleAction.loop,THREE.LoopRepeat);
assert(await api.playAvatarAnimation('rhoda','idle'));advance(Math.ceil(assistant.idleAction.getClip().duration*60)+30);assert.equal(assistant.idleAction.loop,THREE.LoopRepeat,'borrowed idle is restored to repeating');assert(assistant.idleAction.isRunning());
assert(await api.playAvatarAnimation('rhoda','explain'));assistant.setState('SPEAKING');assistant.walkTo(new THREE.Vector3(0,0,3),0);advance(3);
assert.equal(api.getAvatarAnimationSnapshot('rhoda').phase,'busy');assert.equal(assistant.currentAction.getClip().name,'F_Walk_002','moving beats full-body speech');assert.equal(assistant.currentAction.loop,THREE.LoopRepeat);
assistant.stopAutoFollow();assistant.setState('READY');advance(20);
const optional=manifest.dance[1],id='clip:dance:'+optional.split('/').pop().replace('.glb','');failPath=optional;
const warn=console.warn;console.warn=()=>{};
try{assert.equal(await api.playAvatarAnimation('rhoda',id),false);assert.equal(api.getAvatarAnimationSnapshot('rhoda').phase,'error');failPath='';assert(await api.playAvatarAnimation('rhoda',id));assert.equal(loadCounts.get(optional),2,'failed lazy load is retryable');}finally{console.warn=warn;}
api.stopAvatarAnimation('rhoda');assert.equal(assistant.idleAction.loop,THREE.LoopRepeat);assert(assistant.idleAction.isRunning());

// Race and cancellation use an actual mixer/action, not mirrored fake methods.
const rig=new THREE.Group(),joint=new THREE.Object3D();joint.name='Head';rig.add(joint);
const idleClip=new THREE.AnimationClip('idle',.5,[new THREE.QuaternionKeyframeTrack('Head.quaternion',[0,.5],[0,0,0,1,0,0,0,1])]);
const nod=companionNod(idleClip,joint);assert(nod&&nod.duration===1.3&&nod.tracks.every(t=>t.name.endsWith('.quaternion')));
const mixer=new THREE.AnimationMixer(rig),idle=mixer.clipAction(idleClip).play(),one=mixer.clipAction(nod);
let context={visible:true,enabled:true,walking:false,speaking:false},resolvers={},restores=0;
const preview=new api.AvatarAnimationController({mixer,definitions:[{id:'one',label:'One',group:'test'},{id:'two',label:'Two',group:'test'},{id:'three',label:'Three',group:'test'},{id:'bad',label:'Unavailable',group:'test',reason:'Incompatible'}],context:()=>context,load:id=>new Promise(resolve=>resolvers[id]=resolve),start:a=>{mixer.stopAllAction();a.reset().setEffectiveWeight(1).play();},restore:()=>{restores++;mixer.stopAllAction();idle.setLoop(THREE.LoopRepeat,Infinity).reset().setEffectiveWeight(1).play();mixer.update(0);}});
const stale=preview.play('one'),latest=preview.play('two');resolvers.one(one);assert.equal(await stale,false);assert.equal(preview.snapshot().activeId,'two');resolvers.two(one);assert(await latest);
preview.stop();const hide=preview.play('three');context.visible=false;preview.update();resolvers.three(one);assert.equal(await hide,false);assert.equal(preview.snapshot().activeId,null);
context.visible=true;assert.equal(await preview.play('bad'),false);assert(restores>=2);
preview.dispose();assert(idle.isRunning());assert.equal(rig.position.length(),0);
const fixed=mixer.clipAction(new THREE.AnimationClip('fixed',1,[new THREE.QuaternionKeyframeTrack('Head.quaternion',[0,1],[...new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.6).toArray(),...new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.6).toArray()])]));
const transition=new api.AvatarActionTransition(mixer);mixer.stopAllAction();idle.reset().setEffectiveWeight(1).play();mixer.update(0);
transition.to(fixed,idle,true);assert(joint.quaternion.angleTo(new THREE.Quaternion())<1e-6,'manual transition keeps starting pose');mixer.update(.09);transition.update(.09);
assert(joint.quaternion.angleTo(new THREE.Quaternion())>.1&&joint.quaternion.angleTo(new THREE.Quaternion())<.59,'midpoint is blended');mixer.update(.11);transition.update(.11);assert(!idle.isScheduled(),'retired action stops after bounded blend');
transition.to(idle,fixed,false);assert(joint.quaternion.angleTo(new THREE.Quaternion())<1e-6,'paused Stop applies neutral pose immediately');assert(!fixed.isScheduled());
console.log('PASS all 44 authored Rhoda clips/rig bindings/finite in-place poses; 48-option adapter, actual nod, exact preview pause, idle repeat restoration, walking-over-speech, retry, stale-load/hide/Stop cancellation, unavailable rejection and bounded smooth pose transitions.');
