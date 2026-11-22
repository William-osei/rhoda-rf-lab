import {inPlaceWalk} from './inPlaceWalk';
import {companionNod} from './companionAnimation';
import {AvatarActionTransition,AvatarAnimationController,registerAvatarAnimationController,type AvatarAnimationDefinition} from './avatarAnimations';
import {planLabRoute,segmentIsClear,type FloorPoint} from './labNavigation';
import { avatarMotionEnabled, selectedAvatarStyle } from './avatarStyle';
import { sharedAssistanceContext } from './assistantContext';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { transcribeAudio, translateText, askGemini, textToSpeech, geminiTranscribeAudio, geminiTTS, type ChatTurn } from './genai';
import { AudioRecorder } from './audioRecorder';
import { AudioFeedback } from './audioFeedback';
import rawAnimationManifest from './animation-manifest.json';
import { sessionLogger } from './session';
import { getContextForQuery } from './rag';
import { readState } from './instrumentApi';
import { executeFunction, getInstrumentState, getPendingConfirmation, confirmPending, denyPending } from './instrument';
import { diagnoseTrace } from './anomaly';
import { getNudge } from './progress';
import { getActiveWorkflow, getCurrentStep, advanceStep, getWorkflowContext, startWorkflow, getTotalSteps } from './workflows';

export type RhodeSchwarzState = 'READY' | 'LISTENING' | 'PROCESSING' | 'SPEAKING';
// Public source intentionally has an empty optional animation library. Keep
// element types explicit instead of inferring never[] from empty JSON arrays.
const manifest: Record<'idle' | 'dance' | 'expression' | 'locomotion', string[]> = rawAnimationManifest;

export class RhodeSchwarzAssistant {
  // Animation system
  private mixer: THREE.AnimationMixer | null = null;
  private idleAction: THREE.AnimationAction | null = null;
  private idleAnimations: THREE.AnimationAction[] = [];
  private currentIdleIndex: number = 0;

  // New Animation Categories

  private exprAnimations: THREE.AnimationAction[] = [];
  private currentExprIndex: number = 0;

  private locoAnimations: THREE.AnimationAction[] = [];
  private currentLocoIndex: number = 0;

  private talkingAction: THREE.AnimationAction | null = null;

  private currentAction: THREE.AnimationAction | null = null;
  private animationLoads = new Map<string, Promise<THREE.AnimationAction | null>>();
  private animationVariations = new Map<string, Promise<void>>();
  private animationActions = new Map<string,THREE.AnimationAction>();
  private animationPreview:AvatarAnimationController|null=null;
  private animationTransition:AvatarActionTransition|null=null;
  private previewCycle = new Map<string,number>();

  public getGroundY(): number {
    return this.groundY ?? 0;
  }
  private leftArmBone: THREE.Object3D | null = null;
  private rightArmBone: THREE.Object3D | null = null;
  private headBone: THREE.Object3D | null = null;
  private headBaseRotationX: number = 0;

  // Blinking state
  private blinkStartTime: number = Date.now();
  private blinkPeriod: number = 4.5; // Will be set once after model loads
  private leftEyeMesh: THREE.Mesh | null = null;
  private rightEyeMesh: THREE.Mesh | null = null;
  private eyeObjects: Set<THREE.Object3D> = new Set(); // Use Set to avoid duplicates

  private mouthMesh: THREE.Mesh | null = null;
  private mouthMorphIndex: number | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserData: Uint8Array | null = null;
  private mouthAnimatorId: number | null = null;

  // Movement + positioning state
  private autoFollow = false;
  private approachTarget: THREE.Vector3 | null = null;
  private wasWalking = false;
  private walkAnimationStyle='';
  private roomNavigation=false;
  private route:FloorPoint[]=[];
  private routeGoal:THREE.Vector3|null=null;
  private walkingSpeed=.65;
  private followDistance=1.7;
  private walkVelocity=0;
  private routeLength=0;
  private routeTravelled=0;
  private movementPhase:'idle'|'walking'|'waiting'|'arrived'|'blocked'|'paused'='idle';
  private destinationAdjusted=false;
  private groundY: number | null = null;
  private tmpVecA = new THREE.Vector3();
  private tmpVecB = new THREE.Vector3();
  private tmpVecC = new THREE.Vector3();

  // Speech recognition helpers
  private audioRecorder = new AudioRecorder();
  private audioFeedback = new AudioFeedback();
  private currentState: RhodeSchwarzState = 'READY';
  private muted: boolean = true;
  private silenceMonitorId: number | null = null;
  private silenceIntervalId: number | null = null;
  private speechThreshold: number = 0.025;
  private silenceRequiredMs: number = 1200; // ms of silence after speech to auto-stop
  private hasHeardSpeechWhileRecording: boolean = false;
  private fastMode: boolean = false; // when true, short-circuit UI delays and use tighter silence timing
  private isRecording: boolean = false;
  private listeningRevision = 0;
  private microphonePending = false;
  private statusLabel: string = 'READY';
  private language: 'en' | 'tw' = 'en';
  private conversationHistory: ChatTurn[] = [];


  /** Legacy dashboard controls use the same bounded preview and priority rules. */
  public async cycleIdleAnimation(){return this.cycleAnimationPreview("idle");}
  public async cycleExpression(){return this.cycleAnimationPreview("expression");}
  public async cycleLocomotion(){return this.cycleAnimationPreview("locomotion");}
  private async cycleAnimationPreview(category: "idle"|"expression"|"locomotion"){
    const paths=manifest[category];if(!paths.length||!this.animationPreview)return false;
    const index=((this.previewCycle.get(category)??-1)+1)%paths.length;this.previewCycle.set(category,index);
    const name=paths[index].split("/").pop()!.replace(".glb","");
    return this.animationPreview.play("clip:"+category+":"+name);
  }

  public mesh: THREE.Group | null = null;
  private scene: THREE.Scene;
  public lastResponse: string = "";
  public currentTranscript: string = "";

  // Caption system removed; rely on dashboard status only

  // Audio context for XR-compatible playback
  private audioContext: AudioContext | null = null;
  private currentAudioSource: AudioBufferSourceNode | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    window.addEventListener('pagehide',()=>{
      if(this.currentState==='LISTENING'){
        this.cancelListeningCapture();this.currentState='READY';this.setStatusLabel('READY');
      }
    });
  }

  // Expose auto-follow state for UI to read (DashboardSystem reads this)
  public isAutoFollowEnabled(): boolean {
    return !!this.autoFollow;
  }

  // Load the GLB model from the public folder
  async init(): Promise<void> {
    // Public source bundles omit the separately licensed original avatar. Keep
    // the assistant's navigation/speech root so the permitted human companion
    // and offline lessons can still initialize. No replacement robot is drawn.
    const prepareCompanionRoot = () => {
      this.mesh = new THREE.Group();
      this.mesh.name = 'RHODA_NavigationRoot';
      this.mesh.userData.originalAvatarUnavailable = true;
      this.mesh.position.set(0, 0, -1);
      this.scene.add(this.mesh);
    };
    if (document.body.dataset.originalAvatar === 'unavailable') {
      prepareCompanionRoot();
      return;
    }
    return new Promise((resolve) => {
      const loader = new GLTFLoader();
      // Use absolute public path so Vite serves from /gltf
      loader.load('/gltf/rhode_schwarz-character.glb', (gltf: any) => {
        this.mesh = gltf.scene as THREE.Group;
        // Add to scene first so Box3 can calculate correctly
        this.scene.add(this.mesh);

        // Default position in front of user; will be adjusted by world code
        this.mesh.position.set(0, 0, -1);

        // If the caller passed a camera earlier (we don't have it here), scaling
        // will be adjusted from index.ts by calling `fitToHeight` in the system.
        // Set a conservative default scale
        this.mesh.scale.set(1, 1, 1);

        // Find all bones and meshes for animation and interaction
        console.log('🔍 Scanning GLB model structure...');
        let armBoneCount = 0;
        this.mesh.traverse((child: any) => {
          if (!child.name) return;

          if (child.isBone) {
            // ... existing bone logic if needed, but keeping it brief to focus on meshes
            if (/left.*arm/i.test(child.name)) this.leftArmBone = child;
            if (/right.*arm/i.test(child.name)) this.rightArmBone = child;
            if (/head/i.test(child.name)) {
              this.headBone = child;
              this.headBaseRotationX = child.rotation.x || 0;
              console.log('  ✅ HEAD BONE found:', child.name);
            }
            if (/jaw|teeth/i.test(child.name) && child.isBone) {
              console.log('  🦴 JAW/TEETH BONE found:', child.name);
            }
          }

          if (child.isMesh) {
            // Log if it has morph targets
            if (child.morphTargetDictionary) {
              console.log(`  🗿 MESH WITH MORPHS: "${child.name}"`);
              console.log(`     KEYS: ${Object.keys(child.morphTargetDictionary).join(', ')}`);

              // Heuristic: If this mesh has "Head" or "Body" or "Face" in name, it's likely the one we want
              // OR if it has keys like "mouthOpen", "JawOpen"
              const keys = Object.keys(child.morphTargetDictionary);
              const hasMouthMorph = keys.some(k => /mouth|jaw|open/i.test(k));

              if (hasMouthMorph && (/head|face|body/i.test(child.name) || keys.length > 5)) {
                this.mouthMesh = child;
                // Find best morph
                const bestKey = keys.find(k => /jaw.*open/i.test(k)) ||
                  keys.find(k => /mouth.*open/i.test(k)) ||
                  keys.find(k => /open/i.test(k)) ||
                  keys[0];

                if (bestKey) {
                  this.mouthMorphIndex = child.morphTargetDictionary[bestKey];
                  console.log(`  ✅ SELECTED MOUTH MESH: "${child.name}" using morph "${bestKey}" (index ${this.mouthMorphIndex})`);
                }
              }
            }

            // Auto-detect eyes for blinking (existing logic)
            if (/left.*eye/i.test(child.name)) { this.leftEyeMesh = child; this.eyeObjects.add(child); }
            else if (/right.*eye/i.test(child.name)) { this.rightEyeMesh = child; this.eyeObjects.add(child); }
            else if (/eye/i.test(child.name)) { this.eyeObjects.add(child); }
          }
        });
        this.blinkPeriod = 4.5 + Math.random() * 1.5;

        // Load animations
        this.loadAnimations().then(() => {
          console.log('✅ Animations loaded successfully');

          // Auto-detect immersive/VR user agents to enable fastMode for snappier pipeline
          try {
            const ua = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '';
            if (/oculus|quest|meta|vr|xr/i.test(ua)) {
              this.setFastMode(true);
              console.log('🛰️ Immersive UA detected - fastMode enabled');
            }
          } catch (e) {
            // ignore
          }

          // After loading model and animations, attempt to auto-start listening if not muted.
          // This will prompt for mic permission on first run.
          (async () => {
            try {
              if (!this.muted) {
                await this.startListening();
              }
            } catch (err) {
              console.warn('⚠️ Auto-start listening failed (permissions?):', err);
              // Inform UI that mic permission is required / awaiting user gesture
              this.setStatusLabel('Press UNMUTE to start');
            }
          })();
          resolve();
        }).catch((err) => {
          console.warn('⚠️ Failed to load animations, continuing without them:', err);
          resolve(); // Still resolve even if animations fail
        });
      }, undefined, (err: any) => {
        console.warn('Original avatar unavailable; preparing the permitted research companion.', err);
        prepareCompanionRoot();
        resolve();
      });
    });
  }

  // Load idle and talking animations
  private async loadAnimations(): Promise<void> {
    if (!this.mesh) {
      throw new Error('Mesh not loaded yet');
    }

    // Create animation mixer
    this.mixer = new THREE.AnimationMixer(this.mesh);
    console.log('🎬 Loading animations...');

    // Load animations from manifest
    // LAZY LOAD: Load only the first idle animation critically to unblock startup
    const idleFiles = manifest.idle || [];
    if (idleFiles.length > 0) {
      console.log('🎬 Loading primary idle:', idleFiles[0]);
      try {
        await this.loadAvatarAnimation(idleFiles[0], 'idle');
      } catch (e) {
        console.warn('⚠️ Failed to critical load idle:', e);
      }
    }

    this.installAnimationPreview();
    // Load only the remaining core gait/talking clips; previews stay on demand.
    void this.loadStartupAnimations();
  }

  private loadAvatarAnimation(path:string,category:'idle'|'expression'|'locomotion'|'dance') {
    const existing=this.animationLoads.get(path);if(existing)return existing;
    const load=(async()=>{
      try{
        const gltf=await new Promise<any>((resolve,reject)=>new GLTFLoader().load(path,resolve,undefined,reject));
        if(!this.mixer||!gltf.animations?.length)return null;
        const source=gltf.animations[0] as THREE.AnimationClip;
        // These authored files share all 62 target nodes with the original rig.
        // Keep preview travel in place, including dances with lateral hip keys.
        const clip=category==='locomotion'||category==='dance'?inPlaceWalk(source):source.clone();
        if(!this.mesh||!clip.tracks.length||clip.tracks.some(track=>{
          const binding=THREE.PropertyBinding.parseTrackName(track.name);
          return !this.mesh!.getObjectByName(binding.nodeName)||!Array.from(track.values).every(Number.isFinite);
        }))return null;
        clip.name=path.split('/').pop()?.replace('.glb','')||clip.name;
        const action=this.mixer.clipAction(clip);action.setLoop(THREE.LoopRepeat,Infinity);
        this.animationActions.set(path,action);
        if(category==='idle'){
          this.idleAnimations.push(action);
          if(!this.idleAction){this.idleAction=action;if(!this.currentAction){action.play();this.mixer.update(0);this.currentAction=action;}}
        }else if(category==='expression'){
          this.exprAnimations.push(action);if(!this.talkingAction)this.talkingAction=action;
        }else if(category==='locomotion'){
          this.locoAnimations.push(action);
          if(this.wasWalking&&clip.name==='F_Walk_002')this.switchAnimation(action,.2);
        }
        this.animationPreview?.markReady('clip:'+category+':'+clip.name,action);
        if(path===manifest.idle[0])this.animationPreview?.markReady('idle',action);
        if(path===manifest.expression[0])this.animationPreview?.markReady('explain',action);
        if(clip.name==='F_Walk_002')this.animationPreview?.markReady('walk',action);
        return action;
      }catch(error){console.warn('Optional avatar animation unavailable:',path,error);return null;}
    })();
    const retryable=load.then(action=>{if(!action)this.animationLoads.delete(path);return action;});
    this.animationLoads.set(path,retryable);return retryable;
  }

  private installAnimationPreview(){
    if(!this.mixer||!this.mesh)return;
    this.animationTransition=new AvatarActionTransition(this.mixer);
    const definitions:AvatarAnimationDefinition[]=[
      {id:'idle',label:'Relaxed idle',group:'Shared previews',action:this.idleAction},
      {id:'nod',label:'Acknowledgement nod',group:'Shared previews'},
      {id:'explain',label:'Friendly explanation gesture',group:'Shared previews',action:this.talkingAction},
      {id:'walk',label:'Walk in place',group:'Shared previews'},
    ];
    const paths=new Map<string,{path:string;category:'idle'|'expression'|'locomotion'|'dance'}>();
    const groups={idle:'Idle',expression:'Explanation',locomotion:'Walking preview',dance:'Dance preview'};
    for(const category of ['idle','expression','locomotion','dance'] as const)for(const path of manifest[category]){
      const name=path.split('/').pop()!.replace('.glb',''),id='clip:'+category+':'+name;
      const label=name.replace(/^F_/,'').replace(/_/g,' ').replace(/\b0+(\d+)\b/g,'$1');
      paths.set(id,{path,category});definitions.push({id,label,group:groups[category],action:this.animationActions.get(path)});
    }
    paths.set('idle',{path:manifest.idle[0],category:'idle'});
    paths.set('explain',{path:manifest.expression[0],category:'expression'});
    paths.set('walk',{path:manifest.locomotion.find(path=>path.endsWith('/F_Walk_002.glb'))!,category:'locomotion'});
    this.animationPreview=new AvatarAnimationController({
      mixer:this.mixer,definitions,
      context:()=>({visible:selectedAvatarStyle()==='rhoda',enabled:avatarMotionEnabled(),walking:this.wasWalking||this.movementPhase==='walking',speaking:this.currentState==='SPEAKING'||!!this.mesh?.userData.narrating}),
      load:async id=>{
        if(id==='nod'){
          if(!this.idleAction)for(const path of manifest.idle){if(await this.loadAvatarAnimation(path,'idle'))break;}
          const clip=companionNod(this.idleAction?.getClip(),this.headBone);return clip?this.mixer!.clipAction(clip):null;
        }
        const entry=paths.get(id);return entry?this.loadAvatarAnimation(entry.path,entry.category):null;
      },
      start:action=>{this.animationTransition!.to(action,this.currentAction,avatarMotionEnabled());this.currentAction=action;},
      restore:()=>this.restoreAutomaticAnimation(),
    });
    registerAvatarAnimationController('rhoda',this.animationPreview);
  }

  private restoreAutomaticAnimation(){
    if(!this.mixer)return;
    const action=this.wasWalking?this.locoAnimations.find(a=>a.getClip().name==='F_Walk_002')||this.idleAction:
      this.currentState==='SPEAKING'?this.talkingAction||this.idleAction:this.idleAction;
    if(action){action.paused=false;action.clampWhenFinished=false;action.setLoop(THREE.LoopRepeat,Infinity);this.animationTransition?.to(action,this.currentAction,avatarMotionEnabled());this.currentAction=action;}
    else{this.mixer.stopAllAction();this.currentAction=null;}
  }

  private async loadStartupAnimations(){
    // Actual navigation needs its gait before a catalogue of preview poses.
    const walk=(manifest.locomotion||[]).find(path=>path.endsWith('/F_Walk_002.glb'));
    if(walk)await this.loadAvatarAnimation(walk,'locomotion');
    // Recover a failed primary idle, stopping after the first usable variation.
    if(!this.idleAction)for(const path of (manifest.idle||[]).slice(1)){
      if(await this.loadAvatarAnimation(path,'idle'))break;
    }
    for(const path of manifest.expression||[]){
      if(await this.loadAvatarAnimation(path,'expression'))break;
    }
    console.log(`✅ Core avatar motion ready. Talking: ${this.exprAnimations.length}, Idle: ${this.idleAnimations.length}, Walking: ${this.locoAnimations.length}`);
  }

  private loadAnimationVariations(category:'idle'|'expression'|'locomotion'){
    const existing=this.animationVariations.get(category);if(existing)return existing;
    const load=(async()=>{for(const path of manifest[category]||[])await this.loadAvatarAnimation(path,category);})();
    this.animationVariations.set(category,load);return load;
  }

  // Switch between animations with smooth crossfade
  private switchAnimation(toAction: THREE.AnimationAction | null, duration: number = 0.3) {
    // Full-body speaking keys must not overwrite the gait while navigation moves.
    if(this.wasWalking&&toAction===this.talkingAction)toAction=this.locoAnimations.find(a=>a.getClip().name==='F_Walk_002')||this.idleAction;
    if (!toAction || toAction === this.currentAction) return;

    if(this.animationTransition)this.animationTransition.to(toAction,this.currentAction,avatarMotionEnabled(),duration);
    else{this.currentAction?.fadeOut(duration);toAction.reset().setEffectiveWeight(1).fadeIn(duration).play();}
    this.currentAction = toAction;
  }

  // Face the camera each frame
  update(camera: THREE.Camera, elapsedSeconds: number = 1 / 60) {
    if (!this.mesh) return;

    const style = selectedAvatarStyle();
    this.mesh.userData.speaking=this.currentState==='SPEAKING'||!!this.mesh.userData.narrating;
    this.animationPreview?.update();
    if(style==='hidden'){this.setWalking(false);if(this.autoFollow||this.approachTarget)this.movementPhase='paused';return;}
    const humanVisible = style==='rhoda';
    const gentleMotion = avatarMotionEnabled();
    // Update animation mixer
    // Bound long resume frames to prevent a sudden animation/head-tracking jump.
    const delta = Number.isFinite(elapsedSeconds) ? Math.max(0, Math.min(elapsedSeconds, 0.1)) : 0;
    if (this.mixer && gentleMotion && humanVisible) {
      this.mixer.update(delta);
      this.animationTransition?.update(delta);
    }

    // Keep only Y rotation so model stays upright
    const worldPos = new THREE.Vector3();
    camera.getWorldPosition(worldPos);
    const target = new THREE.Vector3(worldPos.x, this.mesh.position.y, worldPos.z);
    if (gentleMotion&&!this.wasWalking&&Math.hypot(target.x-this.mesh.position.x,target.z-this.mesh.position.z)>.01){
      const facing=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.atan2(target.x-this.mesh.position.x,target.z-this.mesh.position.z));
      this.mesh.quaternion.slerp(facing,1-Math.exp(-4*delta));
    }

    if(humanVisible){
      // --- Blinking ---
      const blinkElapsed = (Date.now() - this.blinkStartTime) / 1000;
      const blinkPhase = blinkElapsed % this.blinkPeriod;
      const isBinking = gentleMotion && blinkPhase < 0.15; // 0.15s blink duration

      // Set visibility for BOTH eyes
      if (this.leftEyeMesh) this.leftEyeMesh.visible = !isBinking;
      if (this.rightEyeMesh) this.rightEyeMesh.visible = !isBinking;

      // Also hide all eye objects found during traversal
      for (const eye of this.eyeObjects) {
        eye.visible = !isBinking;
      }

      // --- Procedural Head Tracking ---
      if (gentleMotion&&!this.animationPreview?.isActive()) this.updateHeadTracking(camera, delta);
    }

    if ((this.autoFollow || this.approachTarget) && gentleMotion) {
      const ground = this.groundY ?? (this.mesh ? this.mesh.position.y : 0);
      this.followTowardsCamera(camera, ground, delta);
    } else {
      this.setWalking(false);
      if(this.autoFollow||this.approachTarget)this.movementPhase='paused';
    }
    if(humanVisible&&!this.animationPreview?.isActive()){
      const automatic=this.wasWalking?this.locoAnimations.find(a=>a.getClip().name==='F_Walk_002'):
        this.currentState==='SPEAKING'?this.talkingAction:this.idleAction;
      if(automatic&&automatic!==this.currentAction){automatic.setLoop(THREE.LoopRepeat,Infinity);this.switchAnimation(automatic,.2);}
    }
  }

  // State for procedural animation
  private currentLookAt = new THREE.Vector3();
  private lookAtTarget = new THREE.Vector3();
  private glanceTimer = 0;
  private isGlancing = false;
  private headVelocity = new THREE.Vector3(); // for smooth damping

  private updateHeadTracking(camera: THREE.Camera, delta: number) {
    if (!this.headBone || !this.mesh) return;

    // 1. Determine Target to look at
    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);

    // Default: Look at camera (user's eyes)
    let target = camPos.clone();

    // Occasional random glances (only in READY/Idle state)
    if (this.currentState === 'READY') {
      this.glanceTimer -= delta;
      if (this.glanceTimer <= 0) {
        // Toggle glance
        this.isGlancing = !this.isGlancing;
        this.glanceTimer = this.isGlancing ? 1.5 + Math.random() : 5 + Math.random() * 5;

        if (this.isGlancing) {
          // Pick a random point ~2m away 
          const offset = new THREE.Vector3(
            (Math.random() - 0.5) * 2,
            (Math.random() - 0.5) * 0.5,
            (Math.random() - 0.5) * 1
          );
          this.lookAtTarget.copy(target).add(offset);
        }
      }

      if (!this.isGlancing) {
        this.lookAtTarget.copy(target); // Snap target back to camera
      }
    } else {
      // Always look at user when Listening, Processing, or Speaking
      this.isGlancing = false;
      this.lookAtTarget.copy(target);
    }

    // Smoothly interpolate current look point
    const lerpSpeed = this.isGlancing ? 2.0 : 5.0; // Faster returning to eye contact
    this.currentLookAt.lerp(this.lookAtTarget, 1 - Math.exp(-lerpSpeed * delta));

    // 2. Limit rotation to avoid "Owl Head"
    // Convert world target to local space relative to body
    const localTarget = this.currentLookAt.clone();
    this.mesh.worldToLocal(localTarget);
    const headOrigin = this.headBone.getWorldPosition(new THREE.Vector3());
    this.mesh.worldToLocal(headOrigin);
    localTarget.sub(headOrigin);


    // Calculate simple yaw/pitch
    let yaw = Math.atan2(localTarget.x, localTarget.z);
    let pitch = Math.atan2(localTarget.y, Math.hypot(localTarget.x, localTarget.z));

    // Clamp angles (e.g. +/- 60 degrees)
    const limit = Math.PI / 3;
    yaw = Math.max(-limit, Math.min(limit, yaw));
    pitch = Math.max(-0.5, Math.min(0.5, pitch)); // Less pitch

    // 3. Apply rotation to Head Bone (additive to animation)
    // We want to Rotate the head bone to face the yaw/pitch, 
    // BUT preserve the existing animation's influence (which is usually minimal on head in idle).
    // A simple method is to set rotation directly if we don't need complex blending.
    // Respect the neutral head angle captured when the model is loaded.

    // NOTE: This overrides the animation clip's head rotation. 
    // For a simple 'LookAt', we can apply Euler offsets.

    const baseHeadRotX = this.headBaseRotationX; // Neutral pose captured from this rig

    // Apply state-specific offsets
    let tiltZ = 0; // EarthTilt
    let leanX = 0; // Forward lean

    if (this.currentState === 'LISTENING') {
      // Lean forward slightly and tilt ear to camera
      leanX = 0.15;
      tiltZ = 0.1;
    } else if (this.currentState === 'SPEAKING') {
      // Subtle head bob generated by sin wave
      leanX = Math.sin(Date.now() / 150) * 0.02;
    }

    // Smoothly set rotation
    // Note: Bone coordinate systems vary. Assuming Standard Rig (Y-Up, Z-Forward usually, but Mixamo is often different)
    // We will apply yaw to Y axis, Pitch to X axis.

    // We dampen changes to the bone to handle the frame-by-frame updates
    const q = new THREE.Quaternion();
    // Order YXZ is typical for head yaw/pitch
    q.setFromEuler(new THREE.Euler(baseHeadRotX - pitch + leanX, yaw, tiltZ, 'YXZ'));

    // Slerp current bone rotation towards calculated LookAt rotation
    // This blends animation (if any) with our procedural LookAt if we did it right,
    // but here we are overwriting. To blend, we'd multiply. Overwriting is cleaner for "LookAt" control.
    this.headBone.quaternion.slerp(q, 1 - Math.exp(-8 * delta));
  }

  public bringToCamera(camera: THREE.Camera, groundY?: number) {
    this.summon(camera,groundY??this.getGroundY());
  }

  public resetConversation() {
    this.lastResponse = "";
    this.currentTranscript = "";
    this.conversationHistory = [];
    this.stopListening();
  }

  public stopAutoFollow(): void {
    this.autoFollow = false;
    this.approachTarget=null;this.route=[];this.routeGoal=null;this.setWalking(false);
    this.movementPhase='idle';this.routeLength=0;this.routeTravelled=0;
  }

  public toggleAutoFollow(): boolean {
    this.autoFollow = !this.autoFollow;
    this.approachTarget=null;this.route=[];this.routeGoal=null;if(!this.autoFollow)this.setWalking(false);
    this.movementPhase=this.autoFollow?'waiting':'idle';this.routeLength=0;this.routeTravelled=0;
    window.dispatchEvent(new CustomEvent('rhoda-avatar-placement-change',{detail:{reason:'follow',enabled:this.autoFollow}}));
    return this.autoFollow;
  }

  public setGroundY(y: number) {
    this.groundY = y;
  }

  public isProcessing(): boolean {
    return this.currentState === 'PROCESSING';
  }

  public getState(): RhodeSchwarzState {
    return this.currentState;
  }

  public setState(state: RhodeSchwarzState) {
    if(this.currentState==='LISTENING'&&state!=='LISTENING')this.cancelListeningCapture();
    this.currentState = state;
  }

  public isCurrentlyRecording(): boolean {
    return this.isRecording;
  }

  public getStatusLabel(): string {
    return this.statusLabel;
  }

  public setStatusLabel(label: string) {
    if (this.statusLabel === label) return;
    this.statusLabel = label;
    console.log(`📊 [RHODE_SCHWARZ][FLOW] ${label}`);
  }

  /**
   * Get current audio level for visualizer (0-1)
   */
  public getAudioLevel(): number {
    return this.audioRecorder.getAudioLevel();
  }

  public getLanguage(): 'en' | 'tw' {
    return this.language;
  }

  public setLanguage(lang: 'en' | 'tw') {
    if (this.language === lang) return;
    // Stop any active recording before switching
    if (this.currentState === 'LISTENING' && this.isRecording) {
      this.cancelListeningCapture();
    }
    this.language = lang;
    this.currentState = 'READY';
    this.setListeningVisual(false);
    this.setStatusLabel('READY');
    console.log(`🌍 Language set to: ${lang === 'en' ? 'English' : 'Twi'}`);
    // Resume listening if unmuted
    if (!this.muted) {
      setTimeout(() => void this.startListening(), 300);
    }
  }

  public onTouched() {
    console.log('👆 Rhoda was touched!');
    this.audioFeedback.click();
    if (this.currentState === 'READY') {
      void this.startListening();
    }
  }

  public summon(camera: THREE.Camera, groundY: number) {
    this.audioFeedback.click();
    if(!this.mesh)return;
    const position=new THREE.Vector3();camera.getWorldPosition(position);
    const direction=new THREE.Vector3();camera.getWorldDirection(direction);direction.y=0;direction.normalize();
    this.walkTo(position.addScaledVector(direction,1.6),groundY);
    window.dispatchEvent(new CustomEvent('rhoda-avatar-placement-change',{detail:{reason:'summon'}}));
    console.log('📍 Rhoda summoned to camera');
  }

  // Greeting removed - will be replaced with new implementation

  private clearListeningMonitors(){
    if(this.silenceMonitorId!==null){cancelAnimationFrame(this.silenceMonitorId);this.silenceMonitorId=null;}
    if(this.silenceIntervalId!==null){clearInterval(this.silenceIntervalId);this.silenceIntervalId=null;}
  }

  private cancelListeningCapture(){
    ++this.listeningRevision;this.microphonePending=false;this.isRecording=false;
    this.clearListeningMonitors();this.audioRecorder.release();this.setListeningVisual(false);
  }

  public async startListening() {
    // Prevent starting if not in READY state
    if (this.currentState !== 'READY') {
      console.warn('⚠️ [RHODE_SCHWARZ] Cannot start - current state:', this.currentState);
      return;
    }

    console.log('🎤 [RHODE_SCHWARZ] Starting listening mode...');
    const revision=++this.listeningRevision;
    this.microphonePending=true;
    this.setStatusLabel('Waiting for microphone access...');

    // Update state immediately
    this.currentState = 'LISTENING';
    this.isRecording = true;
    this.setListeningVisual(true);
    this.audioFeedback.listening();

    try {
      // Start the recorder
      await this.audioRecorder.start();
      if(revision!==this.listeningRevision||this.currentState!=='LISTENING'||!this.isRecording)return;
      this.microphonePending=false;
      console.log('✅ [RHODE_SCHWARZ] Recording started successfully');
      this.setStatusLabel('Listening...');
      // Reset speech detection helpers
      this.hasHeardSpeechWhileRecording = false;
      let silenceStart: number | null = null;
      const recordingStartTime = Date.now();
      const maxRecordingMs = 15000;

      // Create a single-check function so we can run it from RAF and from a setInterval fallback
      const checkSilenceOnce = () => {
        try {
          if (revision!==this.listeningRevision||this.currentState !== 'LISTENING' || !this.isRecording) {
            return;
          }

          const now = Date.now();
          if (now - recordingStartTime > maxRecordingMs) {
            console.log('⏱️ Max recording duration reached → auto-stopping');
            void this.stopListening();
            return;
          }

          const level = this.audioRecorder.getAudioLevel();

          // If user speaks above threshold, register speech and clear silence timer
          if (level >= this.speechThreshold) {
            this.hasHeardSpeechWhileRecording = true;
            silenceStart = null;
            if (this.fastMode) console.log('🔊 [SILENCE-MONITOR] detected speech (level', level.toFixed(3), ')');
          } else {
            // If we've heard speech before, start silence timer
            if (this.hasHeardSpeechWhileRecording) {
              if (silenceStart === null) silenceStart = now;
              const elapsed = now - (silenceStart || now);
              const required = this.fastMode ? Math.max(400, Math.floor(this.silenceRequiredMs / 2)) : this.silenceRequiredMs;
              if (elapsed >= required) {
                console.log('🔕 Detected silence for', elapsed, 'ms (required', required, ') → auto-stopping recording');
                // Fire stopListening asynchronously to avoid reentrancy here
                void this.stopListening();
                return;
              }
            }
          }
        } catch (e) {
          // ignore occasional errors from analyser
        }
      };

      // RAF loop (normal path)
      const rafLoop = () => {
        if(revision!==this.listeningRevision)return;
        checkSilenceOnce();
        // only queue next RAF when still in listening state
        if (revision===this.listeningRevision&&this.currentState === 'LISTENING' && this.isRecording) {
          this.silenceMonitorId = requestAnimationFrame(rafLoop);
        }
      };

      // Start both RAF and an interval fallback (some XR runtimes suspend RAF)
      this.silenceMonitorId = requestAnimationFrame(rafLoop);
      // Interval runs slightly slower but ensures checks when RAF is unavailable/suspended
      this.silenceIntervalId = window.setInterval(() => {
        if (revision===this.listeningRevision&&this.currentState === 'LISTENING' && this.isRecording) {
          checkSilenceOnce();
        }
      }, 150);

      // Caption removed

    } catch (error) {
      if(revision!==this.listeningRevision)return;
      this.microphonePending=false;this.clearListeningMonitors();
      if((error as Error)?.name==='AbortError'){
        this.currentState='READY';this.isRecording=false;this.setListeningVisual(false);this.setStatusLabel('READY');return;
      }
      // Recording failed - reset to READY
      console.error('❌ [RHODE_SCHWARZ] Failed to start recording:', error);

      this.currentState = 'READY';
      this.isRecording = false;
      this.setListeningVisual(false);
      this.audioFeedback.error();
      this.setStatusLabel('Microphone error');

    }
  }

  public async stopListening() {
    // Only stop if actually recording
    if (this.currentState !== 'LISTENING' || !this.isRecording) {
      console.warn('⚠️ [RHODE_SCHWARZ] Not recording - cannot stop');
      return;
    }

    console.log('🛑 [RHODE_SCHWARZ] Stopping recording...');
    const pending=this.microphonePending;
    const revision=++this.listeningRevision;this.microphonePending=false;
    this.clearListeningMonitors();
    // Stopping while the browser permission prompt is pending is cancellation,
    // not an empty conversation or a microphone failure.
    if(pending){
      this.audioRecorder.release();this.isRecording=false;this.setListeningVisual(false);
      this.currentState='READY';this.setStatusLabel('READY');return;
    }

    // Update state to PROCESSING
    this.isRecording = false;
    this.setListeningVisual(false);
    this.currentState = 'PROCESSING';
    this.audioFeedback.processing();
    this.setStatusLabel('Thinking...');

    try {
      const audioBlob: Blob = await this.audioRecorder.stop();
      if(revision!==this.listeningRevision||this.currentState!=='PROCESSING')return;
      console.log(`✅ [RHODE_SCHWARZ] Got audio blob: ${audioBlob.size} bytes, ${audioBlob.type}`);
      await this.processConversation(audioBlob);
    } catch (error) {
      if(revision!==this.listeningRevision||this.currentState!=='PROCESSING')return;
      if((error as Error)?.name==='AbortError'){this.currentState='READY';this.setStatusLabel('READY');return;}
      this.handlePipelineError(error);
    }
  }

  private async processConversation(audioBlob: Blob) {
    console.log(`🔄 [RHODE_SCHWARZ] ========== PIPELINE START (${this.language}) ==========`);

    if (!audioBlob || audioBlob.size === 0) {
      throw new Error('No audio captured from microphone');
    }

    this.setStatusLabel('Thinking...');

    if (this.language === 'en') {
      await this.processEnglishPipeline(audioBlob);
    } else {
      await this.processTwiPipeline(audioBlob);
    }

    console.log(`✅ [RHODE_SCHWARZ] ========== PIPELINE COMPLETE ==========`);
  }

  private async processEnglishPipeline(audioBlob: Blob) {
    // 1) Transcribe via Gemini
    this.setStatusLabel('Listening...');
    let transcript: string;
    try {
      transcript = await geminiTranscribeAudio(audioBlob);
      this.currentTranscript = transcript;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('No transcription')) {
        this.currentState = 'READY';
        this.setListeningVisual(false);
        this.audioFeedback.ready();
        this.setStatusLabel('Ready');
        if (!this.muted) setTimeout(() => this.startListening(), 500);
        return;
      }
      throw err;
    }

    sessionLogger.logUserInput(transcript);

    // 2) Check for confirmation responses
    const pending = getPendingConfirmation();
    if (pending) {
      const lower = transcript.toLowerCase();
      if (/^(yes|confirm|proceed|go ahead|allow|okay|ok|do it)[.!]?$/i.test(lower.trim())) {
        const result = await confirmPending();
        const msg = result.status === 'ok' ? `Done. ${JSON.stringify(result.result)}` : `Instrument error: ${result.error}`;
        sessionLogger.logAssistantResponse(msg);
        await this.speakAndReset(msg);
        return;
      } else if (/^(no|cancel|deny|stop|don't)[.!]?$/i.test(lower.trim())) {
        await denyPending();
        const msg = 'Alright, I cancelled that action.';
        sessionLogger.logAssistantResponse(msg);
        await this.speakAndReset(msg);
        return;
      }
      await this.speakAndReset('Please say yes or cancel for the pending operation.');
      return;
    }

    // 3a) Check for workflow triggers
    const lower = transcript.toLowerCase();
    if (/next step|continue|done with this step|move on/.test(lower) && getActiveWorkflow()) {
      const nextStep = advanceStep();
      if (nextStep) {
        let msg = `Step ${nextStep.id} of ${getTotalSteps()}: ${nextStep.instruction}. ${nextStep.detail}${nextStep.safetyCheck ? ' Warning: ' + nextStep.safetyCheck : ''}`;
        if (nextStep.instrumentAction) {
          const result = await executeFunction(nextStep.instrumentAction);
          msg += result.status === 'error' ? ` Instrument error: ${result.error}` : ` ${result.confirmation_prompt || ''}`;
        }
        sessionLogger.logAssistantResponse(msg);
        this.conversationHistory.push({ role: 'user', content: transcript }, { role: 'model', content: msg });
        await this.speakAndReset(msg);
        return;
      } else {
        const msg = 'Workflow complete! All steps done. Great job!';
        sessionLogger.logAssistantResponse(msg);
        await this.speakAndReset(msg);
        return;
      }
    }

    if (/walk me through|guide me|help me measure|start workflow/.test(lower)) {
      if (/sine|1.?khz|measure/.test(lower)) {
        startWorkflow('measure-1khz-sine');
        const step = getCurrentStep();
        if (step) {
          const msg = `Starting the measurement workflow. Step 1 of ${getTotalSteps()}: ${step.instruction}. ${step.detail}`;
          sessionLogger.logAssistantResponse(msg);
          this.conversationHistory.push({ role: 'user', content: transcript }, { role: 'model', content: msg });
          await this.speakAndReset(msg);
          return;
        }
      }
      if (/safety|overvoltage|overload|danger/.test(lower)) {
        startWorkflow('safety-overvoltage');
        const step = getCurrentStep();
        if (step) {
          const msg = `Starting the safety workflow. Step 1 of ${getTotalSteps()}: ${step.instruction}. ${step.detail}. Warning: ${step.safetyCheck}`;
          sessionLogger.logAssistantResponse(msg);
          this.conversationHistory.push({ role: 'user', content: transcript }, { role: 'model', content: msg });
          await this.speakAndReset(msg);
          return;
        }
      }
    }

    // 3b) Check for anomaly/troubleshooting keywords
    if (/noise|noisy|clip|unstable|drift|alias|wrong|broken|fault|problem|issue|diagnos/.test(lower)) {
      this.setStatusLabel('Diagnosing...');
      const diagnosis = await diagnoseTrace({ description: transcript });
      let msg = `${diagnosis.probable_cause}. `;
      msg += diagnosis.fix_steps.slice(0, 2).join('. ') + '.';
      if (diagnosis.unsafe_flag) msg = 'Warning: safety concern. ' + msg;
      sessionLogger.logAssistantResponse(msg, 'troubleshooting');
      await this.speakAndReset(msg);
      return;
    }

    // 4) RAG retrieval + instrument state
    this.setStatusLabel('Thinking...');
    const ragContext = getContextForQuery(transcript);
    await readState().catch(() => undefined);
    const instrState = JSON.stringify(getInstrumentState(), null, 1);

    // 5) Ask Gemini with full context + conversation history + active workflow
    const wfContext = getWorkflowContext() || undefined;
    const response = await askGemini(transcript, ragContext, instrState, sessionLogger.getConversationHistory(transcript), wfContext, sharedAssistanceContext());
    if (!response || response.trim().length === 0) {
      throw new Error('AI returned empty response.');
    }
    this.lastResponse = response;
    sessionLogger.logAssistantResponse(response);

    // Track conversation for multi-turn context (cap at 20 turns)
    this.conversationHistory.push({ role: 'user', content: transcript });
    this.conversationHistory.push({ role: 'model', content: response });
    if (this.conversationHistory.length > 40) {
      this.conversationHistory = this.conversationHistory.slice(-40);
    }

    // Model prose is guidance; only explicit supported operations enter the approval path.

    // 7) Check for progress nudge
    const nudge = getNudge();
    const finalResponse = nudge ? response + ' ' + nudge : response;

    await this.speakAndReset(finalResponse);
  }

  private detectInstrumentAction(response: string): { name: string; params: Record<string, unknown> } | null {
    const lower = response.toLowerCase();
    if (/timebase|time.?base|time.?div/.test(lower)) {
      const numMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:ms|us|μs|ns|s)/);
      if (numMatch) {
        let val = parseFloat(numMatch[1]);
        if (lower.includes('ms')) val *= 0.001;
        else if (lower.includes('us') || lower.includes('μs')) val *= 0.000001;
        else if (lower.includes('ns')) val *= 0.000000001;
        return { name: 'set_timebase', params: { timebase_s_div: val } };
      }
    }
    if (/vertical.?scale|v.?div|volts.?per/.test(lower)) {
      const numMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:mv|v)/);
      if (numMatch) {
        let val = parseFloat(numMatch[1]);
        if (lower.includes('mv')) val *= 0.001;
        const chMatch = lower.match(/ch(?:annel)?\s*(\d)/);
        return { name: 'set_vertical_scale', params: { channel: chMatch ? parseInt(chMatch[1]) : 1, scale_v_div: val } };
      }
    }
    if (/coupling.*(ac|dc)/i.test(lower)) {
      const coupling = /ac/i.test(lower) ? 'AC' : 'DC';
      const chMatch = lower.match(/ch(?:annel)?\s*(\d)/);
      return { name: 'set_channel_coupling', params: { channel: chMatch ? parseInt(chMatch[1]) : 1, coupling } };
    }
    if (/autoset|auto.?set/.test(lower)) {
      return { name: 'run_autoset', params: {} };
    }
    return null;
  }

  private async speakAndReset(text: string) {
    if (this.language === 'tw') {
      await this.speak(text, 'tw');
      return;
    }

    this.currentState = 'SPEAKING';
    this.audioFeedback.speaking();
    this.setStatusLabel('Generating...');

    try {
      const audio = await geminiTTS(text);
      this.setStatusLabel('Speaking...');
      // playAudioBlob handles: start talking animation → lip sync → onended → back to idle
      await this.playAudioBlob(audio);
    } catch (err) {
      console.error('❌ TTS failed:', err);
      if (this.idleAction) this.switchAnimation(this.idleAction, 0.3);
    }

    this.currentState = 'READY';
    this.audioFeedback.ready();
    this.setStatusLabel('Ready');

    if (!this.muted) {
      setTimeout(() => void this.startListening(), 400);
    }
  }

  private async processTwiPipeline(audioBlob: Blob) {
    this.setStatusLabel('Listening...');
    const twiTranscript = await this.transcribeOrFail(audioBlob, 'tw');
    if (!twiTranscript) return;

    sessionLogger.logUserInput(twiTranscript);

    this.setStatusLabel('Translating...');
    const englishText = await translateText(twiTranscript, 'tw', 'en');
    if (!englishText || englishText.trim().length === 0 || englishText === 'undefined') {
      throw new Error('Translation returned empty result.');
    }

    // RAG + instrument context (same as English)
    this.setStatusLabel('Thinking...');
    const ragContext = getContextForQuery(englishText);
    await readState().catch(() => undefined);
    const instrState = JSON.stringify(getInstrumentState(), null, 1);
    const englishResponse = await askGemini(englishText, ragContext, instrState, sessionLogger.getConversationHistory(twiTranscript), undefined, sharedAssistanceContext());
    if (!englishResponse || englishResponse.trim().length === 0) {
      throw new Error('AI returned empty response.');
    }

    sessionLogger.logAssistantResponse(englishResponse);

    this.setStatusLabel('Translating...');
    const twiResponse = await translateText(englishResponse, 'en', 'tw');
    if (!twiResponse || twiResponse.trim().length === 0 || twiResponse === 'undefined') {
      throw new Error('Final translation returned empty result.');
    }
    this.lastResponse = twiResponse;

    await this.speak(twiResponse, 'tw');
  }

  private async transcribeOrFail(audioBlob: Blob, lang: string): Promise<string | null> {
    this.setStatusLabel('Thinking...');
    try {
      const t0 = Date.now();
      const transcript = await transcribeAudio(audioBlob, lang);
      this.currentTranscript = transcript;
      console.log(`✅ [RHODE_SCHWARZ] Transcript (${Date.now() - t0}ms): "${transcript}"`);
      return transcript;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('No transcription text') || msg.includes('Empty transcription')) {
        console.warn('⚠️ [RHODE_SCHWARZ] No speech detected');
        this.setStatusLabel('Listening...');
        this.currentState = 'READY';
        this.setListeningVisual(false);
        this.audioFeedback.ready();
        if (!this.muted) setTimeout(() => this.startListening(), 500);
        return null;
      }
      throw new Error(`STT failed: ${msg}`);
    }
  }


  private handlePipelineError(error: unknown) {
    console.error('❌ [RHODE_SCHWARZ] Pipeline error:', error);
    console.error('❌ [RHODE_SCHWARZ] Error stack:', (error as Error)?.stack);

    const message = (error as Error)?.message || 'Unknown error';

    // Show more of the error message in the status
    const shortMessage = message.length > 80 ? message.substring(0, 80) + '...' : message;

    this.currentState = 'READY';
    this.audioFeedback.error();
    this.setSpeakingVisual(false);
    this.setStatusLabel(`❌ ${shortMessage}`);

    // Keep error visible for 10 seconds before resetting to READY
    console.log(`⏰ [RHODE_SCHWARZ] Error will clear in 10 seconds`);
    setTimeout(() => {
      if (this.statusLabel.startsWith('❌') || this.statusLabel.startsWith('ERROR:')) {
        console.log(`⏰ [RHODE_SCHWARZ] Clearing error status`);
        this.setStatusLabel('READY');
      }
    }, 10000);
  }

  // Fast-mode controls: when enabled we shorten silence windows for snappier recording
  public setFastMode(enabled: boolean) {
    this.fastMode = !!enabled;
    // tighten silence window when in fast mode
    this.silenceRequiredMs = this.fastMode ? 600 : 1200;
  }

  private async speak(text: string, language: string = 'tw') {
    this.currentState = 'SPEAKING';
    this.audioFeedback.speaking();
    this.setStatusLabel('Generating...');

    try {
      const audioBlob = await textToSpeech(text, language);
      if (!audioBlob) {
        this.currentState = 'READY';
        this.audioFeedback.ready();
        this.setStatusLabel('TTS unavailable');
        return;
      }

      this.setStatusLabel('Speaking...');
      // playAudioBlob handles: start talking animation → lip sync → onended → back to idle
      await this.playAudioBlob(audioBlob);

      this.currentState = 'READY';
      this.audioFeedback.ready();
      this.setStatusLabel('READY');

      if (!this.muted) {
        setTimeout(() => void this.startListening(), 400);
      }
    } catch (err) {
      console.error('❌ TTS error:', err);
      this.currentState = 'READY';
      this.audioFeedback.error();
      this.setStatusLabel('Message failed');
      if (this.idleAction) this.switchAnimation(this.idleAction, 0.3);
    }
  }

  /**
   * Play audio blob using Web Audio API (works in XR and browser).
   */
  public async playAudioBlob(blob: Blob): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        console.log('🎵 playAudioBlob called with blob:', blob.size, 'bytes, type:', blob.type);

        // Initialize audio context if needed
        if (!this.audioContext) {
          this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          console.log('🎵 Created new AudioContext, state:', this.audioContext.state);
        }

        // Resume context if suspended (required for autoplay policies on mobile)
        if (this.audioContext.state === 'suspended') {
          console.log('⚠️ AudioContext suspended, attempting resume...');
          await this.audioContext.resume();
          console.log('🎵 AudioContext resumed, new state:', this.audioContext.state);
        }

        // Stop any currently playing audio
        if (this.currentAudioSource) {
          try {
            this.currentAudioSource.stop();
            console.log('🛑 Stopped previous audio source');
          } catch (e) { /* ignore */ }
        }

        // Convert blob to array buffer
        console.log('📦 Converting blob to ArrayBuffer...');
        const arrayBuffer = await blob.arrayBuffer();
        console.log('✅ ArrayBuffer size:', arrayBuffer.byteLength, 'bytes');

        // Decode audio data
        console.log('🔊 Decoding audio data...');
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        console.log('✅ Audio decoded - Duration:', audioBuffer.duration.toFixed(2), 's, Channels:', audioBuffer.numberOfChannels, 'Sample Rate:', audioBuffer.sampleRate);

        // Create source and connect to destination
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;

        // Create gain node for volume control (helps with mobile)
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = 1.0; // Full volume

        source.connect(gainNode);

        // Create an analyser so we can drive mouth movement from audio data
        try {
          this.analyser = this.audioContext.createAnalyser();
          this.analyser.fftSize = 1024;
          this.analyser.smoothingTimeConstant = 0.15; // Balanced smoothing (not too twitchy, not too laggy)
          gainNode.connect(this.analyser);
          this.analyser.connect(this.audioContext.destination);
          this.analyserData = new Uint8Array(this.analyser.frequencyBinCount);
        } catch (e) {
          console.warn('⚠️ Failed to create AnalyserNode', e);
          gainNode.connect(this.audioContext.destination);
        }

        source.onended = () => {
          console.log('✅ Audio playback ended');
          this.currentAudioSource = null;
          if (this.mouthAnimatorId) {
            cancelAnimationFrame(this.mouthAnimatorId);
            this.mouthAnimatorId = null;
          }
          // Reset mouth to closed state
          if (this.mouthMesh) {
            try {
              if (this.mouthMorphIndex !== null && Array.isArray((this.mouthMesh as any).morphTargetInfluences)) {
                (this.mouthMesh as any).morphTargetInfluences[this.mouthMorphIndex] = 0;
              }
              this.mouthMesh.scale.set(1, 1, 1);
            } catch (e) { /* ignore */ }
          }

          if (this.idleAction) {
            this.switchAnimation(this.idleAction, 0.5);
          }
          resolve();
        };

        this.currentAudioSource = source;

        // Start talking animation + lip sync together, right before audio plays
        if (this.talkingAction) {
          this.talkingAction.reset().setLoop(THREE.LoopRepeat, Infinity);
          this.switchAnimation(this.talkingAction, 0.15);
        }

        if (this.analyser && this.analyserData && this.mouthMesh) {
          const animateMouth = () => {
            try {
              // We use time domain (waveform) for immediate amplitude syncing
              this.analyser!.getByteTimeDomainData(this.analyserData as any);

              let sum = 0;
              const len = this.analyserData!.length;
              for (let i = 0; i < len; i++) {
                // Waveform is 0..255, center is 128.
                sum += Math.abs(this.analyserData![i] - 128);
              }

              // Raw average amplitude (0..128)
              const avg = sum / len;

              // Gentle normalization
              const norm = avg / 35.0;

              // Mild curve: reduced aggressive opening
              // Use square root to sensitize low volumes without blowing out high volumes
              let targetOpen = Math.min(0.7, Math.sqrt(norm) * 0.9);

              // Apply to Morph Target
              if (this.mouthMorphIndex !== null && Array.isArray((this.mouthMesh as any).morphTargetInfluences)) {
                // Apply directly without noise
                // We trust the analyser's smoothingTimeConstant (0.15) to handle the jitter
                (this.mouthMesh as any).morphTargetInfluences[this.mouthMorphIndex] = targetOpen;

              } else {
                // FALLBACK: Scale Based Animation (if no morphs found)
                // Gentle scaling
                const openY = 1 + targetOpen * 0.8;
                this.mouthMesh!.scale.set(1, openY, 1);
              }
            } catch (e) {
              // ignore
            }
            this.mouthAnimatorId = requestAnimationFrame(animateMouth);
          };
          this.mouthAnimatorId = requestAnimationFrame(animateMouth);
        }

        source.start(0);

        console.log('🔊 Playing TTS audio via Web Audio API');
        console.log('📱 AudioContext state:', this.audioContext.state);
      } catch (err) {
        console.error('❌ Audio playback error:', err);
        console.error('Error name:', (err as Error).name);
        console.error('Error message:', (err as Error).message);

        // Fallback: Try HTML5 Audio as last resort for mobile
        console.warn('🔄 Attempting fallback to HTML5 Audio element...');
        try {
          const audioUrl = URL.createObjectURL(blob);
          const audio = new Audio(audioUrl);
          audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
            console.log('✅ Audio playback ended (HTML5 fallback)');
            resolve();
          };
          audio.onerror = (e) => {
            URL.revokeObjectURL(audioUrl);
            console.error('❌ HTML5 Audio fallback also failed:', e);
            reject(new Error('Both Web Audio API and HTML5 Audio failed'));
          };
          await audio.play();
          console.log('🔊 Playing via HTML5 Audio (fallback)');
        } catch (fallbackErr) {
          console.error('❌ Fallback also failed:', fallbackErr);
          reject(err);
        }
      }
    });
  }

  // Visual feedback helper: tint emissive color when listening
  private setListeningVisual(on: boolean) {
    // Disabled: no emissive tinting; keep only blinking overlay visuals elsewhere
  }

  // When user is actively speaking, glow eyes yellow and start nodding
  private setSpeakingVisual(on: boolean) {
    if (!this.mesh) return;
    // Disabled: no emissive tinting or manual nodding — rely on imported talking animations
  }

  // Set auto-follow explicitly (used by DashboardSystem)
  public setAutoFollow(enabled: boolean) {
    this.autoFollow = !!enabled;
    this.approachTarget=null;this.route=[];this.routeGoal=null;if(!this.autoFollow)this.setWalking(false);
    this.movementPhase=this.autoFollow?'waiting':'idle';this.routeLength=0;this.routeTravelled=0;
  }

  // Expose current auto-follow state for external UI sync

  public useLabNavigation(enabled:boolean){this.roomNavigation=enabled;this.route=[];this.routeGoal=null;}
  public setMovementPreferences(speed:number,distance:number){
    if(Number.isFinite(speed))this.walkingSpeed=Math.min(.85,Math.max(.45,speed));
    if(Number.isFinite(distance))this.followDistance=Math.min(2.1,Math.max(1.4,distance));
    this.routeGoal=null;
  }
  public getMovementSnapshot(){return {phase:this.movementPhase,following:this.autoFollow,approaching:!!this.approachTarget,adjusted:this.destinationAdjusted,speed:this.walkingSpeed,distance:this.followDistance,progress:this.routeLength?Math.min(1,this.routeTravelled/this.routeLength):0};}
  /** Floor navigation owns translation; the animation rig owns the gait. */
  public walkTo(target:THREE.Vector3,groundY=this.getGroundY()) {
    this.autoFollow=false;this.route=[];this.routeGoal=null;this.approachTarget=target.clone();this.approachTarget.y=groundY;
    this.movementPhase='walking';this.destinationAdjusted=false;this.routeLength=0;this.routeTravelled=0;
  }
  private setWalking(value:boolean){
    if(this.mesh)this.mesh.userData.walking=value;
    const changed=value!==this.wasWalking,style=selectedAvatarStyle(),styleChanged=style!==this.walkAnimationStyle;
    this.wasWalking=value;this.walkAnimationStyle=style;if(!value)this.walkVelocity=0;
    if(value)this.animationPreview?.update();
    if(!value&&this.animationPreview?.isActive())return;
    if(style==='rhoda'&&(value||changed||styleChanged)){
      const action=value?this.locoAnimations.find(a=>a.getClip().name==='F_Walk_002'):
        this.currentState==='SPEAKING'?this.talkingAction||this.idleAction:this.idleAction;
      if(action&&action!==this.currentAction){action.setLoop(THREE.LoopRepeat,Infinity);this.switchAnimation(action,.2);}
    }
  }
  private followTowardsCamera(camera: THREE.Camera, groundY: number, delta: number) {
    if(!this.mesh)return;
    const cameraPosition=new THREE.Vector3();camera.getWorldPosition(cameraPosition);
    let desired=this.approachTarget;
    if(!desired){
      const direction=cameraPosition.clone().sub(this.mesh.position);direction.y=0;
      if(direction.length()<=(this.wasWalking?this.followDistance+.05:this.followDistance+.4)){this.setWalking(false);this.movementPhase='waiting';this.route=[];this.routeGoal=null;return;}
      desired=cameraPosition.clone().addScaledVector(direction.normalize(),-this.followDistance);desired.y=groundY;
    }
    if(this.roomNavigation){
      if(!this.routeGoal||this.routeGoal.distanceTo(desired)>.18){
        this.routeGoal=desired.clone();this.route=planLabRoute(this.mesh.position,desired);this.routeTravelled=0;
        let anchor=this.mesh.position;this.routeLength=0;for(const point of this.route){this.routeLength+=Math.hypot(point.x-anchor.x,point.z-anchor.z);anchor=new THREE.Vector3(point.x,groundY,point.z);}
        const last=this.route[this.route.length-1];this.destinationAdjusted=!!last&&Math.hypot(last.x-desired.x,last.z-desired.z)>.05;
        if(!this.route.length){this.movementPhase='blocked';this.approachTarget=null;this.setWalking(false);return;}
      }
      // Snap only along checked floor segments, so cutting a waypoint cannot cut a corner.
      while(this.route.length&&Math.hypot(this.route[0].x-this.mesh.position.x,this.route[0].z-this.mesh.position.z)<.008)this.route.shift();
      if(!this.route.length){if(this.movementPhase==='blocked'){this.setWalking(false);return;}this.approachTarget=null;this.routeTravelled=this.routeLength;this.movementPhase=this.autoFollow?'waiting':'arrived';this.setWalking(false);return;}
      desired=new THREE.Vector3(this.route[0].x,groundY,this.route[0].z);
    }
    const direction=desired.clone().sub(this.mesh.position);direction.y=0;const distance=direction.length();
    if(distance<.008){this.approachTarget=null;this.route=[];this.routeGoal=null;this.movementPhase='arrived';this.setWalking(false);return;}
    this.setWalking(true);direction.normalize();
    this.walkVelocity=Math.min(this.walkingSpeed,this.walkVelocity+1.4*delta,Math.max(.08,Math.sqrt(2*1.4*distance)));
    const step=Math.min(distance,this.walkVelocity*delta),next=this.mesh.position.clone().addScaledVector(direction,step);next.y=groundY;
    if(this.roomNavigation&&!segmentIsClear(this.mesh.position,next)){this.routeGoal=null;this.setWalking(false);this.movementPhase='blocked';return;}
    this.mesh.position.copy(next);this.routeTravelled+=step;this.movementPhase='walking';
    const yaw=Math.atan2(direction.x,direction.z);const facing=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw);this.mesh.quaternion.slerp(facing,1-Math.exp(-8*delta));
  }

  public async startRecording() {
    // Wrapper to align older calls with the new unified listening workflow
    await this.startListening();
  }

  public async stopRecording() {
    // Wrapper to align older calls with the new unified listening workflow
    await this.stopListening();
  }

  // Mute controls
  public isMuted(): boolean {
    return !!this.muted;
  }

  public setMuted(value: boolean) {
    this.muted = !!value;
    console.log(`🔇 Rhoda muted: ${this.muted}`);
    if (this.muted) {
      // if currently listening, stop
      if (this.currentState === 'LISTENING' && this.isRecording) {
        void this.stopListening();
      }
    } else {
      // If unmuted and READY, start listening
      if (this.currentState === 'READY') {
        (async () => {
          try {
            await this.startListening();
          } catch (err) {
            console.warn('⚠️ Failed to auto-start listening on unmute:', err);
            try { this.setStatusLabel('AWAITING_MIC: Press Unmute'); } catch (e) { /* ignore */ }
          }
        })();
      }
    }
  }
}
