import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
const code=ts.transpileModule(fs.readFileSync('src/companionAnimation.ts','utf8').replace("from 'three'",'from '+JSON.stringify(import.meta.resolve('three'))),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {companionAnimation}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const b=fs.readFileSync('public/gltf/research-companion.glb'),data=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));
const target=new THREE.Group();data.nodes.forEach(node=>{const bone=new THREE.Object3D();bone.name=node.name;if(node.rotation)bone.quaternion.fromArray(node.rotation);target.add(bone);});
let divergentAttachments=0;
for(const name of ['companion-motions','companion-walk']){
 const bytes=fs.readFileSync('public/gltf/'+name+'.glb');
 const loaded=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 for(const source of loaded.animations){
  const original=source.tracks.map(track=>({name:track.name,values:Array.from(track.values)}));
  for(const track of source.tracks.filter(track=>track.name.endsWith('.position'))){
   const node=data.nodes.find(node=>node.name===track.name.slice(0,-9));
   if(node?.translation&&Math.hypot(...node.translation.map((v,i)=>v-track.values[i]))>.001)divergentAttachments++;
  }
  const clip=companionAnimation(source,target,loaded.scene);
  assert(clip&&clip.duration===source.duration&&clip.name===source.name);
  assert(clip.tracks.length>50&&clip.tracks.every(track=>track.name.endsWith('.quaternion')));
  assert.deepEqual(source.tracks.map(track=>({name:track.name,values:Array.from(track.values)})),original,'bundled source remains untouched');
 }
}
assert(divergentAttachments>=150,'actual source rigs have different joint attachment positions');
const malformed=new THREE.AnimationClip('incompatible',1,[new THREE.QuaternionKeyframeTrack('missing.quaternion',[0,1],[0,0,0,1,0,0,0,1]),new THREE.VectorKeyframeTrack('head.position',[0,1],[0,0,0,0,0,0])]);
assert.equal(companionAnimation(malformed,target,target),null);
assert.equal(companionAnimation(undefined,target,target),null);
const reference=new THREE.Group(),sourceBone=new THREE.Object3D(),targetBone=new THREE.Object3D();sourceBone.name=targetBone.name='testJoint';sourceBone.rotation.x=.7;targetBone.rotation.z=-.4;reference.add(sourceBone);target.add(targetBone);
const stationary=new THREE.AnimationClip('rest',1,[new THREE.QuaternionKeyframeTrack('testJoint.quaternion',[0,1],[...sourceBone.quaternion.toArray(),...sourceBone.quaternion.toArray()])]);
const retargeted=companionAnimation(stationary,target,reference);
assert(new THREE.Quaternion().fromArray(retargeted.tracks[0].values).angleTo(targetBone.quaternion)<1e-7,'a source rest pose maps exactly to the target rest orientation');
console.log('PASS actual three bundled clips preserve duration and source data, eliminate '+divergentAttachments+' mismatched bone attachments, and reject incompatible channels');
