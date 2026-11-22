import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {FBXLoader} from 'three/examples/jsm/loaders/FBXLoader.js';
import {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js';
import {NodeIO} from '@gltf-transform/core';
import {dedup,weld,prune,sparse,resample,join} from '@gltf-transform/functions';
// Fetch the pinned MIT sources and prepare their images first with
// scripts/prepare-rocketbox-companion.py. No Blender or new runtime dependency.
const source=(process.argv[2]||'.tmp/deep-avatar/rocketbox-source').replace(/\/$/,'')+'/';
const destination=process.argv[3]||'public/gltf/lab-companion.glb';
const credit=JSON.parse(fs.readFileSync('public/gltf/lab-companion.credit.json','utf8'));
for(const entry of credit.sourceFiles){
 const data=fs.readFileSync(source+entry.local);
 if(createHash('sha256').update(data).digest('hex')!==entry.sha256)throw Error('Pinned source hash mismatch: '+entry.local);
}
// Geometry import in Node: textures are attached from the converted PNGs below.
THREE.TextureLoader.prototype.load=function(){return new THREE.Texture();};
globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(buffer=>{this.result=buffer;this.onloadend?.();});}};
const parse=name=>{const b=fs.readFileSync(source+name+'.fbx');return new FBXLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');};
const model=parse('model');let body;
model.traverse(o=>{if(o.isMesh){body=o;const entries=Object.entries(o.morphTargetDictionary).filter(([name])=>name.includes('.AK_')||name.includes('.AA_VI_'));o.geometry.morphAttributes.position=entries.map(([,i])=>o.geometry.morphAttributes.position[i]);o.morphTargetDictionary=Object.fromEntries(entries.map(([name],i)=>[name.slice(name.indexOf('.')+1),i]));o.morphTargetInfluences=entries.map(()=>0);for(const attribute of o.geometry.morphAttributes.position)for(let i=0;i<attribute.array.length;i++)if(Math.abs(attribute.array[i])<1e-4)attribute.array[i]=0;o.material=[o.material].flat().map(m=>new THREE.MeshStandardMaterial({name:m.name,color:0xffffff,roughness:m.name.includes('opacity')?.75:.88,metalness:0,transparent:false,alphaTest:m.name.includes('opacity')?.45:0,side:m.name.includes('opacity')?THREE.DoubleSide:THREE.FrontSide}));}});
model.animations=['idle','walk','wave'].map((name,i)=>{const clip=parse(name).animations[0].clone();clip.name=['Idle_Subtle','Walk','Greeting'][i];clip.tracks=clip.tracks.filter(t=>t.name.endsWith('.quaternion')&&model.getObjectByName(t.name.slice(0,-11)));return clip;});
model.name='Rocketbox_Lab_Companion';model.userData={source:'Microsoft Rocketbox Medical_Male_01',license:'MIT',sourceRevision:'0943055db6ec570bcef9f2c8b41c9e5467c808f9',facialTargets:67};
const data=await new GLTFExporter().parseAsync(model,{binary:true,animations:model.animations,trs:true});
const io=new NodeIO();const doc=await io.readBinary(new Uint8Array(data));
for(const material of doc.getRoot().listMaterials()){
 const type=material.getName().includes('body')?'body':material.getName().includes('head')?'head':'opacity';
 const png=fs.readFileSync(source+'m152_'+type+(type==='opacity'?'_color_512.png':'_color.jpg'));
 const texture=doc.createTexture('Rocketbox '+type+' color').setImage(png).setMimeType(type==='opacity'?'image/png':'image/jpeg');material.setBaseColorTexture(texture);
 if(type==='head')material.setNormalTexture(doc.createTexture('Rocketbox head normal').setImage(fs.readFileSync(source+'m152_head_normal.png')).setMimeType('image/png'));
}
await doc.transform(dedup(),weld(),join(),resample(),prune(),sparse());
const output=await io.writeBinary(doc);fs.writeFileSync(destination,output);
const report={bytes:output.length,triangles:body.geometry.attributes.position.count/3,morphs:Object.keys(body.morphTargetDictionary),animations:model.animations.map(c=>({name:c.name,duration:c.duration,tracks:c.tracks.length})),primitives:doc.getRoot().listMeshes().flatMap(m=>m.listPrimitives().map(p=>({material:p.getMaterial().getName(),vertices:p.getAttribute('POSITION').getCount(),indices:p.getIndices()?.getCount(),targets:p.listTargets().length}))),textures:doc.getRoot().listTextures().map(t=>({name:t.getName(),bytes:t.getImage().length}))};
fs.writeFileSync(source+'converted-inspection.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
