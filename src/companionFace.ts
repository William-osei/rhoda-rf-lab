import type {Mesh,Object3D} from 'three';

/** Small authored facial cues. Local browser speech supplies speaking state,
 * not phoneme timestamps: the fallback mouth envelope is illustrative.
 */
export function companionFace(model:Object3D){
 const names=['AK_09_EyeBlinkLeft','AK_10_EyeBlinkRight','AK_13_EyeLookInLeft','AK_16_EyeLookOutRight','AK_14_EyeLookInRight','AK_15_EyeLookOutLeft','AA_VI_10_aa','AA_VI_11_E','AA_VI_13_O'];
 const bindings:{weights:number[];index:number;channel:number}[]=[];
 model.traverse(object=>{
  const mesh=object as Mesh;if(!mesh.morphTargetDictionary||!mesh.morphTargetInfluences)return;
  for(let channel=0;channel<names.length;channel++){
   const index=mesh.morphTargetDictionary[names[channel]];
   if(index!==undefined)bindings.push({weights:mesh.morphTargetInfluences,index,channel});
  }
 });
 let clock=0,mouth=0;
 return {
  available:bindings.length>0,
  reset(){clock=0;mouth=0;for(const binding of bindings)binding.weights[binding.index]=0;},
  update(delta:number,speaking:boolean,speechLevel?:number){
   if(!Number.isFinite(delta)||delta<0)return;
   clock+=Math.min(.1,delta);
   // A brief blink every few seconds, with a quiet gaze shift between blinks.
   const phase=clock%5.7;
   const blink=phase>5.42?Math.sin(Math.PI*(phase-5.42)/.28)**2:0;
   const gaze=Math.sin(clock*.38)*.12;
   const measured=typeof speechLevel==='number'&&Number.isFinite(speechLevel);
   const target=speaking?(measured?Math.min(.5,Math.max(0,speechLevel)):.19+.13*Math.sin(clock*13)**2):0;
   mouth+=(target-mouth)*(1-Math.exp(-18*delta));
   const values=[blink,blink,Math.max(0,gaze),Math.max(0,gaze),Math.max(0,-gaze),Math.max(0,-gaze),mouth*.75,mouth*.25,mouth*.12];
   for(const binding of bindings)binding.weights[binding.index]=values[binding.channel];
  },
 };
}
