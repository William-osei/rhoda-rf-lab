import type {Intersection,Object3D,Raycaster,Material,Mesh} from 'three';

/** Three raycasting does not exclude an invisible mesh or invisible ancestor. */
export function visibleRayHit(hit:Intersection<Object3D>){
 for(let node:Object3D|null=hit.object;node;node=node.parent)if(!node.visible)return false;
 const material=(hit.object as Mesh).material as Material|Material[]|undefined;
 if(Array.isArray(material)){
  const index=hit.face?.materialIndex;
  return index===undefined?material.some(m=>m.visible):!!material[index]?.visible;
 }
 return !material||material.visible;
}

/** The first visible surface may occlude a selectable surface behind it. */
export function firstVisibleRayHit(ray:Raycaster,roots:Object3D[]){
 return ray.intersectObjects(roots,true).find(visibleRayHit)||null;
}

export function rayHitKind(hit:Intersection<Object3D>,dashboard?:Object3D):'dashboard'|'interactable'|null{
 let interactable=false;
 for(let node:Object3D|null=hit.object;node;node=node.parent){
  if(node===dashboard||node.userData.isDashboard)return 'dashboard';
  if(node.userData.interactable)interactable=true;
 }
 return interactable?'interactable':null;
}

export function rayHitBelongsTo(hit:Intersection<Object3D>,roots:Object3D[]){
 for(let node:Object3D|null=hit.object;node;node=node.parent)if(roots.includes(node))return true;
 return false;
}
