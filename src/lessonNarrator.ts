export type NarratedStep={title:string;part?:string;text:string;index:number;total:number;topic:string};
/** Sentence boundaries preserve decimals; long sentences split at word boundaries. */
export function narrationChunks(text:string,maxLength=240){
 maxLength=Number.isFinite(maxLength)&&maxLength>=1?Math.floor(maxLength):240;
 const chunks:string[]=[];let current='';
 for(const sentence of text.trim().split(/(?<=[.!?])\s+/)){
  if((current+' '+sentence).trim().length<=maxLength){current=(current+' '+sentence).trim();continue;}
  if(current){chunks.push(current);current='';}
  for(const word of sentence.split(/\s+/)){
   if((current+' '+word).trim().length>maxLength&&current){chunks.push(current);current='';}
   if(word.length>maxLength){if(current){chunks.push(current);current='';}for(let i=0;i<word.length;i+=maxLength)chunks.push(word.slice(i,i+maxLength));}
   else current=(current+' '+word).trim();
  }
 }
 if(current)chunks.push(current);return chunks.length?chunks:[''];
}
/** Local speech only. Token guards prevent cancelled utterances from advancing a lesson. */
export class LessonNarrator {
 private version=0;private paused=false;private pendingAdvance=false;private speaking=false;private pendingChunk:(()=>void)|null=null;
 private activeStep:NarratedStep|null=null;
 get state(){return this.paused?'paused':this.pendingAdvance?'between':this.speaking?'reading':'idle';}
 constructor(private snapshot:()=>NarratedStep,private advance:()=>void,private status:(text:string)=>void,private cue:(step:NarratedStep,speaking:boolean)=>void,private auto:()=>boolean,private complete:(step:NarratedStep)=>void=()=>{}){}
 private stepIsCurrent(step:NarratedStep){const current=this.snapshot();return (['title','part','text','index','total','topic'] as const).every(key=>step[key]===current[key]);}
 stop(message='Speech stopped.'){const step=this.activeStep??this.snapshot();this.version++;this.paused=false;this.pendingAdvance=false;this.pendingChunk=null;this.speaking=false;this.activeStep=null;if('speechSynthesis' in window)speechSynthesis.cancel();this.cue(step,false);this.status(message);}
 pause(){if(this.paused||(!this.speaking&&!this.pendingAdvance))return;this.paused=true;speechSynthesis.pause();this.cue(this.activeStep??this.snapshot(),false);this.status('Lesson paused. Resume when ready.');}
 resume(){
  if(!this.paused)return;
  const step=this.activeStep;
  if(!step||!this.stepIsCurrent(step)){this.stop('Lesson changed. Read the selected step when ready.');return;}
  this.paused=false;
  if(this.pendingAdvance){
   this.pendingAdvance=false;
   // Resume must respect a Continue preference changed while paused, just as
   // the delayed advance does. The completed step has no speech to resume.
   if(!this.auto()){speechSynthesis.resume();this.activeStep=null;this.status('Step complete. Continue when ready.');return;}
   this.advance();this.play();
  }else{speechSynthesis.resume();if(this.pendingChunk){const next=this.pendingChunk;this.pendingChunk=null;next();}else{this.cue(step,true);this.status('Continuing the current step.');}}
 }
 play(){
  this.stop('Preparing local speech…');
  if(!('speechSynthesis' in window)){this.status('Speech is unavailable. Use the written lesson.');return;}
  const voice=speechSynthesis.getVoices().find(v=>v.localService&&/^en(?:[-_]|$)/i.test(v.lang));
  if(!voice){this.status('No installed local English voice is ready. Install a system voice or try Read again. Written lessons remain available.');return;}
  // Some engines keep their paused flag after cancel. A new Read must be audible.
  speechSynthesis.resume();
  const step={...this.snapshot()},token=this.version;this.activeStep=step;const text=`${step.part||step.title}. Step ${step.index+1} of ${step.total}. ${step.text}`;
  const chunks=narrationChunks(text);
  const speak=(i:number)=>{if(token!==this.version)return;if(!this.stepIsCurrent(step)){this.stop('Lesson changed. Read the selected step when ready.');return;}if(this.paused){this.pendingChunk=()=>speak(i);return;}this.speaking=true;let ended=false;const u=new SpeechSynthesisUtterance(chunks[i]);u.voice=voice;u.lang=voice.lang;const rate=Number((document.getElementById('speech-rate') as HTMLSelectElement|null)?.value||.9);u.rate=Number.isFinite(rate)?Math.min(1.2,Math.max(.65,rate)):.9;
   u.onstart=()=>{if(token!==this.version||this.paused)return;if(!this.stepIsCurrent(step)){this.stop('Lesson changed. Read the selected step when ready.');return;}this.cue(step,true);this.status(`Reading step ${step.index+1} of ${step.total} · ${voice.name}`);};
   u.onerror=event=>{if(token!==this.version||ended)return;ended=true;this.stop(event.error==='not-allowed'?'Click Read to allow local speech in this browser. Written lessons remain available.':'Speech was interrupted'+(event.error?' ('+event.error+')':'')+'. Read again to retry this step.');};
   u.onend=()=>{if(token!==this.version||ended)return;ended=true;if(!this.stepIsCurrent(step)){this.stop('Lesson changed. Read the selected step when ready.');return;}if(i+1<chunks.length){speak(i+1);return;}this.speaking=false;this.cue(step,false);if(token!==this.version)return;this.complete(step);if(token!==this.version)return;
    if(this.auto()&&step.index+1<step.total){this.pendingAdvance=true;this.status(this.paused?'Lesson paused. Resume when ready.':'Step complete. Continuing shortly…');setTimeout(()=>{if(token!==this.version||this.paused||!this.pendingAdvance)return;if(!this.stepIsCurrent(step)){this.stop('Lesson changed. Read the selected step when ready.');return;}this.pendingAdvance=false;if(!this.auto()){this.activeStep=null;this.status('Step complete. Continue when ready.');return;}this.advance();this.play();},1100);}else{this.paused=false;this.activeStep=null;this.status(step.index+1===step.total?'Lesson complete. Review the parts or practise a measurement.':'Step complete. Continue when ready.');}
   };this.status(`Preparing step ${step.index+1} of ${step.total}…`);speechSynthesis.speak(u);
  };speak(0);
 }
}
