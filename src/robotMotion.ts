/** Time-based greeting pose with zero endpoint velocity. Angles are radians. */
export function greetingPose(elapsed:number,enabled:boolean){
 const smooth=(x:number)=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);};
 const envelope=enabled&&Number.isFinite(elapsed)&&elapsed>=0&&elapsed<3.4?smooth(elapsed/.7)*smooth((3.4-elapsed)/.8):0;
 const wave=envelope===0?0:Math.sin((elapsed-.7)*Math.PI*3)*smooth((elapsed-.7)/.3)*smooth((2.7-elapsed)/.3);
 return {envelope,shoulder:envelope*1.25,elbow:envelope*(1.1+.16*wave),nod:envelope*.055,tilt:-envelope*.035};
}
/** Deterministic blink timing, with smooth closure/reopening and a quiet rest pose. */
export function eyeOpenness(time:number,enabled:boolean){
 if(!enabled||!Number.isFinite(time)||time<0)return 1;
 const phase=time%12;
 const start=[2.1,6.4,10.7].find(t=>phase>=t&&phase<=t+.22);
 if(start===undefined)return 1;
 const t=phase-start;
 const smooth=(n:number)=>{const x=Math.max(0,Math.min(1,n));return x*x*(3-2*x);};
 return t<.075?1-.92*smooth(t/.075):.08+.92*smooth((t-.075)/.145);
}
