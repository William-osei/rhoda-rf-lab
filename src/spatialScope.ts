import {createScopeDisplay} from './scopeDisplay';
import {panelHelp} from './panelHelp';
import {pickScopeControl} from './scopePicking';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
/** Illustrative training instrument. Screen texture is the existing simulator canvas. */
export function createSpatialScope(canvas:HTMLCanvasElement) {
 const host=document.getElementById('instrument-view')!;
 const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(Math.max(devicePixelRatio,1.5),2));renderer.outputColorSpace=THREE.SRGBColorSpace;
 host.replaceChildren(renderer.domElement);renderer.domElement.setAttribute('aria-label','Interactive 3D training oscilloscope. Equivalent keyboard controls are available below.');renderer.domElement.setAttribute('role','img');
 const dataStatus=document.createElement('p');dataStatus.id='model-data-status';dataStatus.style.cssText='position:absolute;left:12px;right:12px;bottom:0;padding:8px 12px;background:#09141eeb;color:#ffd28e;font-size:13px;border-radius:7px;pointer-events:none';dataStatus.textContent='Waiting for simulator readback.';host.append(dataStatus);
 const scene=new THREE.Scene();scene.background=new THREE.Color(0x0a1825);
 const camera=new THREE.PerspectiveCamera(36,1,.01,50);camera.position.set(0,.03,1.65);
 const orbit=new OrbitControls(camera,renderer.domElement);orbit.target.set(0,.03,0);orbit.enableDamping=true;orbit.minDistance=.32;orbit.maxDistance=4.2;orbit.maxPolarAngle=Math.PI*.75;orbit.enablePan=false;
 scene.add(new THREE.HemisphereLight(0xe9f6ff,0x253845,2.2));const light=new THREE.DirectionalLight(0xffffff,2.8);light.position.set(2,3,4);scene.add(light);
 // A small, procedural lab vignette gives the reference model a grounded setting
 // without implying that this is a room-scale scan or an exact instrument layout.
 const environment=new THREE.Group();scene.add(environment);
 const labMaterials={wall:new THREE.MeshBasicMaterial({color:0x102331}),panel:new THREE.MeshStandardMaterial({color:0x17313e,roughness:.82}),trim:new THREE.MeshBasicMaterial({color:0x28505a}),bench:new THREE.MeshStandardMaterial({color:0x2b4149,roughness:.72}),mat:new THREE.MeshStandardMaterial({color:0x244e53,roughness:.94}),foot:new THREE.MeshStandardMaterial({color:0x4e5d60,roughness:.8})};
 function environmentBox(w:number,h:number,d:number,x:number,y:number,z:number,material:THREE.Material){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);environment.add(mesh);return mesh;}
 const wall=new THREE.Mesh(new THREE.PlaneGeometry(5.2,3.6),labMaterials.wall);wall.position.set(0,.18,-.67);environment.add(wall);
 environmentBox(3.7,.11,1.48,0,-.57,.04,labMaterials.bench);
 environmentBox(3.62,.035,1.42,0,-.4975,.04,labMaterials.mat);
 environmentBox(3.68,.012,.025,0,-.48,.755,labMaterials.trim);
 for(const x of [-1.52,-.52,.52,1.52])environmentBox(.008,2.72,.012,x,.18,-.647,labMaterials.trim);
 for(const y of [-.72,.35,1.08])environmentBox(5.0,.009,.012,0,y,-.647,labMaterials.trim);
 for(const x of [-1.62,1.62]){
  environmentBox(.68,.46,.055,x,.63,-.60,labMaterials.panel);
  environmentBox(.56,.012,.018,x,.40,-.565,labMaterials.trim);
  environmentBox(.035,.035,.018,x-.23,.53,-.565,labMaterials.trim);
 }
 const root=new THREE.Group();scene.add(root);
 let latestFrame:any=null;
 window.addEventListener('rhoda-select-channel',event=>{const channel=Number((event as CustomEvent).detail?.channel);if(!latestFrame||channel<1||channel>4)return;knobs.scale.rotation.z=-Math.log10(latestFrame.state.channels[String(channel)].vertical_scale)*.6;});
 const shell=new THREE.MeshStandardMaterial({color:0xe1e1dc,roughness:.48});const dark=new THREE.MeshStandardMaterial({color:0x252a2b,roughness:.72});const knobMat=new THREE.MeshStandardMaterial({color:0xbfc2bf,metalness:.18,roughness:.48});
 function box(w:number,h:number,d:number,x:number,y:number,z:number,mat:THREE.Material){const m=new THREE.Mesh(new RoundedBoxGeometry(w,h,d,3,Math.min(.025,w/4,h/4,d/4)),mat);m.position.set(x,y,z);root.add(m);return m;}
 const enclosure=[box(1.5,.86,.39,0,0,0,shell),box(1.47,.81,.035,0,.015,.21,shell)];
 for(const x of [-.54,.54])for(const z of [-.13,.17]){const foot=new THREE.Mesh(new THREE.CylinderGeometry(.028,.034,.05,20),labMaterials.foot);foot.position.set(x,-.455,z);root.add(foot);}
 box(.45,.57,.015,.455,.035,.235,dark);
 box(.875,.55,.024,-.265,.035,.239,dark);
 const display=createScopeDisplay(canvas);const screenTexture=display.texture;
 const screen=new THREE.Mesh(new THREE.PlaneGeometry(.842,.493),new THREE.MeshBasicMaterial({map:screenTexture}));screen.position.set(-.265,.035,.254);root.add(screen);screen.userData.control='info:Display';screen.userData.title='Display';
 const interactive:THREE.Object3D[]=[screen];
 function label(text:string,x:number,y:number,width=.10,color='#202829',z=.263){const c=document.createElement('canvas');c.width=512;c.height=80;const ctx=c.getContext('2d')!;ctx.fillStyle=color;let font=44;ctx.font=`600 ${font}px Arial`;while(ctx.measureText(text).width>480&&font>14){font-=2;ctx.font=`600 ${font}px Arial`;}ctx.textAlign='center';ctx.fillText(text,256,53);const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=renderer.capabilities.getMaxAnisotropy();const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,width*80/512),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false}));mesh.position.set(x,y,z);root.add(mesh);}
 label('R&S RTB 2 Series Oscilloscope   |   RTB24   |   10-bit ADC',-.26,.36,.85);
 label('RHODA | SIMULATED SIGNAL',-.26,.296,.40,'#91ccca');
 const knobs:Record<string,THREE.Group>={};
 function knob(id:string,title:string,x:number,y:number,r=.029,ring=false){const group=new THREE.Group();group.position.set(x,y,.267);if(ring){const halo=new THREE.Mesh(new THREE.TorusGeometry(r+.005,.004,8,40),new THREE.MeshStandardMaterial({color:0xd2e887,emissive:0x586524,emissiveIntensity:.4}));halo.position.z=.003;group.add(halo);}const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r*.96,.031,40),knobMat);mesh.rotation.x=Math.PI/2;group.add(mesh);for(let i=0;i<24;i++){const t=i*Math.PI/12;const grip=new THREE.Mesh(new THREE.BoxGeometry(.002,.006,.022),knobMat);grip.position.set(Math.sin(t)*r,Math.cos(t)*r,0);grip.rotation.z=-t;group.add(grip);}const tick=new THREE.Mesh(new THREE.BoxGeometry(.002,.009,.002),dark);tick.position.set(0,r*.65,.017);group.add(tick);root.add(group);mesh.userData.control=id;mesh.userData.title=title;interactive.push(mesh);knobs[id]=group;label(title,x,y+r+.014,.095,'#f4f5f0',.29);}
 function keyLabel(text:string,x:number,y:number,w:number){const c=document.createElement('canvas');c.width=256;c.height=128;const ctx=c.getContext('2d')!;ctx.fillStyle='#101819';ctx.textAlign='center';ctx.textBaseline='middle';const words=text.replace(/([a-z])([A-Z])/g,'$1 $2').split(/[ /]+/);const lines=text.length>7&&words.length>1?words:[text];let font=52;do{ctx.font=`600 ${font}px Arial`;if(lines.every(t=>ctx.measureText(t).width<236))break;font-=2;}while(font>20);lines.forEach((t,i)=>ctx.fillText(t,128,64+(i-(lines.length-1)/2)*53));const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=renderer.capabilities.getMaxAnisotropy();const m=new THREE.Mesh(new THREE.PlaneGeometry(w*.92,.024),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false}));m.position.set(x,y,.269);root.add(m);}
 function button(id:string,title:string,x:number,y:number,w=.047,color=0xd3d5d1){box(w+.006,.036,.008,x,y,.25,dark);const mesh=box(w,.030,.012,x,y,.259,new THREE.MeshStandardMaterial({color,roughness:.55}));mesh.userData.control=id;mesh.userData.title=title;interactive.push(mesh);keyLabel(title,x,y,w);}
 function heading(t:string,x:number,y:number,w:number){label(t,x,y,w,'#e0e2df');box(w,.0015,.001,x,y-.015,.248,knobMat);}
 heading('Horizontal',.327,.303,.16);heading('Trigger',.556,.303,.18);
 button('info:Zoom','Zoom',.274,.263);button('info:Horizontal','Horizontal',.274,.195);button('info:Acquisition','Acquire',.274,.129);
 knob('info:Horizontal position','Position',.377,.25,.025);knob('time','Scale',.377,.13,.031);
 button('info:Trigger menu','Trigger',.493,.263);button('info:Trigger source','Source',.493,.212,.047,0xdce59b);button('info:Trigger mode','Auto/Norm',.493,.162);
 knob('trigger','Level',.563,.212,.025);button('info:Run/Stop','Run/Stop',.632,.263,.047,0x65d5a6);button('info:Single acquisition','Single',.632,.212);button('info:Force trigger','Force',.632,.162);
 heading('Vertical',.327,.076,.16);heading('Action',.556,.117,.18);
 [['Ch 1',1,0xffdb7b],['Ch 2',2,0x6ed9ff],['Ch 3',3,0xff8fe1],['Ch 4',4,0x92eaa4]].forEach(([t,n,color],i)=>button(`channel:${n}`,String(t),.274,.035-i*.066,.047,Number(color)));
 knob('info:Vertical position','Position',.377,.005,.03,true);knob('scale','Scale',.377,-.142,.033,true);
 [['Screenshot','Save/Load','Autoset'],['Touch lock','Clear','Preset']].forEach((row,j)=>row.forEach((t,i)=>button('info:'+t,t,.493+i*.07,.075-j*.05,.047,i===2?0x078d95:0xd3d5d1)));
 heading('Analysis',.556,-.022,.18);knob('info:Analysis selection','',.563,-.069,.029);
 [['Cursor','Meas','Display'],['Quick meas','Search','FFT']].forEach((row,j)=>row.forEach((t,i)=>button(t==='Meas'?'frequency':t==='Quick meas'?'peak_to_peak':'info:'+t,t,.493+i*.07,-.132-j*.05)));
 ['Logic','Ref','Math','Protocol','Gen','Menu'].forEach((t,i)=>button('info:'+t,t,.274+i*.072,-.235));
 box(1.40,.0015,.002,0,-.302,.236,knobMat);
 const metal=new THREE.MeshStandardMaterial({color:0xc8b077,metalness:.85,roughness:.26});
 function connector(title:string,x:number,color=0xc7c7ba){label(title,x,-.322,.077);const collar=new THREE.Mesh(new THREE.CylinderGeometry(.034,.034,.009,36),new THREE.MeshStandardMaterial({color,roughness:.55}));collar.rotation.x=Math.PI/2;collar.position.set(x,-.367,.247);root.add(collar);const ring=new THREE.Mesh(new THREE.TorusGeometry(.018,.005,12,40),metal);ring.position.set(x,-.367,.278);root.add(ring);ring.userData.control='info:'+title;ring.userData.title=title;ring.userData.connector=true;interactive.push(ring);const hole=new THREE.Mesh(new THREE.CircleGeometry(.012,28),dark);hole.position.set(x,-.367,.272);root.add(hole);const pin=new THREE.Mesh(new THREE.TorusGeometry(.005,.002,8,24),metal);pin.position.set(x,-.367,.278);root.add(pin);for(const side of [-1,1])box(.008,.009,.012,x+side*.022,-.367,.272,metal);}
 connector('Aux Out',-.58);connector('Ext Trigger',.15);[0xdac96d,0x80b6c8,0xc69dbf,0x98b581].forEach((c,i)=>connector('Ch '+(i+1),.275+i*.122,c));
 button('info:Standby','Power',-.68,-.367,.048,0xb9cdb8);
 const usbHit=box(.06,.03,.008,-.48,-.36,.247,knobMat);usbHit.userData.control='info:USB host';interactive.push(usbHit);const probeHit=box(.10,.025,.006,-.37,-.36,.247,shell);probeHit.userData.control='info:Probe compensation';interactive.push(probeHit);
 label('USB',-.48,-.322,.05);box(.056,.026,.006,-.48,-.36,.249,knobMat);box(.045,.016,.007,-.48,-.36,.254,dark);
 label('Probe Comp',-.373,-.322,.10);for(let i=0;i<4;i++)box(.004,.024,.008,-.41+i*.025,-.36,.25,metal);
 const logicHit=box(.30,.035,.004,-.12,-.36,.264,dark);logicHit.userData.control='info:Logic connector';interactive.push(logicHit);
 label('Logic Channels',-.12,-.322,.20);for(const x of [-.20,-.055]){box(.133,.031,.008,x,-.36,.25,knobMat);box(.118,.022,.006,x,-.36,.256,dark);for(let i=0;i<8;i++)box(.003,.006,.005,x-.048+i*.013,-.36,.26,metal);}
 for(const x of [-.57,.57])box(.20,.045,.25,x,-.445,0,dark);
 for(const [title,x] of [['LAN',-.48],['USB device',-.20],['AC power inlet',.44]] as const){const port=box(.15,.09,.025,x,-.08,-.21,dark);port.userData.control='info:'+title;port.userData.title=title;interactive.push(port);label(title,x,.005,.18,'#263e45',-.228);root.children[root.children.length-1].rotation.y=Math.PI;}
 for(let i=0;i<12;i++)box(.003,.22,.009,.752,.025,-.145+i*.024,dark);
 // Carry handle and enclosure seam remain visible from the oblique view.
 box(1.46,.005,.37,0,-.31,0,knobMat);box(.76,.028,.05,0,.48,-.075,dark);
 for(const x of [-.39,.39])box(.035,.11,.05,x,.435,-.075,dark);
 const pointer=new THREE.Vector2(),ray=new THREE.Raycaster(),activePointers=new Set<number>();let down:{x:number;y:number;id:number;dragged:boolean}|null=null;
 renderer.domElement.addEventListener('pointerdown',e=>{activePointers.add(e.pointerId);down=activePointers.size===1&&e.button===0?{x:e.clientX,y:e.clientY,id:e.pointerId,dragged:false}:null;});
 renderer.domElement.addEventListener('pointercancel',e=>{activePointers.delete(e.pointerId);down=null;});
 renderer.domElement.addEventListener('pointerup',e=>{activePointers.delete(e.pointerId);const start=down;down=null;if(!start||start.id!==e.pointerId||start.dragged||Math.hypot(e.clientX-start.x,e.clientY-start.y)>6)return;const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);const hit=pickScopeControl(ray,interactive,enclosure);if(hit)activate(hit.object.userData.control);});
 const explanations:Record<string,[string,string]>={time:['Horizontal scale','Time/div sets the time represented by one horizontal division. A larger value shows more cycles across the screen.'],scale:['Vertical scale','V/div sets volts represented by each vertical division. A larger value makes the trace appear smaller.'],trigger:['Trigger level','Trigger level determines the crossing threshold. This ideal simulator checks whether a crossing is possible; it does not model real acquisition alignment.'],coupling:['Input coupling','DC coupling keeps the DC component. This ideal AC mode removes the offset; it does not model a real high-pass filter.'],frequency:['Frequency measurement','The simulator reports the ideal signal frequency, not a physical measurement or a sample-based estimate.'],peak_to_peak:['Peak-to-peak measurement','Vpp is maximum minus minimum voltage over the ideal signal. It is distinct from RMS.']};
 function activate(id:string){clearHighlight();(document.getElementById('panel-topic') as HTMLSelectElement).value='';const status=document.getElementById('inspect-status');if(id.startsWith('channel:')){const channel=Number(id.slice(8));window.dispatchEvent(new CustomEvent('rhoda-select-channel',{detail:{channel}}));if(status)status.textContent=`CH${channel} selected · its controls are ready below`;document.getElementById('coach-title')!.textContent=`CH${channel} selected`;document.getElementById('coach-text')!.textContent=`The channel selector and measurement source now target CH${channel}. The 3D key only selects a channel; changing its settings still requires preview and approval.`;return;}if(status)status.textContent=(explanations[id]?.[0]??id.replace('info:',''))+' selected';if(id.startsWith('info:')){document.getElementById('coach-title')!.textContent=id.slice(5);document.getElementById('coach-text')!.textContent=(panelHelp[id.slice(5)]??'This control is shown for front-panel orientation.')+' This selection does not change instrument settings.';return;}const [title,text]=explanations[id];document.getElementById('coach-title')!.textContent=title;document.getElementById('coach-text')!.textContent=text;
  const inputId=({time:'timebase',scale:'scale',trigger:'level',coupling:'coupling'} as Record<string,string>)[id];
  const target=(inputId?document.querySelector(`[data-input="${inputId}"]`):document.querySelector(`[data-measure="${id}"]`)) as HTMLButtonElement;
  if(!target||target.disabled){document.getElementById('coach-text')!.textContent+=' Controls are unavailable while disconnected, busy or awaiting approval.';return;}
  if(inputId){const input=document.getElementById(inputId) as HTMLInputElement;
   if(id==='coupling')input.value=input.value==='DCLimit'?'ACLimit':'DCLimit';
   else if(id==='trigger')input.value=String(Math.round((Number(input.value)+.1)*10)/10);
   else{const steps=id==='time'?[.0001,.0002,.0005,.001,.002,.005]:[.1,.2,.5,1,2,5];input.value=String(steps.find(v=>v>Number(input.value)*1.001)??steps[0]);}
  }
  target.click();document.getElementById('coach-state')!.textContent='Requesting a preview. Review the approval panel or any reported error before proceeding.';

 }
 type View='front'|'angle'|'controls'|'screen'|'connectors'|'rear';
 let view:View='front';
 function setView(next:View){view=next;const regions={front:[0,.03,1.65,.96],angle:[0,.03,1.70,1.02],controls:[.46,.025,.51,.64],screen:[-.265,.035,.92,.58],connectors:[0,-.35,1.5,.20],rear:[0,.03,1.65,.96]};const [x,y,w,h]=regions[next];const distance=Math.max(h,w/camera.aspect)/(2*Math.tan(Math.PI/10))*1.1;
 orbit.target.set(x,y,.25);camera.position.set(x,y,.25+distance);if(next==='rear'){orbit.target.z=-.21;camera.position.z=-.21-distance;}if(next==='angle')camera.position.add(new THREE.Vector3(.36,.19,.12));orbit.maxDistance=Math.max(5,distance*2);orbit.update();document.querySelectorAll<HTMLButtonElement>('[data-camera-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.id==='view-'+next)));}
 (['front','angle','controls','screen','connectors','rear'] as View[]).forEach(v=>document.getElementById('view-'+v)!.onclick=()=>setView(v));
 let highlight:THREE.BoxHelper|null=null;
 function clearHighlight(){if(highlight){scene.remove(highlight);highlight.geometry.dispose();(highlight.material as THREE.Material).dispose();highlight=null;}}
 function inspectPart(topic:string){const mapped=({Horizontal:'time','Vertical scale':'scale','Trigger level':'trigger','Frequency measurement':'frequency','Peak-to-peak measurement':'peak_to_peak','Ch 1':'info:Ch 1','Probe compensation':'info:Probe compensation'} as Record<string,string>)[topic]||'info:'+topic;
  const object=interactive.find(o=>o.userData.control===mapped&&(!/^Ch [1-4]$/.test(topic)||o.userData.connector));clearHighlight();(document.getElementById('panel-topic') as HTMLSelectElement).value=topic;
  if(object){root.updateMatrixWorld(true);highlight=new THREE.BoxHelper(object,0x63f2ce);scene.add(highlight);}
  setView(['LAN','USB device','AC power inlet'].includes(topic)?'rear':['Ch 1','Ch 2','Ch 3','Ch 4','Probe compensation','Aux Out','Ext Trigger','USB host','Logic connector','Standby'].includes(topic)?'connectors':topic==='Display'?'screen':'controls');
  if(/^Ch [1-4]$/.test(topic)){const channel=Number(topic.slice(-1));window.dispatchEvent(new CustomEvent('rhoda-select-channel',{detail:{channel}}));}
  document.getElementById('coach-title')!.textContent=topic;document.getElementById('coach-text')!.textContent=(panelHelp[topic]||'See the source manual for this part.')+( /^Ch [1-4]$/.test(topic)?' The matching channel and measurement source are selected below; changing settings still requires preview and approval.':' Read-only demonstration: no settings were changed.');
  document.getElementById('inspect-status')!.textContent=topic+' highlighted';
 }
 const anatomy=document.getElementById('anatomy-list')!;for(const topic of Object.keys(panelHelp)){const b=document.createElement('button');b.textContent=topic;b.type='button';b.id='view-part-'+topic.toLowerCase().replace(/[^a-z0-9]+/g,'-');b.onclick=()=>inspectPart(topic);anatomy.append(b);}
 window.parent.postMessage({type:'rhoda-scope-ready'},location.origin);
 window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==window.parent||event.data?.type!=='rhoda-tour-cue'||typeof event.data.topic!=='string'||!Object.prototype.hasOwnProperty.call(panelHelp,event.data.topic))return;inspectPart(event.data.topic);document.getElementById('coach-text')!.textContent=typeof event.data.text==='string'?event.data.text:panelHelp[event.data.topic];});
 const resize=new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;if(w<=0||h<=0)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();setView(view);});resize.observe(host);
 const inspect=document.getElementById('inspect-status')!;
 const helpSelect=document.getElementById('panel-topic') as HTMLSelectElement;
 Object.keys(panelHelp).forEach(name=>{const option=document.createElement('option');option.value=name;option.textContent=name;helpSelect.append(option);});
 helpSelect.onchange=()=>{if(helpSelect.value)inspectPart(helpSelect.value);};
 document.getElementById('view-save-image')!.onclick=()=>{const a=document.createElement('a');a.href=(screenTexture.image as HTMLCanvasElement).toDataURL('image/png');a.download='rhoda-simulated-display.png';a.click();};

 const selection=new THREE.BoxHelper(interactive[0],0x74e5cb);selection.visible=false;root.add(selection);
 renderer.domElement.addEventListener('pointermove',e=>{if(down&&down.id===e.pointerId&&Math.hypot(e.clientX-down.x,e.clientY-down.y)>6)down.dragged=true;const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(pointer,camera);const hit=pickScopeControl(ray,interactive,enclosure);renderer.domElement.style.cursor=hit?'pointer':'grab';selection.visible=!!hit;if(hit){selection.setFromObject(hit.object);const id=hit.object.userData.control;const name=explanations[id]?.[0]??id.replace('info:','');inspect.textContent=name+(id.startsWith('info:')?' - orientation only':' - click to preview a training action');}});
 renderer.domElement.addEventListener('pointerleave',()=>{selection.visible=false;renderer.domElement.style.cursor='grab';});
 let visible=true;const visibility=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;});visibility.observe(host);
 renderer.setAnimationLoop(()=>{if(!visible||document.hidden)return;orbit.update();renderer.render(scene,camera);});
 window.addEventListener('pagehide',event=>{if(event.persisted)return;renderer.setAnimationLoop(null);visibility.disconnect();resize.disconnect();orbit.dispose();scene.traverse(o=>{const m=o as THREE.Mesh;if(m.geometry)m.geometry.dispose();const materials=m.material?(Array.isArray(m.material)?m.material:[m.material]):[];materials.forEach(mat=>{const map=(mat as THREE.MeshBasicMaterial).map;map?.dispose();mat.dispose();});});renderer.dispose();});
 return {update(frame:any){latestFrame=frame;display.update(frame);knobs.time.rotation.z=-Math.log10(frame.state.timebase_scale)*.6;const selected=Number((document.getElementById('channel-select') as HTMLSelectElement).value)||1;knobs.scale.rotation.z=-Math.log10(frame.state.channels[String(selected)].vertical_scale)*.6;document.getElementById('coach-state')!.textContent=`Simulator readback: CH${selected} ${frame.state.channels[String(selected)].vertical_scale} V/div · ${frame.state.timebase_scale} s/div · ${frame.scenario} · shared ideal source`;},setFreshness(fresh:boolean,message:string){dataStatus.hidden=fresh;dataStatus.textContent=message;if(!fresh)document.getElementById('coach-state')!.textContent=message;},activate};
}
