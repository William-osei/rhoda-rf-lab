import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as THREE from 'three';
const stored=new Map([['rhoda-avatar-style','human']]);
globalThis.localStorage={getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)};
const controls=new Map();
function element(id){if(!controls.has(id))controls.set(id,{disabled:false,value:'',textContent:'',checked:false,hidden:false,children:[],append(child){this.children.push(child);},replaceChildren(){this.children=[];},setAttribute(){},toggleAttribute(name,value){if(name==='hidden')this.hidden=value;},contains(){return false;},focus(){},querySelector(){return element('human-option');}});return controls.get(id);}
globalThis.document={getElementById:element,createElement:()=>({children:[],append(child){this.children.push(child);}}),activeElement:null};
globalThis.window={matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){},setTimeout(){},dispatchEvent(){}};
const compile=text=>ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const url=text=>'data:text/javascript;base64,'+Buffer.from(compile(text)).toString('base64');
let finishLoading;
// Selection only: the real motion controller is separately verified.
const animationFixture=url(`export function getAvatarAnimationOptions(){return ['idle','nod','explain','walk'].map(id=>({id,label:id,group:'Preview',availability:'ready'}));}export function getAvatarAnimationSnapshot(){return {phase:'idle',activeId:null,label:'',message:'Automatic idle',canPlay:true,canStop:false};}export async function playAvatarAnimation(){return true;}export function stopAvatarAnimation(){}`);
globalThis.__loadCompanion=()=>new Promise(resolve=>finishLoading=resolve);
const source=fs.readFileSync('src/avatarStyle.ts','utf8')
 .replace("import { loadHumanCompanion } from './humanCompanion';",'const loadHumanCompanion=globalThis.__loadCompanion;')
 .replace("from './avatarAnimations'",'from '+JSON.stringify(animationFixture))
 .replace("from 'three';",'from '+JSON.stringify(import.meta.resolve('three'))+';')
 .replace("from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';",'from '+JSON.stringify(import.meta.resolve('three/examples/jsm/geometries/RoundedBoxGeometry.js'))+';');
const avatar=await import(url(source));
const root=new THREE.Group(),original=new THREE.Mesh(new THREE.BoxGeometry(.2,1.68,.2),new THREE.MeshBasicMaterial());root.add(original);
avatar.installAvatarStyles(root,()=>{});
assert.equal(avatar.selectedAvatarStyle(),'rhoda','saved companion has a usable loading fallback');
avatar.setAvatar('robot');assert.equal(avatar.selectedAvatarStyle(),'rhoda','removed android cannot be selected');avatar.setAvatar('rhoda');
const firstHolder=new THREE.Group();root.add(firstHolder);
finishLoading({holder:firstHolder,limitations:[],canWave:true,reset(){},update(){},isWaving(){return false;},isWalking(){return false;}});
await Promise.resolve();await Promise.resolve();
assert.equal(avatar.selectedAvatarStyle(),'rhoda','late loading cannot override the newer explicit choice');
avatar.setAvatar('human');assert.equal(avatar.selectedAvatarStyle(),'human','completed character remains available');
avatar.setAvatar('rhoda');
let writes=0,visible=original.visible;
Object.defineProperty(original,'visible',{get(){return visible;},set(value){visible=value;writes++;},configurable:true});
assert.equal(root.getObjectByName('RHODA_MasculineAndroid'),undefined,'no android subtree is constructed');
for(let i=0;i<120;i++)avatar.updateAvatarVisual(i/60);
assert.equal(writes,0,'steady frames do not rewrite every original mesh visibility');
avatar.updateAvatarVisual(NaN);assert(Number.isFinite(original.parent.rotation.y),'invalid clock is ignored');
avatar.setAvatar('hidden');assert.equal(original.parent.visible,false);assert.equal(original.visible,true,'authored mesh visibility is preserved');assert.equal(firstHolder.visible,false);
let calls=0,resolveLazy;
stored.set('rhoda-avatar-style','rhoda');
globalThis.__loadCompanion=()=>{calls++;return new Promise(resolve=>resolveLazy=resolve);};
const lazy=await import(url(source)+'#lazy-default');
const lazyRoot=new THREE.Group();lazyRoot.add(new THREE.Mesh(new THREE.BoxGeometry(.2,1.68,.2),new THREE.MeshBasicMaterial()));
lazy.installAvatarStyles(lazyRoot,()=>{});
assert.equal(calls,0,'default Rhoda does not download the detailed human asset');
assert.equal(element('human-option').disabled,false,'unloaded human choice remains selectable');
assert.equal(element('robot-controls').hidden,false,'original human has animation controls too');
lazy.setAvatar('human');lazy.setAvatar('human');assert.equal(calls,1,'repeated human selections share one request');
assert.equal(lazy.selectedAvatarStyle(),'rhoda','current appearance remains usable during human loading');
assert.match(element('avatar-description').textContent,/Loading/);
const lazyHolder=new THREE.Group();lazyRoot.add(lazyHolder);
resolveLazy({holder:lazyHolder,description:'Detailed MIT test companion',limitations:[],canWave:true,reset(){},update(){},isWaving(){return false;},isWalking(){return false;}});
await Promise.resolve();await Promise.resolve();await Promise.resolve();
assert.equal(lazy.selectedAvatarStyle(),'human','latest pending human selection is restored');
assert.match(element('avatar-description').textContent,/Detailed MIT/);
lazy.setAvatar('rhoda');lazy.setAvatar('human');assert.equal(calls,1,'cached model does not download again');
stored.set('rhoda-avatar-style','robot');stored.set('rhoda-robot-motion','false');
const migrated=await import(url(source)+'#legacy-android');
assert.equal(stored.get('rhoda-avatar-style'),'human','saved android migrates to separate human');
assert.equal(migrated.avatarMotionEnabled(),false,'saved pause survives migration');
stored.set('rhoda-avatar-style','ceramic');const ceramic=await import(url(source)+'#legacy-ceramic');
assert.equal(ceramic.selectedAvatarStyle(),'rhoda');assert.equal(stored.get('rhoda-avatar-style'),'rhoda');
console.log('PASS human-only selection, lazy/shared loading, stale selection protection, pivot visibility, shared controls, cached reuse and legacy preference/motion migration');
