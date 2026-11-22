import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as THREE from 'three';

// Exercise the constructed procedural rig without a browser or GPU. Only browser
// controls and the independently loaded human asset are replaced with inert stubs.
const stored = new Map();
globalThis.localStorage = {
  getItem: key => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
  removeItem: key => stored.delete(key),
};
const controls = new Map();
function element(id) {
  if (!controls.has(id)) controls.set(id, {
    disabled: false, value: '', textContent: '', checked: false,
    setAttribute() {}, toggleAttribute() {}, contains() { return false; },
    focus() {}, querySelector() { return element('human-option'); },
  });
  return controls.get(id);
}
globalThis.document = { getElementById: element, activeElement: null };
globalThis.window = {
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  setTimeout() {}, dispatchEvent() {},
};
globalThis.CustomEvent = class {};

const compile = text => ts.transpileModule(text, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const moduleUrl = text => 'data:text/javascript;base64,' + Buffer.from(compile(text)).toString('base64');
const batch=fs.readFileSync('src/rigidAvatarBatch.ts','utf8').replace("from 'three'",'from '+JSON.stringify(import.meta.resolve('three'))).replace("from 'three/examples/jsm/utils/BufferGeometryUtils.js'",'from '+JSON.stringify(import.meta.resolve('three/examples/jsm/utils/BufferGeometryUtils.js')));
let source = fs.readFileSync('src/avatarStyle.ts', 'utf8');
source = source
  .replace("import { loadHumanCompanion } from './humanCompanion';", 'const loadHumanCompanion = () => new Promise(() => {});')
  .replace("from './robotMotion'", 'from ' + JSON.stringify(moduleUrl(fs.readFileSync('src/robotMotion.ts', 'utf8'))))
  .replace("from './rigidAvatarBatch'",'from '+JSON.stringify(moduleUrl(batch)))
  .replace("from 'three';", 'from ' + JSON.stringify(import.meta.resolve('three')) + ';')
  .replace("from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';", 'from ' + JSON.stringify(import.meta.resolve('three/examples/jsm/geometries/RoundedBoxGeometry.js')) + ';');
const avatar = await import(moduleUrl(source));

const root = new THREE.Group();
root.add(new THREE.Mesh(new THREE.BoxGeometry(.2, 1.68, .2), new THREE.MeshBasicMaterial()));
avatar.installAvatarStyles(root, () => {});
avatar.setAvatar('robot');
const robot = root.getObjectByName('RHODA_MasculineAndroid');
const hips = [-1, 1].map(side => root.getObjectByName('Android hip ' + side));
const knees = [-1, 1].map(side => root.getObjectByName('Android knee ' + side));
const ankles = [-1, 1].map(side => root.getObjectByName('Android ankle ' + side));
assert(robot && hips.every(Boolean) && knees.every(Boolean) && ankles.every(Boolean), 'constructed joint hierarchy exists');
assert(knees.every((knee, index) => knee.parent === hips[index]), 'knees follow their hips');
assert(ankles.every((ankle, index) => ankle.parent === knees[index]), 'ankles follow their knees');

avatar.updateAvatarVisual(0);
avatar.turnRobot();
for (let frame = 1; frame <= 60; frame++) avatar.updateAvatarVisual(frame / 60);
assert(Math.abs(robot.rotation.y - Math.PI / 2) < .001, 'idle inspection turn');
root.userData.walking = true;
let minHip = Infinity, maxHip = -Infinity;
for (let frame = 61; frame <= 300; frame++) {
  avatar.updateAvatarVisual(frame / 60);
  assert(Math.abs(hips[0].rotation.x + hips[1].rotation.x) < 1e-8, 'legs advance alternately');
  for (let side = 0; side < 2; side++) {
    assert(Number.isFinite(hips[side].rotation.x + knees[side].rotation.x + ankles[side].rotation.x), 'joint rotations stay finite');
    assert(Math.abs(hips[side].rotation.x + knees[side].rotation.x + ankles[side].rotation.x) < 1e-8, 'ankle balances the supporting shoe orientation');
  }
  minHip = Math.min(minHip, hips[0].rotation.x);
  maxHip = Math.max(maxHip, hips[0].rotation.x);
}
assert(minHip < -.3 && maxHip > .3, 'legs visibly change pose during the gait');
assert(Math.abs(robot.rotation.y) < .001, 'walking faces the navigation route');
assert(root.position.length() === 0, 'gait never translates the navigation root');
root.userData.walking = false;
for (let frame = 301; frame <= 360; frame++) avatar.updateAvatarVisual(frame / 60);
assert(hips.every(hip => Math.abs(hip.rotation.x) < .001) && knees.every(knee => Math.abs(knee.rotation.x) < .001), 'walking blends back to the rest pose');
assert(Math.abs(robot.rotation.y - Math.PI / 2) < .001, 'inspection orientation returns at rest');

root.userData.walking = true;
avatar.setRobotMotion(false);
avatar.updateAvatarVisual(6.1);
assert(hips.every(hip => hip.rotation.x === 0) && knees.every(knee => knee.rotation.x === 0) && ankles.every(ankle => ankle.rotation.x === 0), 'saved motion preference pauses gait');
avatar.setRobotMotion(true);
root.userData.walking = false;
avatar.waveRobot();
avatar.updateAvatarVisual(performance.now() / 1000 + 1.4);
assert(robot.children.some(child => child.rotation.z > .5), 'greeting remains available');
assert(root.position.length() === 0, 'greeting also leaves floor translation to navigation');
console.log('PASS constructed android joints, alternating gait, ankle balance, route facing, stationary root, smooth stop, motion pause and greeting');
