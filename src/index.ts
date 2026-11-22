import './labAccessUI';
import {installLabStations} from './labStations';
import {arrivalClearanceHeight,fitDesktopInspection} from './inspectionFraming';
import {placeAvatarOnGround} from './avatarPlacement';
import {bindXRSessionSelect} from './xrSessionEvents';
import {createLabRoom} from './labRoom';
import { installAvatarStyles, updateAvatarVisual, selectedAvatarStyle } from './avatarStyle';
import { sceneStatus } from './xrDesk';
import {installStudioPerformance} from './studioPerformance';
import {
  World,
  createSystem,
  SessionMode,
  OneHandGrabbable,
  XRPlane,
  PanelUI,
  Interactable,
} from "@iwsdk/core";
import * as THREE from 'three';

import { RhodeSchwarzAssistant } from "./rhode_schwarz";
import { HandRaySystem } from "./handRay";

const runtimeEntryTime=performance.now();

World.create(document.getElementById("scene-container") as HTMLDivElement, {
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    offer: "always",
    features: {
      handTracking: true,
      anchors: true,
      hitTest: true,
      planeDetection: true,
      meshDetection: true,
      layers: true,
    },
  },
  features: {
    physics: false, // Disabled to prevent crashes
    grabbing: true,
    sceneUnderstanding: true,
    locomotion: false,
  },
}).then(async (world) => {
  const studioPerformance=installStudioPerformance(world.renderer,runtimeEntryTime);
  world.camera.position.set(0,1.6,1);
  world.scene.add(new THREE.HemisphereLight(0xd8fff5, 0x344654, 1.2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.5); keyLight.position.set(2,4,3); world.scene.add(keyLight);
  world.renderer.shadowMap.enabled=true;world.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  keyLight.castShadow=true;keyLight.shadow.mapSize.set(1024,1024);keyLight.shadow.camera.left=-5;keyLight.shadow.camera.right=5;keyLight.shadow.camera.top=5;keyLight.shadow.camera.bottom=-5;keyLight.shadow.normalBias=.025;
  const stage=createLabRoom();world.scene.add(stage);(world as any).labRoom=stage;
  // Illustrative desktop contact shading, not an estimate of real-world lighting.
  const contactShade=new THREE.Mesh(new THREE.PlaneGeometry(.8,.6),new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,
    vertexShader:'varying vec2 contactUv; void main(){contactUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'varying vec2 contactUv; void main(){float radius=length(contactUv*2.0-1.0);float alpha=.38*(1.0-smoothstep(.08,1.0,radius));gl_FragColor=vec4(.005,.012,.015,alpha);}',
  }));
  contactShade.rotation.x=-Math.PI/2;contactShade.position.y=-.008;contactShade.visible=false;stage.add(contactShade);
  const contactPosition=new THREE.Vector3();
  const originalBackground=world.scene.background;world.scene.background=new THREE.Color(0x10272c);
  world.renderer.xr.addEventListener('sessionstart',()=>{stage.visible=false;world.scene.background=null;document.body.classList.add('immersive');});
  world.renderer.xr.addEventListener('sessionend',()=>{stage.visible=true;world.scene.background=originalBackground||new THREE.Color(0x10272c);document.body.classList.remove('immersive');});
  // --- Rhoda Lab Assistant Logic Starts Here ---
  const rhodeSchwarz = new RhodeSchwarzAssistant(world.scene);
  await rhodeSchwarz.init();
  studioPerformance.mark('avatar-ready');
  sceneStatus(rhodeSchwarz.mesh?.userData.originalAvatarUnavailable
    ? "Lab ready · original avatar unavailable; research companion can load"
    : rhodeSchwarz.mesh ? "Avatar ready · offline lessons available" : "Avatar unavailable · offline lessons still available");

  // 3. Add her to the scene
  if (rhodeSchwarz.mesh) {

    const rhodeSchwarzEntity = world.createTransformEntity(rhodeSchwarz.mesh);
    // Initial position: 1.2m in front of camera, feet on ground, scaled to 1.8m (5'11")
    try {
      // Default camera position: set z=1 so 'in front' placements have a sensible fallback
      let camPos = new THREE.Vector3(0, 0, 1);
      let forward = new THREE.Vector3(0, 0, -1);
      if (world.camera) {
        world.camera.getWorldPosition(camPos);
        world.camera.getWorldDirection(forward);
      }
      // Place Rhode Schwarz 1.7m in front of camera, feet on ground
      const distance = 2.8;
      const targetPos = camPos.clone().add(forward.multiplyScalar(distance));
      targetPos.y = 0;
      if(rhodeSchwarz.mesh.userData.originalAvatarUnavailable){
        // The permitted companion normalizes itself after loading; its empty
        // navigation root needs a finite floor position, not fabricated bounds.
        rhodeSchwarz.mesh.position.copy(targetPos);rhodeSchwarz.mesh.position.y=.01;
      }else if (!placeAvatarOnGround(rhodeSchwarz.mesh, targetPos)) throw new Error('Avatar bounds are unavailable');
      const baseY = rhodeSchwarz.mesh.position.y;
      rhodeSchwarz.setGroundY(baseY);
      (world as any).rhodeSchwarzGroundY = baseY;

      // Face the user
      rhodeSchwarz.mesh.lookAt(camPos.x, rhodeSchwarz.mesh.position.y, camPos.z);
    } catch (err) {
      console.warn('Could not auto-scale/place Rhoda:', err);
    }

    rhodeSchwarzEntity.addComponent(OneHandGrabbable);
    rhodeSchwarzEntity.addComponent(Interactable);

    rhodeSchwarz.mesh.traverse((child: any) => {
      if (child.isMesh) {
        child.userData.interactable = true;
        child.userData.onSelect = () => {
          console.log('👆 Rhoda was selected via ray!');
          rhodeSchwarz.onTouched();
        };
        child.raycast = child.raycast || THREE.Mesh.prototype.raycast;
      }
    });

    rhodeSchwarz.mesh.traverse(o=>{if((o as THREE.Mesh).isMesh)o.castShadow=true;});
    installAvatarStyles(rhodeSchwarz.mesh,()=>rhodeSchwarz.onTouched());
    // Store references on the world for other systems
    (world as any).rhodeSchwarzEntity = rhodeSchwarzEntity;
    (world as any).rhodeSchwarzMesh = rhodeSchwarz.mesh;
    (world as any).rhodeSchwarz = rhodeSchwarz;
  }

  class RhodeSchwarzSystem extends createSystem() {
    update(_delta: number, _time: number) {
      if (this.camera) rhodeSchwarz.update(this.camera, _delta);
      updateAvatarVisual(performance.now()/1000);
      contactShade.visible=!!rhodeSchwarz.mesh&&selectedAvatarStyle()!=='hidden';
      if(contactShade.visible&&rhodeSchwarz.mesh){
        rhodeSchwarz.mesh.getWorldPosition(contactPosition);
        contactShade.position.set(contactPosition.x,-.008,contactPosition.z);
        contactShade.rotation.z=-rhodeSchwarz.mesh.rotation.y;
      }
    }
  }
  world.registerSystem(RhodeSchwarzSystem);

  world.registerSystem(HandRaySystem);

  const dashboardAnchor = new THREE.Group();
  let dashboardLoad:Promise<void>|null=null;
  let dashboardConfigured=false;
  // The SDK already registers PanelUISystem. A hidden desktop panel should not
  // allocate its document/font textures or start its app update system at startup.
  const ensureDashboard=()=>{
    if(dashboardConfigured)return Promise.resolve();
    if(dashboardLoad)return dashboardLoad;
    studioPerformance.mark('spatial-panel-requested');
    dashboardLoad=import('./dashboard').then(({DashboardSystem})=>{
      world.registerSystem(DashboardSystem);
      const dashboardEntity=world.createTransformEntity(dashboardAnchor);
      dashboardEntity.addComponent(PanelUI,{config:'/ui/dashboard.json',maxWidth:1.05,maxHeight:1.35});
      dashboardEntity.addComponent(Interactable);dashboardEntity.addComponent(OneHandGrabbable);
      dashboardConfigured=true;
    }).catch(()=>{
      dashboardLoad=null;dashboardVisible=false;syncDashboardVisibility();
      sceneStatus('Spatial panel could not load. Show spatial panel to retry; desktop lessons remain available.');
    });
    return dashboardLoad;
  };

  (world as any).dashboardAnchor = dashboardAnchor;
  // Ensure the dashboard anchor is attached to the scene root so it's not parented to
  // the camera or any transient object (prevents it from moving with the user).
  try {
    world.scene.add(dashboardAnchor);
  } catch (err) {
    console.warn('Could not add dashboardAnchor to scene root:', err);
  }

  const tmpPos = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();

  const placeDashboardInFront = () => {
    if (!world.camera) return;
    world.camera.getWorldPosition(tmpPos);
    world.camera.getWorldDirection(tmpDir);
    tmpDir.normalize().multiplyScalar(world.renderer.xr.isPresenting ? 1.4 : 1.85);
    dashboardAnchor.position.copy(tmpPos).add(tmpDir);
    dashboardAnchor.position.y = tmpPos.y - 0.1;
    dashboardAnchor.position.x += 0.55;
    dashboardAnchor.lookAt(tmpPos.x, tmpPos.y - 0.1, tmpPos.z);
  };

  let dashboardVisible = false;
  const syncDashboardVisibility=()=>{
    const visible=dashboardVisible&&(!document.body.classList.contains('focus')||world.renderer.xr.isPresenting);
    dashboardAnchor.visible=visible;
    const control=document.getElementById('xr-panel');
    control?.setAttribute('aria-pressed',String(visible));
    if(control)control.textContent=visible?'Hide spatial panel':'Show spatial panel';
  };
  window.addEventListener('rhoda-focus-change',syncDashboardVisibility);
  world.renderer.xr.addEventListener('sessionstart',()=>{dashboardVisible=true;placeDashboardInFront();void ensureDashboard();syncDashboardVisibility();});
  world.renderer.xr.addEventListener('sessionend',syncDashboardVisibility);
  let lastMenuToggle = 0;
  const toggleDashboard = (source: string) => {
    const now = performance.now();
    if (source !== 'desktop button' && now - lastMenuToggle < 250) return;
    lastMenuToggle = now;
    dashboardVisible = !dashboardVisible;
    if (dashboardVisible) {
      // Place once in front of camera but do not keep moving it.
      placeDashboardInFront();
      void ensureDashboard();
    }
    syncDashboardVisibility();
    console.log(`🎛️ Dashboard ${dashboardVisible ? 'shown' : 'hidden'} via ${source}`);
  };

  // Place the dashboard once and keep it visible but static
  placeDashboardInFront();
  syncDashboardVisibility();

  const recenter=document.getElementById('xr-recenter') as HTMLButtonElement;
  const panelButton=document.getElementById('xr-panel') as HTMLButtonElement;
  recenter.disabled=false;panelButton.disabled=false;
  recenter.onclick=()=>{setInspectionView(null);rhodeSchwarz.summon(world.camera,rhodeSchwarz.getGroundY());placeDashboardInFront();};
  syncDashboardVisibility();
  panelButton.onclick=()=>toggleDashboard('desktop button');
  // An offered native session can start while the original avatar is loading.
  if(world.renderer.xr.isPresenting){dashboardVisible=true;placeDashboardInFront();void ensureDashboard();syncDashboardVisibility();}
  const frameRobot=document.getElementById('robot-frame') as HTMLButtonElement;
  const faceRobot=document.getElementById('robot-face') as HTMLButtonElement;
  const handsRobot=document.getElementById('robot-hands') as HTMLButtonElement;
  let summonedWalk=false;
  let summonPhase:ReturnType<RhodeSchwarzAssistant['getMovementSnapshot']>['phase']|null=null;
  function frameSummonedHead(){
    if(world.renderer.xr.isPresenting||!rhodeSchwarz.mesh)return;
    const camera=world.camera as THREE.PerspectiveCamera;
    if(!camera.isPerspectiveCamera)return;
    const center=rhodeSchwarz.mesh.getWorldPosition(new THREE.Vector3());
    // Full body starts with a low, distant camera. Close arrivals need an eye-level
    // view; leave X/Z and the already captured walking destination untouched.
    const visual=rhodeSchwarz.mesh.getObjectByName(selectedAvatarStyle()==='human'?'RHODA_ResearchCompanion':'RHODA_OriginalVisual')||rhodeSchwarz.mesh;
    visual.updateWorldMatrix(true,true);
    const bounds=new THREE.Box3().setFromObject(visual,true),position=camera.getWorldPosition(new THREE.Vector3());
    const canvas=world.renderer.domElement.getBoundingClientRect(),header=document.querySelector('#xr-shell > header')?.getBoundingClientRect();
    const height=arrivalClearanceHeight({minX:bounds.min.x,maxX:bounds.max.x,minY:bounds.min.y,maxY:bounds.max.y+.025,minZ:bounds.min.z,maxZ:bounds.max.z},
      position,center,{height:canvas.height,top:Math.max(0,(header?.bottom||canvas.top)-canvas.top)+16},camera.fov,camera.zoom,center.y+1.35)??center.y+1.35;
    camera.position.y=height;
    camera.lookAt(center.x,height,center.z);
  }
  function syncSummonedWalk(snapshot:ReturnType<RhodeSchwarzAssistant['getMovementSnapshot']>){
    if(!summonedWalk||snapshot.phase===summonPhase)return;
    summonPhase=snapshot.phase;
    if(snapshot.phase==='walking')sceneStatus('Companion approaching');
    else if(snapshot.phase==='paused')sceneStatus('Companion approach paused - show the companion and enable gentle animation to continue');
    else if(snapshot.phase==='blocked')sceneStatus('Companion approach blocked - stop walking or choose a clear floor position');
    else if(snapshot.phase==='arrived'){
      frameSummonedHead();
      sceneStatus(snapshot.adjusted?'Companion arrived at a clear floor position nearby':'Companion arrived - ready to help');
      summonedWalk=false;
    }else if(snapshot.phase==='idle'){
      summonedWalk=false;sceneStatus('Companion stopped');
    }
  }
  function setInspectionView(view:'body'|'face'|'hands'|null){
    frameRobot.setAttribute('aria-pressed',String(view==='body'));
    faceRobot.setAttribute('aria-pressed',String(view==='face'));
    handsRobot.setAttribute('aria-pressed',String(view==='hands'));
  }
  window.addEventListener('rhoda-avatar-placement-change',event=>{
    const detail=(event as CustomEvent<{reason:string;enabled?:boolean}>).detail;
    summonedWalk=detail.reason==='summon';summonPhase=null;
    if(detail.reason==='summon'||detail.enabled)setInspectionView(null);
    if(summonedWalk)frameSummonedHead();
    sceneStatus(detail.reason==='summon'?'Companion approaching':detail.enabled?'Auto-follow enabled - choose an inspection view to stop following':'Auto-follow stopped');
  });
  frameRobot.disabled=faceRobot.disabled=handsRobot.disabled=!rhodeSchwarz.mesh;
  function frameInspection(view:'body'|'face'|'hands',userInitiated=false){
    if(world.renderer.xr.isPresenting||!rhodeSchwarz.mesh)return;
    const camera=world.camera as THREE.PerspectiveCamera;
    if(!camera.isPerspectiveCamera)return;
    if(userInitiated){summonedWalk=false;rhodeSchwarz.stopAutoFollow();}
    const center=rhodeSchwarz.mesh.getWorldPosition(new THREE.Vector3());
    const canvas=world.renderer.domElement.getBoundingClientRect();
    const aspect=Math.max(.01,canvas.width/Math.max(1,canvas.height));
    const visual=rhodeSchwarz.mesh.getObjectByName(selectedAvatarStyle()==='human'?'RHODA_ResearchCompanion':'RHODA_OriginalVisual')||rhodeSchwarz.mesh;
    visual.updateWorldMatrix(true,true);
    // Precise bounds evaluate the current skin pose instead of a cached bind box.
    const bounds=new THREE.Box3().setFromObject(visual,true);
    if(view==='face'){
      const head=visual.getObjectByName('Bip01_Head')||visual.getObjectByName('Head')||visual.getObjectByName('head');
      const point=head?.getWorldPosition(new THREE.Vector3())||new THREE.Vector3(center.x,bounds.max.y-.2,center.z);
      bounds.min.set(point.x-.27,Math.min(point.y-.18,bounds.max.y-.42),point.z-.24);
      bounds.max.set(point.x+.27,bounds.max.y+.04,point.z+.24);
    }else if(view==='hands'){
      const hands=['Bip01_L_Hand','Bip01_R_Hand','LeftHand','RightHand','hand_l','hand_r'].map(name=>visual.getObjectByName(name)).filter((node):node is THREE.Object3D=>!!node);
      if(hands.length){
        bounds.makeEmpty();for(const hand of hands)hand.traverse(node=>bounds.expandByPoint(node.getWorldPosition(new THREE.Vector3())));
        bounds.expandByScalar(.055);
      }else{
        bounds.min.y=center.y+.42;bounds.max.y=center.y+.88;
      }
    }else bounds.expandByScalar(.035);
    sceneStatus(view==='body'?'Full-body desktop view - auto-follow stopped':view==='hands'?'Hands desktop view - auto-follow stopped; pause animation for closer inspection':'Face-detail desktop view - auto-follow stopped; use Full-body view to return');
    const header=document.querySelector('#xr-shell > header')?.getBoundingClientRect();
    const footer=document.querySelector('#xr-shell > footer')?.getBoundingClientRect();
    const fit=fitDesktopInspection({minX:bounds.min.x,maxX:bounds.max.x,minY:bounds.min.y,maxY:bounds.max.y,minZ:bounds.min.z-center.z,maxZ:bounds.max.z-center.z},
      {width:canvas.width,height:canvas.height,top:Math.max(0,(header?.bottom||canvas.top)-canvas.top)+16,bottom:Math.min(canvas.height,(footer?.top||canvas.bottom)-canvas.top)-16},
      camera.fov,camera.zoom,view==='body'?Math.max(3.2,1.4/aspect):view==='hands'?Math.max(1.15,.85/aspect):Math.max(.85,.48/aspect));
    if(!fit)return;
    camera.aspect=aspect;camera.updateProjectionMatrix();
    camera.position.set(fit.x,fit.y,center.z+fit.distance);
    camera.lookAt(fit.x,fit.y,center.z);
    setInspectionView(view);
    if(userInitiated&&innerWidth<=700&&!document.body.classList.contains('focus'))document.getElementById('focus-view')!.click();
  }
  // Initial framing must not hide the learning controls on a narrow screen.
  frameInspection('body');
  rhodeSchwarz.useLabNavigation(true);
  let desktopPlacement:{position:THREE.Vector3;rotation:THREE.Quaternion;scale:THREE.Vector3;ground:number;camera:THREE.Vector3;view:THREE.Quaternion}|null=null;
  world.renderer.xr.addEventListener('sessionstart',()=>{
    summonedWalk=false;
    if(rhodeSchwarz.mesh)desktopPlacement={position:rhodeSchwarz.mesh.position.clone(),rotation:rhodeSchwarz.mesh.quaternion.clone(),scale:rhodeSchwarz.mesh.scale.clone(),ground:rhodeSchwarz.getGroundY(),camera:world.camera.position.clone(),view:world.camera.quaternion.clone()};
    rhodeSchwarz.stopAutoFollow();rhodeSchwarz.useLabNavigation(false);
  });
  world.renderer.xr.addEventListener('sessionend',()=>{
    rhodeSchwarz.stopAutoFollow();
    if(desktopPlacement&&rhodeSchwarz.mesh){rhodeSchwarz.mesh.position.copy(desktopPlacement.position);rhodeSchwarz.mesh.quaternion.copy(desktopPlacement.rotation);rhodeSchwarz.mesh.scale.copy(desktopPlacement.scale);rhodeSchwarz.setGroundY(desktopPlacement.ground);world.camera.position.copy(desktopPlacement.camera);world.camera.quaternion.copy(desktopPlacement.view);desktopPlacement=null;}
    rhodeSchwarz.useLabNavigation(true);sceneStatus('Desktop lab restored. Choose a station or start following.');
  });
  installLabStations(world.camera,world.renderer,stage,rhodeSchwarz,()=>{summonedWalk=false;setInspectionView(null);},world.scene,syncSummonedWalk);
  frameRobot.onclick=()=>frameInspection('body',true);
  faceRobot.onclick=()=>frameInspection('face',true);
  handsRobot.onclick=()=>frameInspection('hands',true);
  const reframeInspection=()=>{
    if(frameRobot.getAttribute('aria-pressed')==='true')frameInspection('body');
    else if(faceRobot.getAttribute('aria-pressed')==='true')frameInspection('face');
    else if(handsRobot.getAttribute('aria-pressed')==='true')frameInspection('hands');
  };
  window.addEventListener('resize',reframeInspection);
  window.addEventListener('rhoda-focus-change',reframeInspection);
  world.renderer.xr.addEventListener('sessionstart',()=>{setInspectionView(null);frameRobot.disabled=faceRobot.disabled=handsRobot.disabled=true;});
  world.renderer.xr.addEventListener('sessionend',()=>{frameRobot.disabled=faceRobot.disabled=handsRobot.disabled=!rhodeSchwarz.mesh;});

  window.addEventListener("keydown", (evt) => {
    if ((evt.target as HTMLElement)?.closest("input,select,textarea,button")) return;
    if (evt.key === "m" || evt.key === "M") {
      toggleDashboard("keyboard");
    }
  });

  // Placement system: waits for detected planes and places Rhode Schwarz on the best floor/table plane
  class PlacementSystem extends createSystem({ planeEntities: { required: [XRPlane] } }) {
    private placedSession: XRSession | null = null;

    update(_delta: number, _time: number) {
      const session = world.renderer.xr.getSession();
      if (!session || session === this.placedSession) return;
      const planes = this.queries.planeEntities?.entities as Set<any> | undefined;
      if (!planes || planes.size === 0) return;

      const camPos = new THREE.Vector3();
      this.camera.getWorldPosition(camPos);
      // Prefer the lowest plane that is noticeably below the camera (likely the floor).
      // This avoids choosing a shelf/table at head height.
      let best: any = null;
      let bestY = Infinity;
      for (const e of planes) {
        // Vertical walls must never become the avatar's ground plane.
        if (e.getValue(XRPlane, '_plane')?.orientation !== 'horizontal') continue;
        const obj = (e as any).object3D as THREE.Object3D | undefined;
        if (!obj) continue;
        const p = new THREE.Vector3();
        obj.getWorldPosition(p);
        // prefer planes at least 0.3m below the camera (so we avoid high shelves)
        if (p.y < camPos.y - 0.3 && p.y < bestY && p.distanceTo(camPos) < 5) {
          bestY = p.y;
          best = { entity: e, pos: p };
        }
      }

      if (!best) return;

      const rsMesh = (this.world as any).rhodeSchwarzMesh as THREE.Object3D | undefined;
      if (!rsMesh) return;

      try {
        // Keep the normalized scale. A greeting pose can have a taller bound
        // than the resting pose and must not shrink the character on XR entry.
        if (!placeAvatarOnGround(rsMesh, best.pos, null)) return;
        const groundedY = rsMesh.position.y;

        // Face the user (rotate to look at camera)
        if (this.camera) {
          const camPos = new THREE.Vector3();
          this.camera.getWorldPosition(camPos);
          rsMesh.lookAt(camPos.x, rsMesh.position.y, camPos.z);
        }

        const rsAssistant = (this.world as any).rhodeSchwarz as RhodeSchwarzAssistant | undefined;
        rsAssistant?.setGroundY(groundedY);
        (this.world as any).rhodeSchwarzGroundY = groundedY;

        this.placedSession = session;
      } catch (err) {
        console.warn('Placement system error:', err);
      }
    }
  }
  world.registerSystem(PlacementSystem);

  const selectCompanion = (evt: XRInputSourceEvent) => {
    HandRaySystem.prepareSelect(world, evt?.inputSource);

    if ((world as any).lastRhodeSchwarzIntersect) {
      console.log('👆 Interacting with Rhoda via ray!');
      const hit=(world as any).lastRhodeSchwarzIntersect;
      if(hit.object.userData.station)hit.object.userData.onSelect?.();else rhodeSchwarz.onTouched();
      return; // Consume event
    }

    // PanelUI uses the SDK's multiPointers. Do not duplicate its click with
    // a UV-to-DOM approximation against unrelated desktop controls.
    if ((world as any).lastDashboardIntersect) {
      return; // Consume event if we hit the dashboard
    }

    const handedness = evt?.inputSource?.handedness;
    if (handedness === 'left') {
      toggleDashboard('left-select');
      return;
    }

    if (rhodeSchwarz.getState() === 'READY') {
      console.log('📢 Starting to listen...');
      void rhodeSchwarz.startListening();
    } else if (rhodeSchwarz.getState() === 'LISTENING') {
      console.log('🤐 Stopping listen...');
      void rhodeSchwarz.stopListening();
    }
  };
  const disposeXRSelect=bindXRSessionSelect(world.renderer.xr,selectCompanion);
  window.addEventListener('pagehide',event=>{if(!event.persisted)disposeXRSelect();});

  console.log('Rhoda desktop studio ready; XR interaction requires a compatible session.');
  studioPerformance.mark('studio-ready');
}).catch(() => {
  sceneStatus('3D scene could not start. Offline lessons and resource links remain available.');
  document.getElementById('avatar-status')!.textContent='Avatar unavailable - the scene or model could not load.';
  document.getElementById('avatar-retry')!.hidden=false;
  document.getElementById('xr-loading')!.textContent='Scene unavailable';
});
