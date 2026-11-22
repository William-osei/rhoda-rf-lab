import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';

// Use the bundled clips and character node transforms with Three's real mixer.
// The textured mesh is replaced by a bounding box so no GPU/image decoder is needed.
const bytes=name=>{const b=fs.readFileSync('public/gltf/'+name+'.glb');return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const motions=await new GLTFLoader().parseAsync(bytes('companion-motions'),'');
const walk=await new GLTFLoader().parseAsync(bytes('companion-walk'),'');
const characterBuffer=fs.readFileSync('public/gltf/research-companion.glb');
const character=JSON.parse(characterBuffer.subarray(20,20+characterBuffer.readUInt32LE(12)));
function model(){
 const nodes=character.nodes.map(data=>{
  const node=new THREE.Object3D();node.name=data.name||'';
  if(data.translation)node.position.fromArray(data.translation);
  if(data.rotation)node.quaternion.fromArray(data.rotation);
  if(data.scale)node.scale.fromArray(data.scale);
  return node;
 });
 character.nodes.forEach((data,i)=>data.children?.forEach(index=>nodes[i].add(nodes[index])));
 const scene=new THREE.Group();character.scenes[character.scene||0].nodes.forEach(index=>scene.add(nodes[index]));
 const body=new THREE.Mesh(new THREE.BoxGeometry(.4,1.68,.2),new THREE.MeshBasicMaterial());body.position.y=.84;scene.add(body);
 return {scene};
}
let fail=new Set(),mixers=[];
globalThis.__companionThree={...THREE,AnimationMixer:class extends THREE.AnimationMixer{constructor(root){super(root);mixers.push(this);}}};
globalThis.__companionLoader=class {
 async loadAsync(path){
  if(fail.has(path))throw Error('test blocked download');
  if(path.endsWith('lab-companion.glb'))throw Error('exercise independent lightweight fallback');
  return path.endsWith('research-companion.glb')?model():path.endsWith('companion-walk.glb')?walk:motions;
 }
 load(path,resolve,_progress,reject){this.loadAsync(path).then(resolve,reject);}
};
const helper=ts.transpileModule(fs.readFileSync('src/companionAnimation.ts','utf8').replace("from 'three'",'from '+JSON.stringify(import.meta.resolve('three'))),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const source=fs.readFileSync('src/humanCompanion.ts','utf8')
 .replace("import * as THREE from 'three';",'const THREE=globalThis.__companionThree;')
 .replace("from './companionAnimation'",'from '+JSON.stringify('data:text/javascript;base64,'+Buffer.from(helper).toString('base64')))
 .replace("from './companionFace'",'from '+JSON.stringify('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(fs.readFileSync('src/companionFace.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64')))
 .replace("from './avatarAnimations'",'from '+JSON.stringify('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(fs.readFileSync('src/avatarAnimations.ts','utf8').replace("from 'three'",'from '+JSON.stringify(import.meta.resolve('three'))),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64')))
 .replace("import {GLTFLoader,type GLTF} from 'three/examples/jsm/loaders/GLTFLoader.js';",'const GLTFLoader=globalThis.__companionLoader;');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {loadHumanCompanion}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const root=new THREE.Group();
const companion=await loadHumanCompanion(root,0,()=>{});companion.holder.visible=true;
const mixer=mixers.at(-1),actions=()=>Object.fromEntries(mixer._actions.map(a=>[a.getClip().name,a]));
assert.equal(companion.modelKind,'lightweight');
assert.equal(companion.limitations.length,1,'missing detailed model is disclosed');
assert(walk.animations[0].tracks.some(track=>track.name.endsWith('.position')),'source walk retains its translations');
assert(actions().Walk.getClip().tracks.every(track=>!track.name.endsWith('.position')),'runtime walk remains in place');
const rest=model().scene,restTransforms=new Map();rest.traverse(node=>restTransforms.set(node.name,{position:node.position.clone(),scale:node.scale.clone()}));
const preserveAnatomy=()=>companion.holder.traverse(node=>{
 const authored=restTransforms.get(node.name);if(!authored||node.name==='')return;
 assert(node.position.distanceTo(authored.position)<1e-8,'preserved attachment for '+node.name);
 assert(node.scale.distanceTo(authored.scale)<1e-8,'preserved scale for '+node.name);
});
for(const action of Object.values(actions()))assert(action.getClip().tracks.every(track=>track.name.endsWith('.quaternion')),'all retargeted motions preserve source model anatomy');
let time=0;
const advance=(duration,enabled=true,angle=0)=>{for(let i=0;i<Math.ceil(duration*60);i++){time+=1/60;companion.update(time,enabled,angle);preserveAnatomy();}};
companion.update(time,true,0);assert(companion.wave());advance(3.5);
assert(companion.isWaving(),'greeting remains active beyond the former incorrect 3.4 second timer');
advance(1.7);assert(!companion.isWaving());
assert(actions().Idle_Subtle.getEffectiveWeight()>.99,'completed greeting restores idle');
assert(companion.wave());advance(.5);root.userData.walking=true;advance(.5);
assert(!companion.isWaving(),'walking cancels the full-body greeting');
assert.equal(companion.wave(),false,'greeting is refused during locomotion');
assert(actions().Walk.getEffectiveWeight()>.99&&actions().Idle_Subtle.getEffectiveWeight()<.001,'only gait has effective full-body weight while walking');
const calf=root.getObjectByName('calf_l'),before=calf.quaternion.clone();advance(.25);
assert(before.angleTo(calf.quaternion)>.01,'the actual bundled clip changes leg pose');
companion.reset();advance(.5);
assert(actions().Walk.getEffectiveWeight()>.99&&actions().Idle_Subtle.getEffectiveWeight()<.001,'reset resumes locomotion without a competing idle');
root.userData.walking=false;advance(.5);
assert(actions().Walk.getEffectiveWeight()<.001&&actions().Idle_Subtle.getEffectiveWeight()>.99,'stopping blends back to idle');
const turnBefore=companion.holder.rotation.y;companion.update(time+1/60,true,Math.PI/2);time+=1/60;
assert(companion.holder.rotation.y>turnBefore&&companion.holder.rotation.y<Math.PI/2,'inspection turn is gradual');
advance(1,true,Math.PI/2);assert(Math.abs(companion.holder.rotation.y-Math.PI/2)<.001);
const pose=calf.quaternion.clone();advance(.5,false,Math.PI/2);assert(pose.angleTo(calf.quaternion)<1e-7,'disabled motion keeps rig paused');
companion.update(NaN,true,0);assert(Number.isFinite(companion.holder.rotation.y),'invalid clock cannot poison pose');
assert(root.position.length()===0,'animation never translates the navigation root');

const warn=console.warn,warnings=[];console.warn=(...values)=>warnings.push(values);
try{
 fail=new Set(['/gltf/companion-motions.glb','/gltf/companion-walk.glb']);
 const fallbackRoot=new THREE.Group(),fallback=await loadHumanCompanion(fallbackRoot,0,()=>{});
 assert.equal(fallbackRoot.children.length,1,'optional animation loss does not leave an orphan');
 assert.equal(fallback.limitations.length,4,'missing detailed model and animations are disclosed');
 fallback.holder.visible=true;fallback.update(0,true,0);fallback.update(1,true,0);
 assert.equal(fallback.wave(),false);assert.equal(fallback.canWave,false);
 assert.equal(warnings.length,2);
 fail=new Set(['/gltf/research-companion.glb']);const rejectedRoot=new THREE.Group();
 await assert.rejects(loadHumanCompanion(rejectedRoot,0,()=>{}));assert.equal(rejectedRoot.children.length,0);
 fail=new Set();const zeroScale=new THREE.Group();zeroScale.scale.setScalar(0);
 await assert.rejects(loadHumanCompanion(zeroScale,0,()=>{}),/parent scale/);assert.equal(zeroScale.children.length,0);
}finally{console.warn=warn;}
console.log('PASS bundled companion clips, preserved joint attachments/scales across greeting/idle/walk, actual greeting duration, gait/greeting arbitration, reset during movement, idle transitions, smooth turns, motion pause, stationary root and optional animation fallback');
