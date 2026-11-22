import { createSystem } from "@iwsdk/core";
import * as THREE from 'three';
import {firstVisibleRayHit,rayHitKind,rayHitBelongsTo,visibleRayHit} from './raySelection';

type RaySelection={hit:THREE.Intersection<THREE.Object3D>;kind:'dashboard'|'interactable';source:any;session:any;time:number};
const rayRoots=(world:any):THREE.Object3D[]=>[world.dashboardAnchor,world.labRoom,world.rhodeSchwarzMesh].filter(Boolean);
const clearSelection=(world:any)=>{world.lastDashboardIntersect=null;world.lastRhodeSchwarzIntersect=null;};
const publishSelection=(world:any,selection:RaySelection|null)=>{clearSelection(world);if(selection)world[selection.kind==='dashboard'?'lastDashboardIntersect':'lastRhodeSchwarzIntersect']=selection.hit;};
const xrSession=(world:any)=>world.renderer?.xr?.getSession?.()??world.session;

/**
 * HandRaySystem — ported directly from the working khaya-xr implementation.
 * Renders pointer rays from controllers/hands and raycasts against
 * dashboard and avatar meshes.
 */
export class HandRaySystem extends createSystem() {
  private leftRay: THREE.Line | null = null;
  private rightRay: THREE.Line | null = null;
  private rayMaterial!: THREE.LineBasicMaterial;
  private raycaster = new THREE.Raycaster();
  private rayLength = 3;

  init() {
    this.rayMaterial = new THREE.LineBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.6,
      linewidth: 2,
    });

    const rayGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -this.rayLength),
    ]);

    this.leftRay = new THREE.Line(rayGeometry, this.rayMaterial);
    this.rightRay = new THREE.Line(rayGeometry.clone(), this.rayMaterial.clone());
    this.raycaster.far=this.rayLength;

    this.leftRay.visible = false;
    this.rightRay.visible = false;

    this.scene.add(this.leftRay);
    this.scene.add(this.rightRay);

    console.log('🎯 Hand ray system initialized');
  }

  update(_delta: number, _time: number) {
    const session = xrSession(this.world);
    const selections=new Map<any,RaySelection>();
    (this.world as any).handRaySelections=selections;clearSelection(this.world);
    for(const ray of [this.leftRay,this.rightRay])if(ray){ray.visible=false;(ray.material as THREE.LineBasicMaterial).color.set(0x00ffff);ray.scale.z=1;}
    if (!session || !session.inputSources) {
      if (this.leftRay) this.leftRay.visible = false;
      if (this.rightRay) this.rightRay.visible = false;
      return;
    }

    let leftHandFound = false;
    let rightHandFound = false;

    for (const inputSource of session.inputSources) {
      const handedness = inputSource.handedness;
      if (handedness !== 'left' && handedness !== 'right') continue;

      const ray = handedness === 'left' ? this.leftRay : this.rightRay;
      if (!ray) continue;

      // The aiming pose differs from the grip pose; tracked hands may have no grip.
      const pointerSpace = inputSource.targetRaySpace||inputSource.gripSpace;
      if (!pointerSpace) continue;

      const frame = this.renderer.xr.getFrame();
      const referenceSpace = this.renderer.xr.getReferenceSpace();
      if (!frame || !referenceSpace) continue;

      try {
        const gripPose = frame.getPose(pointerSpace, referenceSpace);
        if (!gripPose) continue;

        const transform = gripPose.transform;
        const position = transform.position;
        const orientation = transform.orientation;

        ray.position.set(position.x, position.y, position.z);
        ray.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
        ray.visible = true;

        if (handedness === 'left') leftHandFound = true;
        else rightHandFound = true;

        this.raycaster.set(
          new THREE.Vector3(position.x, position.y, position.z),
          new THREE.Vector3(0, 0, -1).applyQuaternion(ray.quaternion)
        );

        const hit=firstVisibleRayHit(this.raycaster,rayRoots(this.world));
        if(hit){
          ray.scale.z=Math.min(1,hit.distance/this.rayLength);
          const kind=rayHitKind(hit,(this.world as any).dashboardAnchor);
          if(kind){
            (ray.material as THREE.LineBasicMaterial).color.set(kind==='dashboard'?0x00ff00:0xffff00);
            selections.set(inputSource,{hit,kind,source:inputSource,session,time:performance.now()});
          }
        }
      } catch (err) {
        console.warn('Hand ray update error:', err);
      }
    }

    if (!leftHandFound && this.leftRay) this.leftRay.visible = false;
    if (!rightHandFound && this.rightRay) this.rightRay.visible = false;
    // Preserve the legacy field for a single valid pointer. Select events with a
    // source use prepareSelect to resolve that exact hand, never the other hand.
    if(selections.size===1)publishSelection(this.world,selections.values().next().value||null);
  }

  public static prepareSelect(world:any,inputSource?:any){
    const selections=world.handRaySelections as Map<any,RaySelection>|undefined;
    const selection=inputSource?selections?.get(inputSource):selections?.size===1?selections.values().next().value:undefined;
    const age=selection?performance.now()-selection.time:Infinity;
    const session=xrSession(world);
    const valid=selection&&selection.session===session&&
      Array.from(session?.inputSources||[]).includes(selection.source)&&age>=0&&age<=250&&
      visibleRayHit(selection.hit)&&rayHitBelongsTo(selection.hit,rayRoots(world))&&
      rayHitKind(selection.hit,world.dashboardAnchor)===selection.kind;
    publishSelection(world,valid?selection:null);
    return !!valid;
  }

  public static handleSelect(world: any) {
    const intersect = (world as any).lastDashboardIntersect;
    if (!intersect || !intersect.uv) return;

    const uv = intersect.uv;
    const x = uv.x;
    const y = 1 - uv.y;

    console.log(`🎯 Dashboard hit at UV: ${x.toFixed(2)}, ${y.toFixed(2)}`);

    const buttonIds = [
      'btn-talk', 'btn-lang', 'btn-identify', 'btn-summon',
      'btn-follow', 'btn-reset', 'btn-allow', 'btn-deny',
    ];

    let root: Element | null = null;
    try {
      root = document.querySelector('.panel') || document.querySelector('.glass-card') || document.querySelector('[class*="panel"]') || document.body;
    } catch {
      root = document.body;
    }
    if (!root) return;

    const rootRect = root.getBoundingClientRect();
    const clickX = rootRect.left + x * rootRect.width;
    const clickY = rootRect.top + y * rootRect.height;

    for (const id of buttonIds) {
      const el = document.getElementById(id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clickX >= rect.left && clickX <= rect.right &&
          clickY >= rect.top && clickY <= rect.bottom) {
        console.log(`🖱️ Virtual click on #${id}`);
        el.click();
        return;
      }
    }
  }

  cleanup() {
    clearSelection(this.world);(this.world as any).handRaySelections=new Map();
    for(const ray of [this.leftRay,this.rightRay])if(ray){this.scene.remove(ray);ray.geometry.dispose();(ray.material as THREE.Material).dispose();}
    this.leftRay=null;this.rightRay=null;
  }
}
