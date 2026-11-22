import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Authored, illustrative desktop training room. No geometry represents a verified lab inventory. */
export function createLabRoom() {
 const room=new THREE.Group();room.name='RHODA training studio';
 const mats={wall:new THREE.MeshStandardMaterial({color:0xd0d9db,roughness:.9}),floor:new THREE.MeshStandardMaterial({color:0x66767d,roughness:.88}),wood:new THREE.MeshStandardMaterial({color:0x7b6753,roughness:.7}),metal:new THREE.MeshStandardMaterial({color:0x354b55,metalness:.35,roughness:.6}),white:new THREE.MeshStandardMaterial({color:0xd7dddd,roughness:.65}),dark:new THREE.MeshStandardMaterial({color:0x152b34,roughness:.65}),teal:new THREE.MeshStandardMaterial({color:0x227d80,roughness:.65}),light:new THREE.MeshBasicMaterial({color:0xe2f7fa})};
 const boxGeo=new THREE.BoxGeometry(1,1,1);
 function box(w:number,h:number,d:number,x:number,y:number,z:number,mat:THREE.Material){const m=new THREE.Mesh(boxGeo,mat);m.scale.set(w,h,d);m.position.set(x,y,z);room.add(m);return m;}
 function text(value:string,w:number,h:number,x:number,y:number,z:number,color='#d9f3ed',bg='#17343e'){
  const c=document.createElement('canvas');c.width=1024;c.height=Math.round(1024*h/w);const ctx=c.getContext('2d')!;ctx.fillStyle=bg;ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle=color;ctx.font=`500 ${Math.round(c.height*.48)}px Segoe UI`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(value,512,c.height/2,970);
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;
  const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:texture}));m.position.set(x,y,z);room.add(m);return m;
 }
 box(7,.08,9,0,-.065,-2,mats.floor);
 for(let i=-3;i<=3;i++)box(.006,.001,9,i,-.023,-2,mats.metal);
 for(let i=-6;i<=2;i++)box(7,.001,.006,0,-.022,i,mats.metal);
 box(7,3.6,.12,0,1.78,-6,mats.wall);
 box(.12,3.6,9,-3.5,1.78,-2,mats.wall);box(.12,3.6,9,3.5,1.78,-2,mats.wall);
 box(7,.1,9,0,3.6,-2,mats.wall);
 for(const x of [-3.43,3.43]){box(.025,.11,9,x,.06,-2,mats.metal);box(.025,.025,9,x,2.7,-2,mats.metal);}
 box(6.85,.10,.02,0,.06,-5.925,mats.metal);
 // Rear acoustic panels and understated studio signage.
 for(let i=0;i<13;i++)box(.12,1.05,.055,-2.9+i*.18,2.35,-5.90,mats.wood);
 text('RHODA  /  RF TRAINING STUDIO',2.75,.42,.85,2.7,-5.9);
 text('Explore. Measure. Understand.',2.3,.20,.85,2.30,-5.89,'#276567','#d0d9db');
 // Window with mullions and a diffuse sky panel, rather than an empty sky background.
 box(.024,1.48,2.55,-3.42,2.0,-2.8,mats.metal);box(.026,1.36,2.4,-3.399,2,-2.8,mats.light);
 for(const z of [-3.45,-2.8,-2.15])box(.04,1.4,.032,-3.37,2,z,mats.white);
 box(.05,.035,2.4,-3.36,2,-2.8,mats.white);
 // Workbenches, cable trays, storage drawers and calibration preparation space.
 for(const x of [-2.42,2.42]){
  box(1.6,.085,2.9,x,.86,-3.55,mats.wood);box(1.52,.018,2.8,x,.912,-3.55,mats.teal);
  for(const z of [-4.65,-2.45])for(const dx of [-.61,.61])box(.055,.82,.055,x+dx,.42,z,mats.metal);
  box(1.23,.3,.04,x,.63,-4.7,mats.metal);
  box(.60,.68,.73,x,.39,-4.37,mats.white);
  for(const y of [.24,.46,.68]){box(.57,.006,.012,x,y,-3.995,mats.metal);box(.17,.025,.023,x,y+.075,-3.98,mats.metal);}
 }
 function scope(x:number,z:number,id:string){
  const first=room.children.length;
  const shell=new THREE.Mesh(new RoundedBoxGeometry(.61,.34,.24,3,.025),mats.white);shell.position.set(x,1.105,z);room.add(shell);
  box(.34,.218,.012,x-.105,1.11,z+.128,mats.dark);
  const c=document.createElement('canvas');c.width=512;c.height=320;const ctx=c.getContext('2d')!;ctx.fillStyle='#0b1724';ctx.fillRect(0,0,512,320);
  ctx.strokeStyle='#293c49';ctx.lineWidth=1;for(let i=0;i<=10;i++){ctx.beginPath();ctx.moveTo(i*51.2,35);ctx.lineTo(i*51.2,285);ctx.stroke();}for(let i=0;i<=8;i++){ctx.beginPath();ctx.moveTo(0,35+i*31.25);ctx.lineTo(512,35+i*31.25);ctx.stroke();}
  ctx.strokeStyle='#e9d879';ctx.lineWidth=3;ctx.beginPath();for(let i=0;i<512;i++){const y=160-68*Math.sin(i/512*Math.PI*8);i?ctx.lineTo(i,y):ctx.moveTo(i,y);}ctx.stroke();ctx.fillStyle='#acd5d0';ctx.font='16px Segoe UI';ctx.fillText('TRAINING DISPLAY • 1 kHz',16,22);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;const display=new THREE.Mesh(new THREE.PlaneGeometry(.325,.203),new THREE.MeshBasicMaterial({map:t}));display.position.set(x-.105,1.11,z+.136);room.add(display);
  for(const dx of [.115,.215])for(const dy of [1.17,1.045]){const knob=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.028,20),mats.metal);knob.rotation.x=Math.PI/2;knob.position.set(x+dx,dy,z+.145);room.add(knob);}
  for(const dx of [-.2,-.09,.03]){const socket=new THREE.Mesh(new THREE.TorusGeometry(.013,.004,8,20),mats.metal);socket.position.set(x+dx,.974,z+.139);room.add(socket);}
  text('SELECT / OSCILLOSCOPE '+(id==='left'?'A':'B'),.75,.09,x,.80,z+.16,'#e0f7f2','#17343e');
  for(const child of room.children.slice(first)){child.userData.station=id;child.userData.interactable=true;child.userData.onSelect=()=>window.dispatchEvent(new CustomEvent('rhoda-station',{detail:id}));}
 }
 scope(-2.37,-3.0,'left');scope(2.35,-3.4,'right');
 // Benchtop display, notebook and cable coil: useful scale cues without interactive promises.
 box(.65,.4,.04,-2.3,1.2,-4.25,mats.dark);text('SIGNAL WORKSPACE',.60,.29,-2.3,1.2,-4.224,'#81dad2','#112732');
 box(.08,.19,.06,-2.3,.99,-4.25,mats.metal);box(.32,.025,.22,-2.3,.93,-4.22,mats.metal);
 box(.31,.016,.22,2.45,.936,-2.57,mats.white);box(.012,.014,.21,2.30,.948,-2.57,mats.teal);
 for(let i=0;i<3;i++){const cable=new THREE.Mesh(new THREE.TorusGeometry(.09+i*.008,.004,6,40),mats.dark);cable.rotation.x=-Math.PI/2;cable.position.set(-2.12,.942,-2.47);room.add(cable);}
 // Rear shelving with labelled sample storage.
 for(const y of [1.1,1.55]){box(1.6,.04,.28,2.35,y,-5.76,mats.wood);for(const x of [1.75,2.17,2.59])box(.32,.26,.21,x,y+.15,-5.76,mats.white);}
 for(const x of [-1.8,1.8]){box(.12,.018,2.0,x,3.53,-2.9,mats.metal);box(.10,.012,1.92,x,3.513,-2.9,mats.light);}
 const seat=new THREE.Group();room.add(seat);seat.position.set(2.38,0,-1.65);
 const cushion=new THREE.Mesh(new RoundedBoxGeometry(.46,.08,.45,3,.035),mats.dark);cushion.position.y=.52;seat.add(cushion);
 const back=new THREE.Mesh(new RoundedBoxGeometry(.45,.43,.07,3,.03),mats.dark);back.position.set(0,.76,-.20);seat.add(back);
 const post=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,.47,20),mats.metal);post.position.y=.25;seat.add(post);
 for(let i=0;i<5;i++){const a=i*Math.PI*2/5;const leg=new THREE.Mesh(new THREE.BoxGeometry(.045,.04,.30),mats.metal);leg.position.set(Math.sin(a)*.12,.045,Math.cos(a)*.12);leg.rotation.y=a;seat.add(leg);}
 room.traverse(o=>{if((o as THREE.Mesh).isMesh){o.castShadow=true;o.receiveShadow=true;}});
 return room;
}
