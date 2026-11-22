import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
const bytes=fs.readFileSync('public/gltf/lab-companion.glb');
const credit=JSON.parse(fs.readFileSync('public/gltf/lab-companion.credit.json','utf8'));
assert.equal(createHash('sha256').update(bytes).digest('hex'),credit.sha256);
assert.equal(bytes.length,credit.bytes);assert(bytes.length<3_000_000,'complete detailed model payload stays bounded');
assert(fs.readFileSync('public/gltf/rocketbox-LICENSE.txt','utf8').includes('Copyright (c) 2020 Microsoft'));
const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
assert(json.meshes.every(m=>m.extras.targetNames.length===67));
assert(json.accessors.some(a=>a.sparse),'actual converted model preserves sparse facial storage');
assert.equal(json.meshes.flatMap(m=>m.primitives).reduce((n,p)=>n+json.accessors[p.indices].count/3,0),7581);
assert.equal(json.skins[0].joints.length,80);
// Keep actual geometry, morph deltas, skeleton and clips; omit only image decoding
// for deterministic Node verification. Browser checks use the full textured GLB.
for(const material of json.materials){delete material.normalTexture;delete material.occlusionTexture;delete material.emissiveTexture;if(material.pbrMetallicRoughness){delete material.pbrMetallicRoughness.baseColorTexture;delete material.pbrMetallicRoughness.metallicRoughnessTexture;}}
delete json.images;delete json.textures;delete json.samplers;
const jsonBytes=Buffer.from(JSON.stringify(json));const padding=(4-jsonBytes.length%4)%4;
const chunk=Buffer.concat([jsonBytes,Buffer.alloc(padding,32)]);
const bin=bytes.subarray(20+bytes.readUInt32LE(12));
const head=Buffer.alloc(20);head.writeUInt32LE(0x46546c67,0);head.writeUInt32LE(2,4);head.writeUInt32LE(20+chunk.length+bin.length,8);head.writeUInt32LE(chunk.length,12);head.writeUInt32LE(0x4e4f534a,16);
const headless=Buffer.concat([head,chunk,bin]);
const parse=()=>new GLTFLoader().parseAsync(headless.buffer.slice(headless.byteOffset,headless.byteOffset+headless.byteLength),'');
const gltf=await parse();
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const asUrl=source=>'data:text/javascript;base64,'+Buffer.from(compile(source)).toString('base64');
const controllerUrl=asUrl(fs.readFileSync('src/avatarAnimations.ts','utf8').replace("from 'three'",'from '+JSON.stringify(import.meta.resolve('three'))));
const animationApi=await import(controllerUrl);
const faceSource=fs.readFileSync('src/companionFace.ts','utf8');
const{companionFace}=await import(asUrl(faceSource));
const face=companionFace(gltf.scene);assert(face.available);
const meshes=[];gltf.scene.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o);});
for(const mesh of meshes){
 assert.equal(mesh.morphTargetInfluences.length,67);
 for(const key of ['position','normal','skinIndex','skinWeight'])assert(Array.from(mesh.geometry.attributes[key].array).every(Number.isFinite),'finite '+key);
 for(const target of mesh.geometry.morphAttributes.position)assert(Array.from(target.array).every(Number.isFinite));
}
const expressive=meshes.find(m=>m.geometry.morphAttributes.position[m.morphTargetDictionary.AA_VI_10_aa].array.some(v=>Math.abs(v)>.0001));
assert(expressive,'real mouth viseme changes surface geometry');
face.update(.1,true,.4);assert(expressive.morphTargetInfluences[expressive.morphTargetDictionary.AA_VI_10_aa]>.2);
for(let i=0;i<30;i++)face.update(1/60,false);assert(expressive.morphTargetInfluences[expressive.morphTargetDictionary.AA_VI_10_aa]<.001,'mouth closes after narration');
face.reset();for(let i=0;i<334;i++)face.update(1/60,false);assert(expressive.morphTargetInfluences[expressive.morphTargetDictionary.AK_09_EyeBlinkLeft]>.9,'authored eyelid target blinks');
face.reset();assert(meshes.every(m=>m.morphTargetInfluences.every(v=>v===0)),'reset clears authored cues');
let loads=[];globalThis.__labLoader=class{load(path,resolve,_progress,reject){loads.push(path);if(path==='/gltf/lab-companion.glb')parse().then(resolve,reject);else reject(Error('unexpected legacy request'));}};
const humanSource=fs.readFileSync('src/humanCompanion.ts','utf8')
 .replace("import * as THREE from 'three';",'import * as THREE from '+JSON.stringify(import.meta.resolve('three'))+';')
 .replace("import {GLTFLoader,type GLTF} from 'three/examples/jsm/loaders/GLTFLoader.js';",'const GLTFLoader=globalThis.__labLoader;')
 .replace("from './companionFace'",'from '+JSON.stringify(asUrl(faceSource)))
 .replace("from './avatarAnimations'",'from '+JSON.stringify(controllerUrl))
 .replace("from './companionAnimation'",'from '+JSON.stringify(asUrl(fs.readFileSync('src/companionAnimation.ts','utf8').replace("from 'three'",'from '+JSON.stringify(import.meta.resolve('three'))))));
const {loadHumanCompanion}=await import(asUrl(humanSource));
const root=new THREE.Group();const companion=await loadHumanCompanion(root,0,()=>{});companion.holder.visible=true;
assert.deepEqual(loads,['/gltf/lab-companion.glb'],'detailed file includes all native clips without legacy downloads');
assert.equal(companion.modelKind,'rocketbox');assert(companion.facialControls);assert.deepEqual(companion.limitations,[]);
const transforms=[];companion.holder.traverse(o=>{if(o.isBone)transforms.push({bone:o,position:o.position.clone(),scale:o.scale.clone()});});
const preserve=()=>{for(const {bone,position,scale} of transforms){assert(bone.position.distanceTo(position)<1e-8,bone.name+' attachment');assert(bone.scale.distanceTo(scale)<1e-8,bone.name+' scale');}};
let time=0;const advance=(duration,enabled=true)=>{for(let i=0;i<Math.ceil(duration*60);i++){time+=1/60;companion.update(time,enabled,0);preserve();}};
companion.update(0,true,0);assert(companion.wave());advance(2.2);assert(companion.isWaving());advance(.8);assert(!companion.isWaving(),'native greeting completion');
assert(companion.wave());root.userData.walking=true;advance(.3);assert(!companion.isWaving());assert.equal(companion.wave(),false);
const calf=root.getObjectByName('Bip01_L_Calf'),before=calf.quaternion.clone();let gaitRange=0;for(let i=0;i<65;i++){advance(1/60);gaitRange=Math.max(gaitRange,before.angleTo(calf.quaternion));}assert(gaitRange>.05,'actual native gait moves the knee across a full cycle');
const paused=calf.quaternion.clone();advance(.5,false);assert.deepEqual(calf.quaternion.toArray(),paused.toArray(),'motion preference pauses rich rig');
root.userData.walking=false;advance(.3);root.userData.narrating=true;advance(.2);
let open=0;companion.holder.traverse(o=>{if(o.isMesh&&o.morphTargetDictionary)open=Math.max(open,o.morphTargetInfluences[o.morphTargetDictionary.AA_VI_10_aa]||0);});assert(open>.1,'local speech-state cue reaches actual morphs');
root.userData.narrating=false;advance(.5);companion.reset();
companion.holder.traverse(o=>{if(o.isMesh&&o.morphTargetInfluences)assert(o.morphTargetInfluences.every(v=>v===0));});
assert.equal(animationApi.getAvatarAnimationOptions('human').length,5);
assert(animationApi.getAvatarAnimationOptions('human').every(o=>o.availability==='ready'),'all five compatible research previews are resident');
assert(await animationApi.playAvatarAnimation('human','nod'));const headBone=root.getObjectByName('Bip01_Head'),beforeNod=headBone.quaternion.clone();advance(.22);assert(beforeNod.angleTo(headBone.quaternion)>.01);advance(1.5);
assert.equal(animationApi.getAvatarAnimationSnapshot('human').phase,'idle','nod completes without a stuck bind pose');
assert(await animationApi.playAvatarAnimation('human','explain'));advance(.25);
const demoMouth=()=>{let result=0;companion.holder.traverse(o=>{if(o.isMesh&&o.morphTargetDictionary)result=Math.max(result,o.morphTargetInfluences[o.morphTargetDictionary.AA_VI_10_aa]||0);});return result;};
assert(demoMouth()>.1,'silent illustrative demo has real facial cues');
advance(.15,false);const pausedHead=headBone.quaternion.clone(),pausedMouth=demoMouth();advance(.3,false);
assert.equal(animationApi.getAvatarAnimationSnapshot('human').phase,'paused');assert.deepEqual(headBone.quaternion.toArray(),pausedHead.toArray());assert.equal(demoMouth(),pausedMouth);
animationApi.stopAvatarAnimation('human');
assert.equal(demoMouth(),0,'Stop while paused immediately neutralizes the demonstration face');
assert.equal(animationApi.getAvatarAnimationSnapshot('human').activeId,null);advance(.2);
assert(await animationApi.playAvatarAnimation('human','walk'));root.userData.narrating=true;root.userData.walking=true;advance(.3);
assert.equal(animationApi.getAvatarAnimationSnapshot('human').phase,'busy');assert.equal(animationApi.getAvatarAnimationSnapshot('human').activeId,null,'actual navigation cancels in-place preview during narration');
root.userData.walking=false;root.userData.narrating=false;advance(.3);companion.reset();
assert(root.position.length()===0,'native gait never moves the navigation root');
console.log('PASS pinned MIT asset, 7581 triangles, 80-joint skin, 67 actual facial targets, bounded sparse payload, all five compatible previews, preserved anatomy, greeting/walk arbitration, exact preview pause, paused Stop neutral face, blink/speech-state/reset and independent navigation root');
