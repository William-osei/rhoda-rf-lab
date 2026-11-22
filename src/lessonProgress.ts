export type CompletionKind='reviewed'|'listened';
type SavedPlan={step:number;completed:Record<string,CompletionKind>};
type ProgressStorage=Pick<Storage,'getItem'|'setItem'>;
/** Visiting a part records a position; completion requires listening or an explicit review. */
export class LessonProgress {
 private plans:Record<string,SavedPlan>=Object.create(null);
 private persistent:boolean;
 constructor(private storage?:ProgressStorage){
  this.persistent=!!storage;
  try{const saved=JSON.parse(storage?.getItem('rhoda-lesson-progress-v1')||'null');if(saved?.version===1&&saved.plans&&typeof saved.plans==='object'&&!Array.isArray(saved.plans)){
   for(const [id,value] of Object.entries(saved.plans)){const p=value as Partial<SavedPlan>;if(!p||!Number.isInteger(p.step)||Number(p.step)<0)continue;const completed:Record<string,CompletionKind>=Object.create(null);if(p.completed&&typeof p.completed==='object')for(const [index,kind] of Object.entries(p.completed))if(/^\d+$/.test(index)&&(kind==='reviewed'||kind==='listened'))completed[index]=kind;this.plans[id]={step:Number(p.step),completed};}
  }}catch{this.persistent=false;}
 }
 get storageMessage(){return this.persistent?'Study progress is saved on this device.':'Study progress is kept for this open page only. Browser storage is unavailable; reopening or reloading may reset it.';}
 position(id:string,total:number){return Math.min(Math.max(this.plans[id]?.step||0,0),Math.max(total-1,0));}
 completion(id:string,index:number){return this.plans[id]?.completed[String(index)];}
 completedCount(id:string,total:number){let count=0;for(let i=0;i<total;i++)if(this.completion(id,i))count++;return count;}
 savePosition(id:string,index:number){if(!Number.isInteger(index)||index<0)return;this.plan(id).step=index;this.save();}
 complete(id:string,index:number,kind:CompletionKind){if(!Number.isInteger(index)||index<0)return;this.plan(id).completed[String(index)]=kind;this.save();}
 clearCompletion(id:string,index:number){delete this.plan(id).completed[String(index)];this.save();}
 private plan(id:string){return this.plans[id]??(this.plans[id]={step:0,completed:Object.create(null)});}
 private save(){if(!this.storage){this.persistent=false;return;}try{this.storage.setItem('rhoda-lesson-progress-v1',JSON.stringify({version:1,plans:this.plans}));this.persistent=true;}catch{this.persistent=false;}}
}
