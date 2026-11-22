export type TrainingFrame = {
  source: string; scenario: string; time_s: number[]; voltage_v: number[];
  traces?: Record<string, TrainingTrace>;
  clipped: boolean; undersampled: boolean; trigger_possible: boolean; provenance: string;
  state: {timebase_scale:number; acquisition_state:string; channels:Record<string,{vertical_scale:number;offset:number;coupling:string;enabled:boolean;probe_attenuation?:number}>;trigger:{level:number;source:string;slope?:string;mode?:string};[key:string]:unknown};
  [key:string]:unknown;
};
export type TrainingTrace = {source:string;time_s:number[];voltage_v:number[];clipped:boolean;undersampled:boolean;trigger_possible:boolean};
export type TrainingCapture = {id:string;label:string;note:string;captured_at:string;readback_at:string;frame:TrainingFrame;measurement:unknown};
const scenarios=['sine','offset','square','disconnected'];
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
/** Reject malformed readbacks before displaying them as fresh or exporting evidence. */
export function validateTrainingFrame(value:unknown, expectedSource='CH1'): asserts value is TrainingFrame {
  const f=value as TrainingFrame|null,ch=f?.state?.channels?.[expectedSource.slice(-1)];
  if(!f||!/^CH[1-4]$/.test(expectedSource)||!scenarios.includes(f.scenario)||f.source!==expectedSource||typeof f.provenance!=='string'||!f.provenance.includes('RHODA ideal training model')
    ||!Array.isArray(f.time_s)||!Array.isArray(f.voltage_v)||f.time_s.length<2||f.time_s.length>20000||f.time_s.length!==f.voltage_v.length
    ||!f.time_s.every((t,i)=>finite(t)&&(i===0||t>f.time_s[i-1]))||!f.voltage_v.every(finite)
    ||!ch||!finite(ch.vertical_scale)||ch.vertical_scale<=0||!finite(ch.offset)||typeof ch.enabled!=='boolean'||!['DCLimit','ACLimit'].includes(ch.coupling)
    ||!finite(f.state.timebase_scale)||f.state.timebase_scale<=0||!['RUN','STOP'].includes(f.state.acquisition_state)
    ||!finite(f.state.trigger?.level)||typeof f.state.trigger.source!=='string'
    ||[f.clipped,f.undersampled,f.trigger_possible].some(v=>typeof v!=='boolean')) throw new Error('Simulator readback is invalid or incomplete. The previous display is retained as stale; reconnect to retry.');
  if(f.traces!==undefined){
    if(!f.traces||typeof f.traces!=='object'||Array.isArray(f.traces))throw new Error('Simulator trace set is invalid. Refresh before continuing.');
    for(const [source,trace] of Object.entries(f.traces)){
      if(!/^CH[1-4]$/.test(source)||!trace||trace.source!==source||!Array.isArray(trace.time_s)||!Array.isArray(trace.voltage_v)
        ||trace.time_s.length!==f.time_s.length||trace.voltage_v.length!==f.time_s.length
        ||!trace.time_s.every((time,index)=>finite(time)&&time===f.time_s[index])||!trace.voltage_v.every(finite)
        ||[trace.clipped,trace.undersampled,trace.trigger_possible].some(flag=>typeof flag!=='boolean'))
        throw new Error('A channel trace is malformed or does not match the current timebase. Refresh before continuing.');
    }
  }
}
function stable(value:any):string{return value&&typeof value==='object'?Array.isArray(value)?`[${value.map(stable).join(',')}]`:`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`:JSON.stringify(value);}
/** Validate a coherent multi-channel readback before it can be shown as fresh. */
export function validateTrainingTraceSet(values:unknown[],base:TrainingFrame):Record<string,TrainingTrace>{
  const sources=['CH1','CH2','CH3','CH4'];
  if(!Array.isArray(values)||values.length!==sources.length)throw new Error('All four channel readbacks are required. Refresh before continuing.');
  const traces:Record<string,TrainingTrace>={};
  values.forEach((value,index)=>{
    const source=sources[index];validateTrainingFrame(value,source);const candidate=value as TrainingFrame;
    if(candidate.scenario!==base.scenario||stable(candidate.state)!==stable(base.state)||candidate.time_s.length!==base.time_s.length
      ||!candidate.time_s.every((time,i)=>time===base.time_s[i]))throw new Error('Channel readbacks changed during the multi-channel refresh. Refresh again before comparing signals.');
    traces[source]={source,time_s:candidate.time_s,voltage_v:candidate.voltage_v,clipped:candidate.clipped,undersampled:candidate.undersampled,trigger_possible:candidate.trigger_possible};
  });
  return traces;
}
const validDate=(value:unknown):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const key='rhoda-training-captures-v1';
export class TrainingEvidenceStore {
  private records:TrainingCapture[]=[];
  storageMessage='Captures stay in this browser tab until it closes. Export a notebook to retain them.';
  constructor(private storage:()=>Pick<Storage,'getItem'|'setItem'>=()=>sessionStorage){
    try{
      const raw=storage().getItem(key);if(!raw)return;
      const saved=JSON.parse(raw);if(saved.version!==1||!Array.isArray(saved.captures)||saved.captures.length>8)throw Error('Invalid capture notebook');
      const ids=new Set<string>();
      const records=saved.captures.map((capture:TrainingCapture)=>{
        if(!capture||typeof capture.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(capture.id)||ids.has(capture.id)||typeof capture.label!=='string'||capture.label.length>80||typeof capture.note!=='string'||capture.note.length>600||!validDate(capture.captured_at)||!validDate(capture.readback_at))throw Error('Invalid capture record');
        validateTrainingFrame(capture.frame);ids.add(capture.id);return capture;
      });this.records=records;
    }catch{this.storageMessage='Stored captures could not be loaded. New captures remain available during this page session; export them before leaving.';}
  }
  list(){return structuredClone(this.records);}
  capture(frame:TrainingFrame,readbackAt:string,label:string,note:string,measurement:unknown){
    validateTrainingFrame(frame);if(!validDate(readbackAt))throw Error('A fresh readback timestamp is required.');
    if(this.records.length>=8)throw Error('The notebook holds eight captures. Export it, then remove a capture to add another.');
    const capture:TrainingCapture={id:typeof crypto.randomUUID==='function'?crypto.randomUUID():`capture-${Date.now()}-${Math.random().toString(36).slice(2)}`,label:label.trim().slice(0,80)||`Capture ${this.records.length+1}`,note:note.trim().slice(0,600),captured_at:new Date().toISOString(),readback_at:readbackAt,frame:structuredClone(frame),measurement:structuredClone(measurement)};
    this.records.push(capture);this.save();return structuredClone(capture);
  }
  remove(id:string){this.records=this.records.filter(c=>c.id!==id);this.save();}
  private save(){try{this.storage().setItem(key,JSON.stringify({version:1,captures:this.records}));}catch{this.storageMessage='Browser storage is unavailable or full. These captures remain in memory; export before closing or reloading.';}}
  json(){return JSON.stringify({version:1,exported_at:new Date().toISOString(),mode:'training',provenance:'RHODA ideal analytical display samples; not acquired instrument data',captures:this.records},null,2);}
  csv(){
    const columns=['capture_id','label','note','readback_at','captured_at','scenario','source','time_s','voltage_v','timebase_s_div','vertical_scale_v_div','offset_v','coupling','probe_attenuation_x','channel_enabled','clipped','undersampled','trigger_possible','provenance'];
    const cell=(v:unknown)=>{let s=String(v??'');if(typeof v==='string'&&/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
    const rows=[columns.join(',')];
    for(const c of this.records){const f=c.frame;const traces:Record<string,TrainingTrace>=f.traces??{CH1:{source:'CH1',time_s:f.time_s,voltage_v:f.voltage_v,clipped:f.clipped,undersampled:f.undersampled,trigger_possible:f.trigger_possible}};for(const [source,trace] of Object.entries(traces)){const ch=f.state.channels[source.slice(-1)];for(let i=0;i<trace.time_s.length;i++)rows.push([c.id,c.label,c.note,c.readback_at,c.captured_at,f.scenario,source,trace.time_s[i],trace.voltage_v[i],f.state.timebase_scale,ch.vertical_scale,ch.offset,ch.coupling,ch.probe_attenuation??10,ch.enabled,trace.clipped??f.clipped,trace.undersampled??f.undersampled,trace.trigger_possible??f.trigger_possible,f.provenance].map(cell).join(','));}}
    return rows.join('\r\n')+'\r\n';
  }
}
