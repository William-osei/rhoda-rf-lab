import {Mesh,type BufferGeometry,type Group,type Material} from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Merge only static mesh siblings; animated eyes, fingers and limb pivots stay
 * in their own groups. This reduces draw calls without merging articulation.
 */
export function batchRigidAvatarParts(root:Group){
 const before=new Set<BufferGeometry>();
 root.traverse(node=>{if((node as Mesh).isMesh)before.add((node as Mesh).geometry);});
 const groups:Group[]=[];root.traverse(node=>{if((node as Group).isGroup)groups.push(node as Group);});
 for(const group of groups){
  const buckets=new Map<string,Mesh<BufferGeometry,Material>[]>();
  for(const node of group.children){
   const mesh=node as Mesh<BufferGeometry,Material>;
   if(!mesh.isMesh||Array.isArray(mesh.material)||!mesh.visible||mesh.morphTargetInfluences)continue;
   const attributes=Object.keys(mesh.geometry.attributes).sort().map(key=>key+':'+mesh.geometry.getAttribute(key).itemSize).join(',');
   const key=[mesh.material.uuid,!!mesh.geometry.index,attributes,mesh.castShadow,mesh.receiveShadow,mesh.renderOrder].join('|');
   const bucket=buckets.get(key)||[];bucket.push(mesh);buckets.set(key,bucket);
  }
  for(const meshes of buckets.values()){
   if(meshes.length<2)continue;
   const transformed=meshes.map(mesh=>{mesh.updateMatrix();return mesh.geometry.clone().applyMatrix4(mesh.matrix);});
   const geometry=mergeGeometries(transformed,false);transformed.forEach(buffer=>buffer.dispose());
   if(!geometry)continue;
   geometry.computeBoundingBox();geometry.computeBoundingSphere();
   const first=meshes[0],batch=new Mesh(geometry,first.material);
   batch.name='Rigid '+(group.name||'avatar')+' parts';batch.userData={...first.userData};
   batch.castShadow=first.castShadow;batch.receiveShadow=first.receiveShadow;batch.renderOrder=first.renderOrder;
   meshes.forEach(mesh=>group.remove(mesh));group.add(batch);
  }
 }
 const used=new Set<BufferGeometry>();root.traverse(node=>{if((node as Mesh).isMesh)used.add((node as Mesh).geometry);});
 // Some meshes share buffers. Retire only those no remaining part uses.
 before.forEach(buffer=>{if(!used.has(buffer))buffer.dispose();});
}
