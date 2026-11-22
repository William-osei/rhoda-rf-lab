import type {AnimationClip} from 'three';
/** Keep vertical gait bounce, but let navigation own all horizontal travel. */
export function inPlaceWalk(source:AnimationClip){
 const clip=source.clone();
 for(const track of clip.tracks){
  if(!/(?:^|[./])hips\.position$/i.test(track.name)||track.getValueSize()!==3)continue;
  const x=track.values[0],z=track.values[2];
  for(let i=0;i<track.values.length;i+=3){track.values[i]=x;track.values[i+2]=z;}
 }
 return clip;
}
