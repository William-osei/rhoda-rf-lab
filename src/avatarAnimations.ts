import {LoopOnce,type AnimationAction,type AnimationMixer} from 'three';

export type HumanAnimationStyle='rhoda'|'human';
export type AvatarAnimationOption={id:string;label:string;group:string;availability:'ready'|'lazy'|'unavailable';reason?:string};
export type AvatarAnimationSnapshot={phase:'idle'|'loading'|'playing'|'paused'|'busy'|'error'|'unavailable';activeId:string|null;label:string;message:string;canPlay:boolean;canStop:boolean};
export type AnimationContext={visible:boolean;enabled:boolean;walking:boolean;speaking:boolean};
export type AvatarAnimationDefinition=Omit<AvatarAnimationOption,'availability'> & {action?:AnimationAction|null};
type Definition=AvatarAnimationDefinition;
type Adapter={mixer:AnimationMixer;definitions:Definition[];context:()=>AnimationContext;load:(id:string)=>Promise<AnimationAction|null>;start:(action:AnimationAction)=>void;restore:()=>void};

/** At most two poses contribute during a transition; retired actions are stopped.
 * Disabled motion applies the destination immediately so Stop is still useful.
 */
export class AvatarActionTransition{
 private outgoing:AnimationAction|null=null;
 private remaining=0;
 constructor(private mixer:AnimationMixer){}
 to(action:AnimationAction,previous:AnimationAction|null,enabled:boolean,duration=.18){
  const time=previous?.time||0,paused=previous?.paused||false;
  const blend=enabled&&duration>0&&previous&&previous!==action&&previous.isScheduled()&&previous.getEffectiveWeight()>.001;
  this.mixer.stopAllAction();this.outgoing=null;this.remaining=0;
  if(blend){
   previous.stopFading().setEffectiveWeight(1).play();previous.time=time;previous.paused=paused;
   previous.fadeOut(duration);this.outgoing=previous;this.remaining=duration;
  }
  action.reset().setEffectiveWeight(1).play();if(blend)action.fadeIn(duration);
  this.mixer.update(0);
 }
 update(delta:number){
  if(!this.outgoing||!Number.isFinite(delta)||delta<=0)return;
  this.remaining-=delta;
  if(this.remaining<=0){this.outgoing.stop().setEffectiveWeight(0);this.outgoing=null;}
 }
}

/** A bounded preview owns an action, never navigation or a narration session. */
export class AvatarAnimationController{
 private revision=0;
 private active:AnimationAction|null=null;
 private activeId:string|null=null;
 private pending=false;
 private error='';
 private ready=new Map<string,AnimationAction>();
 private lastEvent='';
 constructor(private adapter:Adapter){
  for(const definition of adapter.definitions)if(definition.action)this.ready.set(definition.id,definition.action);
  adapter.mixer.addEventListener('finished',this.finished);
 }
 private finished=(event:{action:AnimationAction})=>{
  if(event.action!==this.active)return;
  this.stop();
 };
 options():AvatarAnimationOption[]{
  return this.adapter.definitions.map(({id,label,group,reason})=>({id,label,group,availability:reason?'unavailable':this.ready.has(id)?'ready':'lazy',...(reason?{reason}:{})}));
 }
 snapshot():AvatarAnimationSnapshot{
  const context=this.adapter.context(),definition=this.adapter.definitions.find(d=>d.id===this.activeId);
  const common={activeId:this.activeId,label:definition?.label||'',canStop:!!this.active||this.pending};
  if(!context.visible)return {...common,phase:'unavailable',message:'Select this human character to preview its animations.',canPlay:false};
  if(!context.enabled)return {...common,phase:'paused',message:'Animation paused. Enable gentle animation to resume.',canPlay:false};
  if(context.walking)return {...common,phase:'busy',message:'Walking takes priority. Stop walking to preview a gesture.',canPlay:false};
  if(context.speaking)return {...common,phase:'busy',message:'Narration takes priority. Pause or stop narration to preview an animation.',canPlay:false};
  if(this.pending)return {...common,phase:'loading',message:'Loading '+common.label+'…',canPlay:true};
  if(this.active)return {...common,phase:'playing',message:'Playing '+common.label+' once. Stop returns to the automatic pose.',canPlay:true};
  return {...common,phase:this.error?'error':'idle',message:this.error||'Ready. Previews stay in place; walking and narration take priority.',canPlay:true};
 }
 private allowed(){const c=this.adapter.context();return c.visible&&c.enabled&&!c.walking&&!c.speaking;}
 private begin(id:string,action:AnimationAction){
  if(!this.allowed())return false;
  this.active=action;this.activeId=id;this.pending=false;this.error='';
  // Retain the final authored pose long enough for the adapter to fade to idle.
  action.paused=false;action.clampWhenFinished=true;action.setLoop(LoopOnce,1);
  this.adapter.start(action);this.changed();return true;
 }
 /** Already resident clips support the existing synchronous greeting control. */
 playAvailable(id:string){
  const action=this.ready.get(id);if(!action||!this.allowed())return false;
  ++this.revision;return this.begin(id,action);
 }
 async play(id:string):Promise<boolean>{
  const definition=this.adapter.definitions.find(d=>d.id===id);
  if(!definition||definition.reason||!this.allowed())return false;
  const action=this.ready.get(id);if(action)return this.playAvailable(id);
  const revision=++this.revision;this.active=null;
  this.adapter.restore();this.activeId=id;this.pending=true;this.error='';this.changed();
  let loaded:AnimationAction|null=null;
  try{loaded=await this.adapter.load(id);}catch{/* A failed optional clip leaves the automatic pose usable. */}
  if(loaded)this.ready.set(id,loaded);
  if(revision!==this.revision)return false;
  if(!this.allowed()){this.stop();return false;}
  this.pending=false;
  if(!loaded){this.activeId=null;this.error=definition.label+' could not load. Play it again to retry; other animations remain available.';this.changed();return false;}
  return this.begin(id,loaded);
 }
 stop(){
  ++this.revision;const interrupted=!!this.active||this.pending;
  this.active=null;this.activeId=null;this.pending=false;this.error='';
  if(interrupted)this.adapter.restore();
  this.changed();
 }
 /** Call even when hidden or motion is off so old loads cannot re-enter a pose. */
 update(){
  const c=this.adapter.context();
  if((!c.visible||c.walking||c.speaking)&&(this.active||this.pending))this.stop();
  if(this.active)this.active.paused=!c.enabled;
  this.changed();
 }
 isActive(){return !!this.active;}
 activeAnimation(){return this.activeId;}
 markReady(id:string,action:AnimationAction){this.ready.set(id,action);this.changed();}
 dispose(){this.stop();this.adapter.mixer.removeEventListener('finished',this.finished);}
 private changed(){
  const snapshot=this.snapshot(),key=JSON.stringify(snapshot);
  if(key===this.lastEvent)return;this.lastEvent=key;
  if(typeof window!=='undefined'&&typeof CustomEvent!=='undefined')window.dispatchEvent(new CustomEvent('rhoda-animation-change'));
 }
}

const controllers=new Map<HumanAnimationStyle,AvatarAnimationController>();
export function registerAvatarAnimationController(style:HumanAnimationStyle,controller:AvatarAnimationController){
 controllers.get(style)?.dispose();controllers.set(style,controller);
 return ()=>{if(controllers.get(style)===controller){controller.dispose();controllers.delete(style);}};
}
export function getAvatarAnimationOptions(style:HumanAnimationStyle){return controllers.get(style)?.options()||[];}
export function getAvatarAnimationSnapshot(style:HumanAnimationStyle):AvatarAnimationSnapshot{
 return controllers.get(style)?.snapshot()||{phase:'unavailable',activeId:null,label:'',message:'Select the character and wait for its model to load.',canPlay:false,canStop:false};
}
export async function playAvatarAnimation(style:HumanAnimationStyle,id:string){return await controllers.get(style)?.play(id)??false;}
export function stopAvatarAnimation(style:HumanAnimationStyle){controllers.get(style)?.stop();}
