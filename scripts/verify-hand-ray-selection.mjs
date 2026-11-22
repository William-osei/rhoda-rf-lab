import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as THREE from 'three';
const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64');
const pickingUrl=moduleUrl(fs.readFileSync('src/raySelection.ts','utf8'));
const {firstVisibleRayHit,visibleRayHit,rayHitKind}=await import(pickingUrl);
let clock=1000;globalThis.performance={now:()=>clock};
globalThis.__rayCreateSystem=()=>class {constructor(world){this.world=world;this.scene=world.scene;this.renderer=world.renderer;}};
let source=fs.readFileSync('src/handRay.ts','utf8')
 .replace('import { createSystem } from "@iwsdk/core";','const createSystem=globalThis.__rayCreateSystem;')
 .replace("from 'three';",'from '+JSON.stringify(import.meta.resolve('three'))+';')
 .replace("from './raySelection';",'from '+JSON.stringify(pickingUrl)+';');
const {HandRaySystem}=await import(moduleUrl(source));
function box(x,z,selectable=true){const mesh=new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.2),new THREE.MeshBasicMaterial());mesh.position.set(x,0,z);if(selectable)mesh.userData.interactable=true;return mesh;}
const root=new THREE.Group(),hidden=new THREE.Group(),visible=box(0,-2),hiddenMesh=box(0,-.7);hidden.add(hiddenMesh);hidden.visible=false;root.add(hidden,visible);root.updateMatrixWorld(true);
const ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,0,-1),0,3);
assert.equal(ray.intersectObject(root,true)[0].object,hiddenMesh,'regression reproduces Three intersecting an invisible ancestor');
assert.equal(firstVisibleRayHit(ray,[root]).object,visible,'invisible alternative cannot steal selection');
hidden.visible=true;hiddenMesh.visible=false;assert.equal(firstVisibleRayHit(ray,[root]).object,visible);
hiddenMesh.visible=true;hiddenMesh.material.visible=false;assert.equal(firstVisibleRayHit(ray,[root]).object,visible);
hiddenMesh.material.visible=true;assert.equal(firstVisibleRayHit(ray,[root]).object,hiddenMesh);
const blocker=box(0,-1,false);root.add(blocker);hidden.visible=false;root.updateMatrixWorld(true);
assert.equal(rayHitKind(firstVisibleRayHit(ray,[root])),null,'visible nonselectable wall occludes avatar');
const synthetic={object:visible,face:{materialIndex:1}};visible.material=[new THREE.MeshBasicMaterial(),new THREE.MeshBasicMaterial({visible:false})];
assert.equal(visibleRayHit(synthetic),false,'hit material, not another material on same mesh, controls visibility');
visible.material=new THREE.MeshBasicMaterial();

const scene=new THREE.Scene(),avatarRoot=new THREE.Group(),dashboard=new THREE.Group();
const leftMesh=box(-1,-1.5),rightMesh=box(1,-1.5,false);avatarRoot.add(leftMesh);dashboard.add(rightMesh);scene.add(avatarRoot,dashboard);scene.updateMatrixWorld(true);
const left={handedness:'left',targetRaySpace:{}},right={handedness:'right',targetRaySpace:{},gripSpace:{}};
let session={inputSources:[left,right]},poseAvailable=true;
const usedSpaces=[];
const referenceSpace={},frame={getPose(space,reference){usedSpaces.push(space);assert.equal(reference,referenceSpace);if(!poseAvailable)return null;return {transform:{position:{x:space===left.targetRaySpace?-1:1,y:0,z:0},orientation:{x:0,y:0,z:0,w:1}}};}};
const world={scene,rhodeSchwarzMesh:avatarRoot,dashboardAnchor:dashboard,renderer:{xr:{getSession:()=>session,getFrame:()=>frame,getReferenceSpace:()=>referenceSpace}}};
const system=new HandRaySystem(world);system.init();system.update(1/60,0);
assert.deepEqual(usedSpaces,[left.targetRaySpace,right.targetRaySpace],'target-ray pose used, including hand without grip');
assert.equal(world.handRaySelections.size,2);
assert.equal(world.lastRhodeSchwarzIntersect,null,'ambiguous legacy selection does not choose another hand');
assert(HandRaySystem.prepareSelect(world,left));assert.equal(world.lastRhodeSchwarzIntersect.object,leftMesh);assert.equal(world.lastDashboardIntersect,null);
assert(HandRaySystem.prepareSelect(world,right));assert.equal(world.lastDashboardIntersect.object,rightMesh);assert.equal(world.lastRhodeSchwarzIntersect,null);
assert.equal(system.leftRay.material.color.getHex(),0xffff00);assert.equal(system.rightRay.material.color.getHex(),0x00ff00,'pointer feedback is independent');
assert(system.leftRay.scale.z<1&&system.leftRay.scale.z>0,'ray stops at visible surface');
avatarRoot.visible=false;assert.equal(HandRaySystem.prepareSelect(world,left),false,'hiding ancestor invalidates cached hit immediately');assert.equal(world.lastRhodeSchwarzIntersect,null);
avatarRoot.visible=true;clock+=251;assert.equal(HandRaySystem.prepareSelect(world,right),false,'expired hit cannot select');
clock+=1;system.update(1/60,0);scene.remove(dashboard);world.dashboardAnchor=undefined;
assert.equal(HandRaySystem.prepareSelect(world,right),false,'detached target invalidates cached hit');
scene.add(dashboard);world.dashboardAnchor=dashboard;poseAvailable=false;system.update(1/60,0);
assert.equal(world.handRaySelections.size,0);assert.equal(system.leftRay.visible,false);assert.equal(system.rightRay.visible,false);assert.equal(HandRaySystem.prepareSelect(world,left),false,'lost tracking clears stale selection');
poseAvailable=true;session={inputSources:[left]};system.update(1/60,0);assert.equal(world.handRaySelections.size,1);assert(HandRaySystem.prepareSelect(world));assert.equal(world.lastRhodeSchwarzIntersect.object,leftMesh);
const wrong={handedness:'left'};assert.equal(HandRaySystem.prepareSelect(world,wrong),false,'unrecognized source never borrows another hit');
leftMesh.position.z=-4;scene.updateMatrixWorld(true);system.update(1/60,0);assert.equal(world.handRaySelections.size,0,'objects past the 3 metre visible ray are excluded');
leftMesh.position.z=-1.5;scene.updateMatrixWorld(true);system.update(1/60,0);session=null;
assert.equal(HandRaySystem.prepareSelect(world,left),false,'ended session invalidates cached hit');system.update(1/60,0);assert.equal(system.leftRay.visible,false);
let disposed=0;for(const pointer of [system.leftRay,system.rightRay]){pointer.geometry.addEventListener('dispose',()=>disposed++);pointer.material.addEventListener('dispose',()=>disposed++);}
system.cleanup();assert.equal(disposed,4);assert.equal(world.handRaySelections.size,0);
console.log('PASS real Three visible-ancestor/material filtering, wall occlusion, target-ray pose, per-hand selection/feedback, freshness, hiding/detachment, tracking/session loss, 3 m range and resource cleanup; mocked XR, no headset verification');
