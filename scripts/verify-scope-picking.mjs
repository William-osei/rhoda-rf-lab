import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as THREE from 'three';

const source=ts.transpileModule(fs.readFileSync('src/scopePicking.ts','utf8'),{
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},
}).outputText;
const {pickScopeControl}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
const enclosure=new THREE.Mesh(new THREE.BoxGeometry(1.5,.86,.39),material);
const front=new THREE.Mesh(new THREE.BoxGeometry(.05,.05,.03),material);front.position.set(.377,.13,.267);
const rear=new THREE.Mesh(new THREE.BoxGeometry(.15,.09,.025),material);rear.position.set(-.48,-.08,-.21);
const root=new THREE.Group();root.add(enclosure,front,rear);root.updateMatrixWorld(true);
const ray=new THREE.Raycaster();
ray.set(new THREE.Vector3(.377,.13,2),new THREE.Vector3(0,0,-1));
assert.equal(pickScopeControl(ray,[front,rear],[enclosure])?.object,front,'visible front control remains clickable');
ray.set(new THREE.Vector3(.377,.13,-2),new THREE.Vector3(0,0,1));
assert.equal(ray.intersectObjects([front,rear])[0]?.object,front,'regression ray intersects a hidden front control');
assert.equal(pickScopeControl(ray,[front,rear],[enclosure]),null,'enclosure blocks hidden front controls from the rear');
ray.set(new THREE.Vector3(-.48,-.08,-2),new THREE.Vector3(0,0,1));
assert.equal(pickScopeControl(ray,[front,rear],[enclosure])?.object,rear,'visible rear port remains selectable');
ray.set(new THREE.Vector3(-.48,-.08,2),new THREE.Vector3(0,0,-1));
assert.equal(pickScopeControl(ray,[front,rear],[enclosure]),null,'enclosure blocks rear ports from the front');
ray.set(new THREE.Vector3(3,3,2),new THREE.Vector3(0,0,-1));
assert.equal(pickScopeControl(ray,[front,rear],[enclosure]),null,'empty space has no selection');
root.traverse(object=>{object.geometry?.dispose();});material.dispose();
console.log('PASS actual Three.js rays: visible front/rear controls, enclosure occlusion and empty space');
