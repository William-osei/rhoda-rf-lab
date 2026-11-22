import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import * as THREE from 'three';

// Exercise the real UI module against an inert registry. No GLB downloads,
// animation playback, speech, provider calls or physical XR are involved.
const stored=new Map([['rhoda-avatar-style','rhoda'],['rhoda-robot-motion','false']]);
globalThis.localStorage={getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)};
const elements=new Map();
function element(id){
 if(!elements.has(id))elements.set(id,{
  disabled:false,value:'',textContent:'',checked:false,hidden:false,children:[],attributes:new Map(),
  append(child){this.children.push(child);},replaceChildren(){this.children=[];},
  setAttribute(name,value){this.attributes.set(name,value);},
  toggleAttribute(name,value){if(name==='hidden')this.hidden=value;},
  contains(){return false;},focus(){},querySelector(){return element('human-option');},
 });
 return elements.get(id);
}
globalThis.document={getElementById:element,createElement:()=>({append(){}}),activeElement:null};
globalThis.window={matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){},dispatchEvent(){}};

const idle=()=>({phase:'idle',activeId:null,label:'',message:'Ready.',canPlay:true,canStop:false});
const registry=new Map();
const choices=new Map([
 ['rhoda',[{id:'nod',label:'Nod',group:'Shared',availability:'ready'},{id:'explain',label:'Explanation',group:'Shared',availability:'ready'}]],
 ['human',[{id:'nod',label:'Nod',group:'Shared',availability:'ready'},{id:'greeting',label:'Wave hello',group:'Native',availability:'ready'}]],
]);
const plays=[];
globalThis.__avatarLabelFixture={
 options:style=>registry.has(style)?choices.get(style):[],
 snapshot:style=>registry.get(style)??{phase:'unavailable',activeId:null,label:'',message:'Waiting for character.',canPlay:false,canStop:false},
 play:async(style,id)=>{plays.push({style,id});return true;},
 stop:()=>{},
};
let resolveHuman;
globalThis.__labelLoadHuman=()=>new Promise(resolve=>resolveHuman=resolve);
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const moduleURL=source=>'data:text/javascript;base64,'+Buffer.from(compile(source)).toString('base64');
const fixture=moduleURL(`
const fixture=globalThis.__avatarLabelFixture;
export const getAvatarAnimationOptions=fixture.options;
export const getAvatarAnimationSnapshot=fixture.snapshot;
export const playAvatarAnimation=fixture.play;
export const stopAvatarAnimation=fixture.stop;
`);
const source=fs.readFileSync('src/avatarStyle.ts','utf8')
 .replace("import { loadHumanCompanion } from './humanCompanion';",'const loadHumanCompanion=globalThis.__labelLoadHuman;')
 .replace("from './avatarAnimations'",'from '+JSON.stringify(fixture))
 .replace("from 'three';",'from '+JSON.stringify(import.meta.resolve('three'))+';');
const avatar=await import(moduleURL(source));
assert.equal(avatar.companionGreetingLabel(),'Preparing animations…','missing registry must not claim narration is active');
avatar.activateCompanionGreeting();assert.equal(avatar.avatarMotionEnabled(),false);assert.equal(plays.length,0);

const root=new THREE.Group();root.add(new THREE.Mesh(new THREE.BoxGeometry(.2,1.68,.2)));
avatar.installAvatarStyles(root,()=>{});
registry.set('rhoda',idle());
assert.equal(avatar.companionGreetingLabel(),'Enable animation');
avatar.activateCompanionGreeting();assert.equal(avatar.avatarMotionEnabled(),true,'an available gesture offers an explicit Enable action');
assert.equal(stored.get('rhoda-robot-motion'),'true');assert.equal(plays.length,0,'Enable does not also launch a gesture');
assert.equal(avatar.companionGreetingLabel(),'Friendly gesture');avatar.activateCompanionGreeting();assert.deepEqual(plays.at(-1),{style:'rhoda',id:'explain'});

avatar.setAvatarMotion(false);avatar.setAvatar('human');
assert.equal(avatar.companionGreetingLabel(),'Loading companion…');
avatar.activateCompanionGreeting();assert.equal(avatar.avatarMotionEnabled(),false,'loading is not permission to overwrite the saved pause');
assert.equal(stored.get('rhoda-robot-motion'),'false');assert.equal(plays.length,1);
registry.set('human',idle());resolveHuman({holder:new THREE.Group(),limitations:[],description:'Inert human model',reset(){},update(){}});
await Promise.resolve();await Promise.resolve();await Promise.resolve();
assert.equal(avatar.selectedAvatarStyle(),'human');
choices.get('human').find(option=>option.id==='greeting').availability='unavailable';
assert.equal(avatar.companionGreetingLabel(),'Gesture unavailable');
avatar.activateCompanionGreeting();assert.equal(avatar.avatarMotionEnabled(),false);assert.equal(plays.length,1);
avatar.updateAvatarVisual(1);assert.equal(element('robot-wave').disabled,true);assert.equal(element('robot-wave').textContent,'Gesture unavailable');
choices.get('human').find(option=>option.id==='greeting').availability='ready';
assert.equal(avatar.companionGreetingLabel(),'Enable animation');avatar.activateCompanionGreeting();assert.equal(avatar.avatarMotionEnabled(),true);
assert.equal(avatar.companionGreetingLabel(),'Wave hello');

for(const [phase,label] of [['loading','Preparing gesture…'],['playing','Playing gesture…'],['paused','Gesture paused']]){
 registry.set('human',{...idle(),phase,activeId:'greeting',label:'Wave hello',canStop:true});
 assert.equal(avatar.companionGreetingLabel(),label,'active friendly gesture has truthful '+phase+' feedback');
}
registry.set('human',{...idle(),phase:'busy',message:'Walking takes priority.',canPlay:false});assert.equal(avatar.companionGreetingLabel(),'Stop walking to gesture');
registry.set('human',{...idle(),phase:'busy',message:'Narration takes priority.',canPlay:false});assert.equal(avatar.companionGreetingLabel(),'Pause narration to gesture');
registry.set('human',idle());avatar.setAvatarMotion(false);avatar.setAvatar('hidden');
assert.equal(avatar.companionGreetingLabel(),'Show companion');avatar.activateCompanionGreeting();
assert.equal(avatar.selectedAvatarStyle(),'human','Show restores the already loaded human');assert.equal(avatar.avatarMotionEnabled(),false,'Show does not also enable animation');
assert.equal(plays.length,1);
console.log('PASS real avatar UI: no-controller labels, available/unavailable friendly gesture, pending-load pause preservation, explicit Enable, active gesture phases, walking/narration priority and hidden Show');
