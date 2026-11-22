import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';

const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const withoutImports = source => source.replace(/^import[^\n]*\r?\n/gm, '');
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(compile(source)).toString('base64');
const three = JSON.stringify(import.meta.resolve('three'));
const bootstrap = { document: { body: { dataset: {} } }, requests: [], fail: false, visual: null };
globalThis.__rhodaBootstrapTest = bootstrap;
const assistantSource = `import * as THREE from ${three};
const test = globalThis.__rhodaBootstrapTest;
const console = {log(){},warn(){}};
const document = test.document;
const window = { addEventListener(){} };
const navigator = { userAgent:'' };
const AudioRecorder = class {};
const AudioFeedback = class {};
const rawAnimationManifest = {idle:[],dance:[],expression:[],locomotion:[]};
const GLTFLoader = class { load(path, success, _progress, failure) {
 test.requests.push(path); if(test.fail) failure(new Error('Synthetic missing optional asset')); else success({scene:test.visual});
} };
${withoutImports(fs.readFileSync('src/rhode_schwarz.ts', 'utf8'))}`;
const { RhodeSchwarzAssistant } = await import(moduleUrl(assistantSource));

async function initialize({ unavailable = false, fail = false } = {}) {
  bootstrap.document.body.dataset = unavailable ? { originalAvatar:'unavailable' } : {};
  bootstrap.requests.length = 0; bootstrap.fail = fail;
  bootstrap.visual = new THREE.Group();
  bootstrap.visual.add(new THREE.Mesh(new THREE.BoxGeometry(.4, 1.68, .3), new THREE.MeshBasicMaterial()));
  const scene = new THREE.Scene(), assistant = new RhodeSchwarzAssistant(scene);
  let animationLoads = 0;
  assistant.loadAnimations = async () => { animationLoads++; };
  await assistant.init();
  assert.equal(scene.children.length, 1, 'Assistant installs one navigation root');
  assert(assistant.mesh.position.toArray().every(Number.isFinite));
  return { assistant, scene, animationLoads };
}

const knownAbsent = await initialize({ unavailable:true });
assert.equal(bootstrap.requests.length, 0, 'Public bundle does not request the excluded avatar');
assert.equal(knownAbsent.assistant.mesh.userData.originalAvatarUnavailable, true);
assert.equal(knownAbsent.assistant.mesh.children.length, 0, 'No replacement geometry or robot is fabricated');
const missing = await initialize({ fail:true });
assert.equal(bootstrap.requests.length, 1);
assert.equal(missing.assistant.mesh.userData.originalAvatarUnavailable, true, 'An unexpected download failure still resolves the assistant bootstrap');
const original = await initialize();
assert.equal(original.assistant.mesh, bootstrap.visual, 'Available original remains the actual navigation/visual root');
assert.equal(original.animationLoads, 1, 'Original animation initialization is preserved');
assert.equal(original.assistant.mesh.userData.originalAvatarUnavailable, undefined);

function fakeElement() {
  return { textContent:'', value:'', checked:false, disabled:false, children:[], attrs:new Map(),
    append(child){this.children.push(child);}, replaceChildren(){this.children=[];},
    setAttribute(name,value){this.attrs.set(name,String(value));}, removeAttribute(name){this.attrs.delete(name);},
    toggleAttribute(name,present){if(present)this.attrs.set(name,'');else this.attrs.delete(name);}, contains(){return false;}, focus(){} };
}
let caseId = 0;
async function stylesCase({ saved='rhoda', unavailable=true, fail=false, deferred=false }={}) {
  const storage = new Map([['rhoda-avatar-style',saved], ['rhoda-robot-motion','false']]);
  const elements = new Map();
  const get = id => { if(!elements.has(id))elements.set(id,fakeElement());return elements.get(id); };
  const originalOption=fakeElement(), humanOption=fakeElement();
  get('avatar-style').querySelector = selector => selector.includes('rhoda') ? originalOption : humanOption;
  const root = new THREE.Group();
  if(unavailable) root.userData.originalAvatarUnavailable=true;
  else root.add(new THREE.Mesh(new THREE.BoxGeometry(.5,1.68,.3),new THREE.MeshBasicMaterial()));
  let loads=0, receivedFoot=null, release;
  const state = { document:{getElementById:get,createElement:fakeElement,activeElement:null},
    window:{matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){}},
    storage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    load:async(parent,foot)=>{
      loads++;receivedFoot=foot;
      if(deferred)await new Promise(resolve=>{release=resolve;});
      if(fail)throw new Error('Synthetic companion downloads unavailable');
      const holder=new THREE.Group();parent.add(holder);
      return {holder,limitations:[],description:'Permitted human companion',update(){},reset(){}};
    }
  };
  const key='__rhodaStyleTest'+(++caseId);globalThis[key]=state;
  const source=`import * as THREE from ${three};
const test=globalThis[${JSON.stringify(key)}],document=test.document,window=test.window,localStorage=test.storage;
const console={log(){},warn(){}};
const loadHumanCompanion=test.load;
const getAvatarAnimationOptions=()=>[];
const getAvatarAnimationSnapshot=()=>({phase:'unavailable',message:'No preview',canPlay:false,canStop:false});
const playAvatarAnimation=async()=>false,stopAvatarAnimation=()=>{};
${withoutImports(fs.readFileSync('src/avatarStyle.ts','utf8'))}
// Isolated preference case ${caseId}`;
  const api=await import(moduleUrl(source));api.installAvatarStyles(root,()=>{});
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  if(!deferred)await settle();
  return {api,root,storage,elements,get,originalOption,humanOption,get loads(){return loads;},get receivedFoot(){return receivedFoot;},settle,release:()=>release?.()};
}

const fallback=await stylesCase();
assert.equal(fallback.api.selectedAvatarStyle(),'human');
assert.equal(fallback.api.avatarMotionEnabled(),false,'Saved motion pause is retained');
assert.equal(fallback.loads,1);assert.equal(fallback.receivedFoot,0,'Empty navigation root supplies a finite floor anchor');
assert.equal(fallback.storage.get('rhoda-avatar-style'),'rhoda','Automatic fallback does not overwrite the saved original choice');
assert.equal(fallback.originalOption.disabled,true);
assert.equal(fallback.root.getObjectByName('RHODA_OriginalVisual').visible,false);
const hidden=await stylesCase({saved:'hidden'});
assert.equal(hidden.api.selectedAvatarStyle(),'hidden');assert.equal(hidden.loads,0,'A saved hidden preference avoids an unnecessary model request');
const normal=await stylesCase({unavailable:false});
assert.equal(normal.api.selectedAvatarStyle(),'rhoda');assert.equal(normal.loads,0);assert.equal(normal.originalOption.disabled,false);
const failed=await stylesCase({fail:true});
assert.equal(failed.api.selectedAvatarStyle(),'hidden');
assert(failed.get('avatar-description').textContent.includes('Offline lessons and the spatial controls remain available'));
assert.equal(failed.storage.get('rhoda-avatar-style'),'rhoda');
const changed=await stylesCase({deferred:true});
changed.api.setAvatar('hidden');changed.release();await changed.settle();
assert.equal(changed.api.selectedAvatarStyle(),'hidden','A newer explicit selection wins over a pending fallback download');
assert.equal(changed.storage.get('rhoda-avatar-style'),'hidden');

delete globalThis.__rhodaBootstrapTest;
console.log('PASS optional-avatar bootstrap, public metadata skip, original preservation, permitted companion handoff, hidden/motion preferences, failure recovery and pending-selection race; no browser or hardware claims');
