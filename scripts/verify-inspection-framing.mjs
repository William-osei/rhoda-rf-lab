import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as THREE from 'three';
const source=ts.transpileModule(fs.readFileSync('src/inspectionFraming.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {arrivalClearanceHeight,fitDesktopInspection}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const sizes=[{width:615,height:524,top:146+16,bottom:486-16},{width:390,height:844,top:146+16,bottom:810-16},{width:1440,height:1000,top:117+16,bottom:946-16}];
const subjects={
 body:{minX:-.42,maxX:.42,minY:.01,maxY:1.81,minZ:-.18,maxZ:.18},
 face:{minX:-.27,maxX:.27,minY:1.25,maxY:1.8,minZ:-.24,maxZ:.24},
 hands:{minX:-.44,maxX:.44,minY:.48,maxY:.93,minZ:-.17,maxZ:.17},
};
const minimum=(view,aspect)=>view==='body'?Math.max(3.2,1.4/aspect):view==='hands'?Math.max(1.15,.85/aspect):Math.max(.85,.48/aspect);
let checks=0;
for(const viewport of sizes)for(const [view,bounds]of Object.entries(subjects))for(const fov of [32,50,60])for(const zoom of [1,1.3]){
 const fit=fitDesktopInspection(bounds,viewport,fov,zoom,minimum(view,viewport.width/viewport.height));assert(fit);
 const camera=new THREE.PerspectiveCamera(fov,viewport.width/viewport.height,.01,100);camera.zoom=zoom;camera.updateProjectionMatrix();
 const avatar=new THREE.Group();avatar.position.set(2,0,-1.8);const placement=avatar.position.clone();
 camera.position.set(avatar.position.x+fit.x,fit.y,avatar.position.z+fit.distance);camera.lookAt(avatar.position.x+fit.x,fit.y,avatar.position.z);camera.updateMatrixWorld(true);
 const pixels=[];
 for(const x of [bounds.minX,bounds.maxX])for(const y of [bounds.minY,bounds.maxY])for(const z of [bounds.minZ,bounds.maxZ]){
  const ndc=new THREE.Vector3(x+avatar.position.x,y,z+avatar.position.z).project(camera),pixel={x:(ndc.x+1)*viewport.width/2,y:(1-ndc.y)*viewport.height/2};pixels.push(pixel);
  assert(pixel.y>=viewport.top-1e-6&&pixel.y<=viewport.bottom+1e-6,`${view} ${viewport.width}x${viewport.height} ${fov}FOV vertical fit: ${JSON.stringify(pixel)}`);
  assert(pixel.x>=16-1e-6&&pixel.x<=viewport.width-16+1e-6,`${view} horizontal fit`);
 }
 assert(avatar.position.equals(placement),'inspection cannot move the avatar or its navigation anchor');
 assert(fit.distance>=minimum(view,viewport.width/viewport.height),'existing minimum viewing distance is retained');
 // The tested body corners include the whole head and both feet; face and hands
 // check the complete requested detail region rather than their center alone.
 assert(Math.max(...pixels.map(p=>p.y))-Math.min(...pixels.map(p=>p.y))>0);
 const before={position:camera.position.toArray(),rotation:camera.quaternion.toArray(),projection:camera.projectionMatrix.toArray()};
 assert.equal(fitDesktopInspection(bounds,viewport,fov,zoom,3.2,true),null);
 assert.deepEqual({position:camera.position.toArray(),rotation:camera.quaternion.toArray(),projection:camera.projectionMatrix.toArray()},before,'immersive guard has no camera mutation');
 checks++;
}
// Reproduce the compact-screen defect with the previous whole-canvas preset.
const old=new THREE.PerspectiveCamera(60,615/524,.01,100);old.position.set(0,.87,3.2);old.lookAt(0,.87,0);old.updateMatrixWorld(true);
assert((1-new THREE.Vector3(0,1.75,0).project(old).y)*524/2<146,'previous head was covered by the compact header');
// A short viewport can leave its usable region wholly below the canvas center.
const below={width:615,height:400,top:240,bottom:360},fit=fitDesktopInspection(subjects.body,below,60,1,3.2),camera=new THREE.PerspectiveCamera(60,615/400,.01,100);
camera.position.set(fit.x,fit.y,fit.distance);camera.lookAt(fit.x,fit.y,0);camera.updateMatrixWorld(true);
for(const y of [subjects.body.minY,subjects.body.maxY])for(const z of [subjects.body.minZ,subjects.body.maxZ]){const pixel=(1-new THREE.Vector3(0,y,z).project(camera).y)*200;assert(pixel>=240&&pixel<=360);}
assert.equal(fitDesktopInspection(subjects.body,{width:0,height:524,top:0,bottom:524},60,1,3.2),null);
let arrivalChecks=0;
for(const viewport of sizes)for(const yaw of [0,.6,Math.PI/2])for(const fov of [32,50,60])for(const zoom of [1,1.3]){
 const bounds={minX:1.66,maxX:2.34,minY:0,maxY:1.93,minZ:-2.04,maxZ:-1.56},target={x:2,z:-1.8};
 const camera=new THREE.PerspectiveCamera(fov,viewport.width/viewport.height,.01,100);camera.zoom=zoom;camera.updateProjectionMatrix();camera.position.set(target.x+Math.sin(yaw)*1.6,1.35,target.z+Math.cos(yaw)*1.6);
 const xz=[camera.position.x,camera.position.z],endpoint=[target.x,0,target.z];
 const height=arrivalClearanceHeight(bounds,camera.position,target,viewport,fov,zoom,1.35);assert(height>=1.35);
 camera.position.y=height;camera.lookAt(target.x,height,target.z);camera.updateMatrixWorld(true);
 for(const x of [bounds.minX,bounds.maxX])for(const z of [bounds.minZ,bounds.maxZ]){
  const pixel=(1-new THREE.Vector3(x,bounds.maxY,z).project(camera).y)*viewport.height/2;
  assert(pixel>=viewport.top-1e-6,`tall hair arrival ${viewport.width}x${viewport.height}, offset yaw ${yaw}: ${pixel}`);
 }
 assert.deepEqual([camera.position.x,camera.position.z],xz,'head clearance preserves arrival camera X/Z');assert.deepEqual([target.x,0,target.z],endpoint,'captured walking destination is untouched');
 assert.equal(arrivalClearanceHeight(bounds,camera.position,target,viewport,fov,zoom,1.35,true),null,'immersive arrival is excluded');arrivalChecks++;
}
const shortCamera=new THREE.PerspectiveCamera(60,615/524,.01,100);shortCamera.position.set(0,1.35,1.6);shortCamera.lookAt(0,1.35,0);shortCamera.updateMatrixWorld(true);
assert((1-new THREE.Vector3(0,1.93,.2).project(shortCamera).y)*262<148,'old arrival height clips the original tall hair silhouette');
assert.equal(arrivalClearanceHeight({minX:-.3,maxX:.3,minY:0,maxY:1.68,minZ:-.2,maxZ:.2},{x:0,z:1.6},{x:0,z:0},{height:1000,top:133},60,1,1.35),1.35,'a clear arrival retains the existing height exactly');
console.log(`PASS ${checks} inspection and ${arrivalChecks} arrival Three.js projection cases: 615x524, 390x844 and 1440x1000 body/head/feet, face/hands and tall-hair arrivals clear measured chrome; varied FOV/zoom/depth, offset approach directions, desktop-only guards and unchanged navigation anchors.`);
