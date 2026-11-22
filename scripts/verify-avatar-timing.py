import subprocess,json
B='C:/Users/trick/.cache/rhoda-browser/node_modules/agent-browser/bin/agent-browser-win32-x64.exe'
s=r'''(async()=>{
 const {RhodeSchwarzAssistant}=await import('/src/rhode_schwarz.ts');
 const source=await (await fetch('/src/rhode_schwarz.ts')).text();const motionPath=source.match(/from ["']([^"']*avatarStyle[^"']*)["']/)?.[1];if(!motionPath)throw Error('Motion module import missing');const motion=await import(motionPath);const prior=localStorage.getItem('rhoda-robot-motion');const priorStyle=motion.selectedAvatarStyle();motion.setAvatar('ceramic');motion.setRobotMotion(true);
 try {
 const camera={getWorldPosition(v){v.set(0,1.6,2)}};
 let sum=0,last=-1,head=-1;
 const state={mesh:{position:{y:0},lookAt(){}},mixer:{update(d){sum+=d;last=d}},blinkStartTime:Date.now(),blinkPeriod:5,eyeObjects:new Set(),updateHeadTracking(c,d){head=d},autoFollow:false};
 for(const fps of [30,60,90,120]){sum=0;for(let i=0;i<fps;i++)RhodeSchwarzAssistant.prototype.update.call(state,camera,1/fps);if(Math.abs(sum-1)>1e-10)throw Error('Rate mismatch '+fps);}
 for(const [input,expected] of [[10,.1],[-1,0],[NaN,0],[Infinity,0]]){RhodeSchwarzAssistant.prototype.update.call(state,camera,input);if(last!==expected||head!==expected)throw Error('Unsafe frame delta');}
 const THREE=await import('/node_modules/three/build/three.module.js');
 const positions=[];const followCamera={getWorldPosition(v){v.set(10,0,0)}};
 for(const fps of [30,60,90,120]){
  const moving={mesh:{position:new THREE.Vector3(),lookAt(){}},tmpVecA:new THREE.Vector3(),tmpVecB:new THREE.Vector3(),tmpVecC:new THREE.Vector3()};
  for(let i=0;i<fps/5;i++)RhodeSchwarzAssistant.prototype.followTowardsCamera.call(moving,followCamera,0,1/fps);
  positions.push(moving.mesh.position.x);
  const before=moving.mesh.position.clone();RhodeSchwarzAssistant.prototype.followTowardsCamera.call(moving,followCamera,0,0);
  if(!moving.mesh.position.equals(before))throw Error('Zero-delta movement');
 }
 if(positions.some(x=>Math.abs(x-positions[0])>1e-10))throw Error('Follow speed varies with frame rate');
 const makeFollower=()=>({mesh:{position:new THREE.Vector3(0,.2,0),lookAt(){}},tmpVecA:new THREE.Vector3(),tmpVecB:new THREE.Vector3(),tmpVecC:new THREE.Vector3()});
 const heightPositions=[];
 for(const height of [1.1,1.8,2.5]){
  const moving=makeFollower();const nearCamera={getWorldPosition(v){v.set(1.9,height,0)}};
  const before=moving.mesh.position.clone();RhodeSchwarzAssistant.prototype.followTowardsCamera.call(moving,nearCamera,.2,1/60);
  if(!moving.mesh.position.equals(before))throw Error('Camera height triggered unnecessary approach');
  const farCamera={getWorldPosition(v){v.set(10,height,0)}};
  RhodeSchwarzAssistant.prototype.followTowardsCamera.call(moving,farCamera,.2,1/60);heightPositions.push(moving.mesh.position.x);
  if(moving.mesh.position.y!==.2)throw Error('Ground height drift');
 }
 if(heightPositions.some(x=>Math.abs(x-heightPositions[0])>1e-10))throw Error('Camera height changed approach target');
 const overhead=makeFollower();RhodeSchwarzAssistant.prototype.followTowardsCamera.call(overhead,{getWorldPosition(v){v.set(0,3,0)}},.2,1/60);
 if(!overhead.mesh.position.equals(new THREE.Vector3(0,.2,0)))throw Error('Overhead camera moved avatar');
 const lookPositions=[];
 const lookCamera={getWorldPosition(v){v.set(.5,1.5,3)}};
 for(const fps of [30,60,90,120]){
  const tracking={headBaseRotationX:0,headBone:new THREE.Object3D(),mesh:new THREE.Group(),currentState:'PROCESSING',currentLookAt:new THREE.Vector3(),lookAtTarget:new THREE.Vector3()};
  for(let i=0;i<fps;i++)RhodeSchwarzAssistant.prototype.updateHeadTracking.call(tracking,lookCamera,1/fps);
  lookPositions.push(tracking.currentLookAt.clone());
  if(Math.abs(tracking.headBone.quaternion.length()-1)>1e-10)throw Error('Head rotation not normalized');
  const before=tracking.headBone.quaternion.clone();RhodeSchwarzAssistant.prototype.updateHeadTracking.call(tracking,lookCamera,0);
  if(before.angleTo(tracking.headBone.quaternion)>1e-7)throw Error('Head moves at zero delta');
 }
 if(lookPositions.some(v=>v.distanceTo(lookPositions[0])>1e-10))throw Error('Gaze target response depends on frame rate');
 const slow={headBaseRotationX:0,headBone:new THREE.Object3D(),mesh:new THREE.Group(),currentState:'PROCESSING',currentLookAt:new THREE.Vector3(),lookAtTarget:new THREE.Vector3()};
 RhodeSchwarzAssistant.prototype.updateHeadTracking.call(slow,lookCamera,.1);
 if(slow.currentLookAt.x<0||slow.currentLookAt.x>.5||slow.currentLookAt.y>1.5||slow.currentLookAt.z>3)throw Error('Gaze overshoot');
 const body=new THREE.Group();const headBone=new THREE.Object3D();headBone.position.y=1.5;body.add(headBone);body.position.set(4,.3,-2);body.scale.setScalar(1.2);body.updateMatrixWorld(true);
 const headPosition=headBone.getWorldPosition(new THREE.Vector3());const eyeLevel=headPosition.clone().add(new THREE.Vector3(0,0,3));
 const neutral={headBaseRotationX:-.12,headBone,mesh:body,currentState:'PROCESSING',currentLookAt:eyeLevel.clone(),lookAtTarget:eyeLevel.clone()};
 const levelCamera={getWorldPosition(v){v.copy(eyeLevel)}};
 for(let i=0;i<180;i++)RhodeSchwarzAssistant.prototype.updateHeadTracking.call(neutral,levelCamera,1/60);
 const expectedHead=new THREE.Quaternion().setFromEuler(new THREE.Euler(-.12,0,0,'YXZ'));
 if(headBone.quaternion.angleTo(expectedHead)>1e-4)throw Error('Eye-level gaze does not preserve neutral head pose');
 for(const [x,y,z,pitch,yaw] of [[3,0,0,0,Math.PI/3],[-3,0,0,0,-Math.PI/3],[0,0,-3,0,Math.PI/3],[3,1,0,Math.atan2(1,3),Math.PI/3]]){
  const target=new THREE.Vector3(x,y,z);const angled={headBaseRotationX:0,headBone:new THREE.Object3D(),mesh:new THREE.Group(),currentState:'PROCESSING',currentLookAt:target.clone(),lookAtTarget:target.clone()};
  const angledCamera={getWorldPosition(v){v.copy(target)}};
  for(let i=0;i<180;i++)RhodeSchwarzAssistant.prototype.updateHeadTracking.call(angled,angledCamera,1/60);
  const expected=new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch,yaw,0,'YXZ'));
  if(angled.headBone.quaternion.angleTo(expected)>1e-4)throw Error('Incorrect side-angle gaze pitch');
 }
 let calls=0;const eye={visible:false};
 const paused={mesh:{position:{y:0},lookAt(){calls++}},mixer:{update(){calls++}},blinkStartTime:Date.now(),blinkPeriod:5,eyeObjects:new Set([eye]),updateHeadTracking(){calls++},autoFollow:true,followTowardsCamera(){calls++}};
 motion.setRobotMotion(false);RhodeSchwarzAssistant.prototype.update.call(paused,camera,1/60);
 if(calls!==0||!eye.visible)throw Error('Reduced motion pause failed: calls='+calls+' eye='+eye.visible+' preference='+motion.avatarMotionEnabled());
 motion.setRobotMotion(true);RhodeSchwarzAssistant.prototype.update.call(paused,camera,1/60);
 if(calls!==4)throw Error('Motion did not resume');
 calls=0;motion.setAvatar('hidden');RhodeSchwarzAssistant.prototype.update.call(paused,camera,1/60);
 if(calls!==0)throw Error('Hidden avatar still updates');
 calls=0;motion.setAvatar('robot');RhodeSchwarzAssistant.prototype.update.call(paused,camera,1/60);
 if(calls!==2)throw Error('Robot should retain facing/follow without human rig updates');
 calls=0;motion.setAvatar('ceramic');RhodeSchwarzAssistant.prototype.update.call(paused,camera,1/60);
 if(calls!==4)throw Error('Human rig did not resume');
 const followIntent={autoFollow:true};RhodeSchwarzAssistant.prototype.stopAutoFollow.call(followIntent);
 if(RhodeSchwarzAssistant.prototype.isAutoFollowEnabled.call(followIntent))throw Error('Inspection follow stop failed');
 if(!RhodeSchwarzAssistant.prototype.toggleAutoFollow.call(followIntent))throw Error('Cannot resume follow after inspection');
 return 'PASS explicit follow stop/resume; hidden/robot rig suspension and human resume; shared motion pause/resume; side-angle pitch and yaw limits; head-relative eye-level gaze; gaze damping; seated/standing spacing and ground height; follow movement at 30/60/90/120 fps; one-second animation duration at 30/60/90/120 fps; resume and invalid-delta guards';
 }finally{motion.setAvatar(priorStyle);if(prior===null)motion.useDeviceMotion();else motion.setRobotMotion(prior==='true');}
})()'''
result=subprocess.run([B,'--session','rhoda-avatar','--json','eval',s],capture_output=True,text=True,encoding='utf-8',timeout=45)
r=json.loads(result.stdout);assert r['success'],r;print(r['data'].get('result'))
