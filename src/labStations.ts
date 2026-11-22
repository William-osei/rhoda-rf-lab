import * as THREE from 'three';
import type {RhodeSchwarzAssistant} from './rhode_schwarz';
import {chooseLesson,sceneStatus,stopLessonSpeech,lessonSnapshot} from './xrDesk';
/** Desktop stations rehearse the existing simulator; they never send physical commands. */
export function installLabStations(camera:THREE.Camera,renderer:THREE.WebGLRenderer,room:THREE.Group,assistant:RhodeSchwarzAssistant,clearInspection:()=>void,scene:THREE.Scene,onMovement?:(snapshot:ReturnType<RhodeSchwarzAssistant['getMovementSnapshot']>)=>void){
 const dialog=document.getElementById('station-dialog') as HTMLDialogElement;
 const frame=document.getElementById('station-frame') as HTMLIFrameElement;
 const speed=document.getElementById('walk-speed') as HTMLSelectElement;
 const distance=document.getElementById('follow-distance') as HTMLSelectElement;
 try{const saved=JSON.parse(localStorage.getItem('rhoda-movement-preferences')||'null');if([.45,.65,.85].includes(saved?.speed))speed.value=String(saved.speed);if([1.4,1.7,2.1].includes(saved?.distance))distance.value=String(saved.distance);}catch{}
 const applyPreferences=()=>{assistant.setMovementPreferences(Number(speed.value),Number(distance.value));try{localStorage.setItem('rhoda-movement-preferences',JSON.stringify({speed:Number(speed.value),distance:Number(distance.value)}));}catch{}};
 speed.onchange=distance.onchange=applyPreferences;applyPreferences();
 let lastMovementText='';
 function syncMovement(){
  const s=assistant.getMovementSnapshot();let text='Ready to walk. Choose a station, Walk to me or Follow me.';
  if(s.phase==='walking')text=(s.following?'Following':'Walking to '+(s.adjusted?'the nearest clear floor position':'your destination'))+' · '+s.speed.toFixed(2)+' m/s';
  else if(s.phase==='waiting')text='Following enabled · keeping about '+s.distance.toFixed(1)+' m of space';
  else if(s.phase==='arrived')text=s.adjusted?'Arrived at a clear floor position near the requested point.':'Arrived. Ready to help.';
  else if(s.phase==='paused')text='Movement paused. Show the companion and enable gentle animation to continue.';
  else if(s.phase==='blocked')text='No clear walking route from this placement. Stop walking or reposition the companion before trying again.';
  if(text!==lastMovementText){lastMovementText=text;document.getElementById('movement-status')!.textContent=text;}
  const progress=document.getElementById('movement-progress') as HTMLProgressElement;progress.hidden=!(s.approaching&&s.phase==='walking');progress.value=s.progress;
  const follow=document.getElementById('companion-follow')!,followText=s.following?'Stop following':'Follow me';if(follow.textContent!==followText)follow.textContent=followText;if(follow.getAttribute('aria-pressed')!==String(s.following))follow.setAttribute('aria-pressed',String(s.following));
  onMovement?.(s);
 }
 let movementTimer:number|undefined;
 const startMovementFeedback=()=>{if(movementTimer===undefined)movementTimer=window.setInterval(syncMovement,250);syncMovement();};
 window.addEventListener('pagehide',()=>{clearInterval(movementTimer);movementTimer=undefined;});
 window.addEventListener('pageshow',startMovementFeedback);startMovementFeedback();
 let portrait:THREE.WebGLRenderer|null=null,portraitFrame=0;
 function showCompanion(){if(portrait)return;portrait=new THREE.WebGLRenderer({antialias:true,alpha:true});portrait.setPixelRatio(Math.min(devicePixelRatio,1.5));portrait.setSize(110,150);portrait.domElement.setAttribute('aria-label','Live selected companion while the lesson is narrated');document.getElementById('station-companion')!.replaceChildren(portrait.domElement);const view=new THREE.PerspectiveCamera(32,110/150,.1,20);const draw=()=>{if(!portrait||!dialog.open)return;const center=new THREE.Vector3();assistant.mesh?.getWorldPosition(center);const front=new THREE.Vector3(0,0,1).applyQuaternion(assistant.mesh?.quaternion||new THREE.Quaternion());view.position.copy(center).addScaledVector(front,1.6);view.position.y=center.y+1.25;view.lookAt(center.x,center.y+1.25,center.z);portrait.render(scene,view);portraitFrame=requestAnimationFrame(draw);};draw();}
 let station:'left'|'right'='right';let returnFocus:HTMLElement|null=null;
 function select(value:'left'|'right'){
  station=value;stopLessonSpeech();chooseLesson('scope-tour');clearInspection();
  const sign=value==='left'?-1:1;
  if(!renderer.xr.isPresenting){camera.position.set(sign*1.15,1.5,-1.6);camera.lookAt(sign*2.35,1.1,value==='left'?-3:-3.4);}
  // Keep the companion in the central aisle, outside the workbench footprints.
  if(!renderer.xr.isPresenting)assistant.walkTo(new THREE.Vector3(sign*.55,assistant.getGroundY(),-2.2));
  document.getElementById('station-status')!.textContent='Station '+(value==='left'?'A':'B')+' selected. Start with probe and channel setup, then open the simulator.';
  sceneStatus('Oscilloscope station '+(value==='left'?'A':'B')+' · offline teaching ready');
  for(const id of ['left','right'])document.getElementById('station-'+id)!.setAttribute('aria-pressed',String(id===value));
 }
 document.getElementById('companion-follow')!.onclick=()=>{const on=assistant.toggleAutoFollow();document.getElementById('companion-follow')!.textContent=on?'Stop following':'Follow me';sceneStatus(on?'Companion following at walking speed':'Following stopped');};
 document.getElementById('companion-stop')!.onclick=()=>{assistant.stopAutoFollow();document.getElementById('companion-follow')!.textContent='Follow me';sceneStatus('Companion stopped');};
 document.getElementById('station-left')!.onclick=()=>select('left');document.getElementById('station-right')!.onclick=()=>select('right');
 window.addEventListener('rhoda-station',event=>{const value=(event as CustomEvent).detail;if(value==='left'||value==='right')select(value);});
 const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();
 renderer.domElement.addEventListener('click',event=>{if(renderer.xr.isPresenting)return;const box=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-box.left)/box.width*2-1,-(event.clientY-box.top)/box.height*2+1);ray.setFromCamera(pointer,camera);const hit=ray.intersectObject(room,true)[0];if(hit?.object.userData.station){select(hit.object.userData.station);openPractice();}});
 function sendCue(detail=lessonSnapshot()){frame.contentWindow?.postMessage({type:'rhoda-tour-cue',...detail},location.origin);}
 function openPractice(){if(renderer.xr.isPresenting){sceneStatus('The detailed scope opens on desktop; spatial teaching remains available.');return;}returnFocus=document.activeElement as HTMLElement;if(assistant.isAutoFollowEnabled())assistant.stopAutoFollow();stopLessonSpeech();document.getElementById('station-dialog-title')!.textContent='Station '+(station==='left'?'A':'B')+' · instrument anatomy and functions';if(!frame.getAttribute('src'))frame.src='/spatial-bench.html?embedded=1';if(!dialog.open)dialog.showModal();showCompanion();const s=lessonSnapshot();document.getElementById('station-narration')!.textContent=s.text;document.getElementById('station-lesson-title')!.textContent=s.title+' · step '+(s.index+1)+' of '+s.total;sendCue();}
 frame.addEventListener('load',()=>sendCue());
 window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===frame.contentWindow&&event.data?.type==='rhoda-scope-ready'&&dialog.open)sendCue();});
 window.addEventListener('rhoda-lesson-cue',event=>{const detail=(event as CustomEvent).detail;if(assistant.mesh){const previous=!!assistant.mesh.userData.narrating;assistant.mesh.userData.narrating=!!detail.speaking;if(detail.speaking&&assistant.getState()==='READY')assistant.setState('SPEAKING');else if(previous&&!detail.speaking&&assistant.getState()==='SPEAKING')assistant.setState('READY');}document.getElementById('station-narration')!.textContent=detail.text;document.getElementById('station-lesson-title')!.textContent=detail.title+' · step '+(detail.index+1)+' of '+detail.total;if(dialog.open)sendCue(detail);});
 document.getElementById('station-practice')!.onclick=openPractice;
 document.getElementById('station-close')!.onclick=()=>dialog.close();dialog.addEventListener('close',()=>{stopLessonSpeech();cancelAnimationFrame(portraitFrame);portrait?.dispose();portrait=null;document.getElementById('station-companion')!.replaceChildren();frame.src='about:blank';frame.removeAttribute('src');returnFocus?.focus();});
}

