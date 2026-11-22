import {Quaternion,QuaternionKeyframeTrack,Vector3,type AnimationClip,type Object3D} from 'three';

/** Source clips share bone names, but not the character's bone lengths.
 * Keep its own translations/scales and use only compatible joint rotations.
 * Navigation remains the only owner of world-space travel.
 */
export function companionAnimation(source:AnimationClip|undefined,target:Object3D,sourceRig:Object3D):AnimationClip|null{
 if(!source)return null;
 const clip=source.clone();
 clip.tracks=clip.tracks.filter(track=>{
  if(!track.name.endsWith('.quaternion')||track.getValueSize()!==4)return false;
  const name=track.name.slice(0,-'.quaternion'.length);
  const bone=target.getObjectByName(name),reference=sourceRig.getObjectByName(name);
  if(!bone||!reference)return false;
  // Finger/thumb rest axes differ too. Apply motion relative to the source
  // joint's rest orientation, then restore the character's own rest basis.
  const correction=bone.quaternion.clone().multiply(reference.quaternion.clone().invert());
  const key=new Quaternion();
  for(let i=0;i<track.values.length;i+=4){
   key.fromArray(track.values,i).premultiply(correction).normalize();key.toArray(track.values,i);
  }
  return true;
 });
 return clip.tracks.length?clip:null;
}

/** Reuse the character's complete idle pose so a head-only preview cannot expose
 * its bind-pose arms. Local X motion is a small illustrative acknowledgement.
 */
export function companionNod(idle:AnimationClip|undefined,head:Object3D|null|undefined):AnimationClip|null{
 if(!idle||!head)return null;
 const clip=idle.clone(),name=head.name+'.quaternion';
 const authored=idle.tracks.find(track=>track.name===name);
 const rest=authored?.getValueSize()===4?new Quaternion().fromArray(authored.values):head.quaternion.clone();
 const times=[0,.22,.48,.72,1.0,1.3],angles=[0,.12,0,.09,0,0],values:number[]=[];
 const axis=new Vector3(1,0,0);
 for(const angle of angles)rest.clone().multiply(new Quaternion().setFromAxisAngle(axis,angle)).normalize().toArray(values,values.length);
 clip.tracks=clip.tracks.filter(track=>track.name!==name);
 clip.tracks.push(new QuaternionKeyframeTrack(name,times,values));clip.name='Acknowledgement_Nod';clip.duration=1.3;
 return clip;
}
