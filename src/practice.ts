import './labAccessUI';
import {getLabAccess} from './labAccess';
import { api, previewOperations, confirmOperations, cancelOperations, hasPending, getPendingSummary, pendingNeedsCancellation, type Operation } from './instrumentApi';
import { onInstrumentChange } from './instrumentChanges';
import { validateTrainingFrame, validateTrainingTraceSet, type TrainingFrame } from './trainingEvidence';
import { installCaptureNotebook } from './captureNotebook';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let spatial: {update:(frame:any)=>void;setFreshness:(fresh:boolean,message:string)=>void}|null=null;
let frame: TrainingFrame | null = null;
let measurement: any = null;
let training = false;
let busy = false;
let fresh = false;
let readbackAt: string | null = null;
let changes = 0;
let notebook:ReturnType<typeof installCaptureNotebook>|null=null;

function freshness(value:boolean, message:string) {
  fresh = value;
  el('data-status').textContent = message;
  el('data-status').dataset.fresh = String(value);
  spatial?.setFreshness(value, message);
}

function controls() {
  const access=getLabAccess(),canOperate=!access?.enabled||Boolean(access.authenticated&&access.permissions.operateInstrument);
  document.querySelectorAll<HTMLInputElement|HTMLSelectElement>('input,select').forEach(control=>{
    if(control.closest('#lab-access,#lab-sign-in')||control.hasAttribute('data-notebook'))return;
    control.disabled=busy||!training||!fresh||hasPending()||!canOperate;
  });
  document.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
    if(button.closest('#lab-access,#lab-sign-in'))return;
    if(button.hasAttribute('data-camera-view')||button.id.startsWith('view-part-')||button.hasAttribute('data-notebook'))return;
    if(!canOperate&&(button.hasAttribute('data-input')||['load','readable-setup','approve','channel-enabled'].includes(button.id)||button.hasAttribute('data-measure'))){button.disabled=true;button.title='An operator account is required to change settings or request a measurement.';return;}
    if(button.id==='reconnect'){button.disabled=busy;return;}
    if(button.id==='refresh'){button.disabled=busy||!training;return;}
    if(button.id==='cancel'){button.disabled=busy||!hasPending();return;}
    if(button.id==='approve'){button.disabled=busy||!training||!fresh||!hasPending()||pendingNeedsCancellation();return;}
    button.disabled = busy || !training || !fresh || (hasPending() && !['approve', 'cancel'].includes(button.id));
  });
  el('approval').hidden = !hasPending();
  if(hasPending())el('summary').textContent=(pendingNeedsCancellation()?'Cancellation cleanup required before another preview: ':'')+getPendingSummary();
  notebook?.sync();
}
async function act(fn: () => Promise<void>) {
  if (busy) return;
  busy = true; controls(); el('notice').textContent = '';
  try { await fn(); } catch (error) { el('notice').textContent = (error as Error).message; }
  finally { busy = false; controls(); if(spatial && hasPending())el('approval').scrollIntoView({behavior:'auto',block:'center'}); }
}
function clearMeasurement() { measurement = null; el('measurement').textContent = 'No measurement requested'; }
function selectedChannel(){return Number(el<HTMLSelectElement>('channel-select').value)||1;}
function showChannelControls(){
  if(!frame)return;
  const number=selectedChannel(),ch=frame.state.channels[String(number)] as any,label=`CH${number}`;
  el('scale-label').textContent=`${label} scale (V/div)`;el<HTMLInputElement>('scale').value=String(ch.vertical_scale);
  el('coupling-label').textContent=`${label} coupling`;el<HTMLSelectElement>('coupling').value=ch.coupling;
  el('offset-label').textContent=`${label} vertical offset (V)`;el<HTMLInputElement>('offset').value=String(ch.offset);
  el('probe-label').textContent=`${label} probe attenuation`;el<HTMLSelectElement>('probe').value=String(ch.probe_attenuation);
  el('channel-enabled').textContent=`${ch.enabled?'Disable':'Enable'} ${label}`;el('channel-enabled').setAttribute('aria-pressed',String(ch.enabled));
}
function draw() {
  if(!frame)return;
  const canvas = el<HTMLCanvasElement>('scope'), c = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height;
  c.fillStyle='#070e15';c.fillRect(0,0,w,h); c.strokeStyle = '#263a50'; c.lineWidth = 1;
  for (let i = 0; i <= 10; i++) { c.beginPath(); c.moveTo(i*w/10,0); c.lineTo(i*w/10,h); c.stroke(); }
  for (let i = 0; i <= 8; i++) { c.beginPath(); c.moveTo(0,i*h/8); c.lineTo(w,i*h/8); c.stroke(); }
  const traces=frame.traces??{CH1:{source:'CH1',time_s:frame.time_s,voltage_v:frame.voltage_v,clipped:frame.clipped,undersampled:frame.undersampled,trigger_possible:frame.trigger_possible}};
  const colors:Record<string,string>={CH1:'#ffdb7b',CH2:'#6ed9ff',CH3:'#ff8fe1',CH4:'#92eaa4'};
  const active:string[]=[],warnings:string[]=[];
  for(const source of ['CH1','CH2','CH3','CH4']){
    const channel=frame.state.channels[source.slice(-1)] as any,trace=traces[source];
    if(!channel?.enabled||!trace)continue;
    active.push(`${source} ${channel.vertical_scale} V/div ${channel.coupling==='ACLimit'?'AC':'DC'}`);
    c.strokeStyle=colors[source];c.lineWidth=2;c.beginPath();
    trace.voltage_v.forEach((v:number,i:number)=>{const x=i*w/(trace.voltage_v.length-1),y=h/2-(v+channel.offset)/channel.vertical_scale*h/8;if(i===0)c.moveTo(x,y);else c.lineTo(x,y);});c.stroke();
    if(trace.clipped)warnings.push(`${source} exceeds its display range`);
    if(trace.undersampled)warnings.push(`${source} is undersampled`);
    if(!trace.trigger_possible&&frame.state.trigger.source===source)warnings.push(`${source} cannot cross the selected trigger`);
  }
  const ch=frame.state.channels[String(selectedChannel())] as any;
  const rawSlope=String(frame.state.trigger.slope).toLowerCase();
  const slope=rawSlope.startsWith('pos')||rawSlope==='rising'?'rising':rawSlope.startsWith('neg')||rawSlope==='falling'?'falling':rawSlope;
  const rawMode=String(frame.state.trigger.mode).toLowerCase();
  const mode=rawMode==='auto'?'auto':rawMode==='normal'?'normal':rawMode;
  el('readout').textContent = `${active.join('  ·  ')||'No channels enabled'}\n${frame.state.timebase_scale} s/div · Trigger ${frame.state.trigger.source} ${slope} edge · ${mode} · ${frame.state.acquisition_state}`;
  el('notice').textContent = warnings.join('. ')||'All enabled channels share the selected ideal training source.';
  showChannelControls();
}
async function refresh() {
  const startedChanges=changes;
  let nextFrame:TrainingFrame;
  try {
    const sources=['CH1','CH2','CH3','CH4'];
    const responses=await Promise.all(sources.map(source=>api(`/api/training/waveform?source=${source}`)));
    nextFrame=responses[0];validateTrainingFrame(nextFrame);
    const traces=validateTrainingTraceSet(responses,nextFrame);
    if(startedChanges!==changes)throw Error('Shared simulator settings changed during this readback. Refresh again to compare current data.');
    nextFrame={...nextFrame,traces};validateTrainingFrame(nextFrame);
  }
  catch(error) {
    freshness(false, 'Readback unavailable. Displayed data is stale; reconnect before changing settings or exporting evidence.');
    clearMeasurement();
    updateLessonCheck();
    throw error;
  }
  frame = nextFrame;
  readbackAt = new Date().toISOString();
  freshness(true, `Last simulator readback: ${new Date(readbackAt).toLocaleTimeString()}. Shared settings may change in another page; refresh before comparing results.`);
  el<HTMLInputElement>('timebase').value = String(frame.state.timebase_scale);
  showChannelControls();
  el<HTMLInputElement>('level').value = String(frame.state.trigger.level);
  el<HTMLSelectElement>('trigger-source').value=frame.state.trigger.source;
  el<HTMLSelectElement>('trigger-slope').value=String(frame.state.trigger.slope).toLowerCase()==='negative'?'falling':'rising';
  el<HTMLSelectElement>('trigger-mode').value=String(frame.state.trigger.mode).toLowerCase()==='normal'?'normal':'auto';
  el<HTMLSelectElement>('scenario').value = frame.scenario;
  draw();
  spatial?.update(frame);
  updateLessonCheck();
}
async function preview(operation: Operation) {
  const result = await previewOperations([operation]);
  el('summary').textContent = result.summary;
}
document.querySelectorAll<HTMLButtonElement>('[data-setting]').forEach(button => button.onclick = () => void act(async () => {
  const input = document.getElementById(button.dataset.input!) as HTMLInputElement|HTMLSelectElement;
  if (input instanceof HTMLInputElement && input.type === 'number' && !input.reportValidity()) return;
  const path=button.dataset.setting!.replace('{channel}',String(selectedChannel()));
  await preview({path, value: input instanceof HTMLInputElement && input.type === 'number' ? Number(input.value) : input.value});
}));
document.querySelectorAll<HTMLButtonElement>('[data-measure]').forEach(button => button.onclick = () => void act(async () => { await preview({measurementType: button.dataset.measure!, source: el<HTMLSelectElement>('measure-source').value}); }));
el<HTMLSelectElement>('channel-select').onchange=()=>{showChannelControls();clearMeasurement();};
el<HTMLSelectElement>('measure-source').onchange=clearMeasurement;
el('channel-enabled').onclick=()=>void act(async()=>{const number=selectedChannel(),channel=frame?.state.channels[String(number)] as any;if(!channel)return;await preview({path:`channel.${number}.enabled`,value:!channel.enabled});});
window.addEventListener('rhoda-select-channel',event=>{const channel=Number((event as CustomEvent).detail?.channel);if(channel<1||channel>4)return;el<HTMLSelectElement>('channel-select').value=String(channel);el<HTMLSelectElement>('measure-source').value=`CH${channel}`;showChannelControls();clearMeasurement();});
el('approve').onclick = () => void act(async () => {
  clearMeasurement();
  let result;
  try { result = await confirmOperations(); }
  catch (error) {
    // An earlier operation in a batch may have succeeded. Reconcile the display
    // even when approval fails, while retaining the original operation error.
    await refresh().catch(() => undefined);
    throw error;
  }
  await refresh();
  const r = result.result as any;
  if (r.measurement_type) {
    measurement = {...r, captured_at: new Date().toISOString()};
    updateLessonCheck();
    el('measurement').textContent = r.value === null ? `${r.status} — no measured value (${r.source})` : `${Number(r.value.toPrecision(7))} ${r.unit} · ${r.measurement_type} on ${r.source} (simulated)`;
  }
});
window.addEventListener('rhoda-access-updated',controls);
el('cancel').onclick = () => void act(async () => { await cancelOperations(); await refresh(); });
el('load').onclick = () => void act(async () => { await api('/api/training/scenarios', {scenario: el<HTMLSelectElement>('scenario').value}); clearMeasurement(); await refresh(); });
el('refresh').onclick = () => void act(async () => { clearMeasurement(); await refresh(); });
el('export').onclick = () => {
  if (!fresh || !training || !frame) return;
  const data = {exported_at: new Date().toISOString(), readback_at:readbackAt, mode: 'training', frame, measurement};
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}));
  const a = document.createElement('a'); a.href=url; a.download='rhoda-training-evidence.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
async function connect() {
 training=false;freshness(false,'Checking simulator readback…');el('mode').textContent='Checking backend...';
 try {const diagnostics=await api('/api/instrument/diagnostics');el('diagnostics').textContent=JSON.stringify(diagnostics,null,2);training=diagnostics.mode==='mock';
 el('mode').textContent=training?'TRAINING MODE · RHODA generated signals · no hardware connected':`Backend: ${diagnostics.mode}. This practice bench only operates in training mode.`;
 if(training)await refresh();
 else {clearMeasurement();freshness(false,'This display is unavailable in the current backend mode.');updateLessonCheck();}
 }catch(error){training=false;freshness(false,'Simulator unavailable. Displayed data is stale; reconnect to continue.');clearMeasurement();updateLessonCheck();el('mode').textContent='Simulator unavailable. Start the backend, then choose Reconnect to simulator. Displayed data, if any, is stale.';throw error;}
}
el('reconnect').onclick=()=>void act(connect);
el('readable-setup').onclick=()=>void act(async()=>{
 const scale=.5;
  if(!frame)return;
  const time=frame.scenario==='square'?.0005:.0002;
 const result=await previewOperations([{path:'timebase.scale',value:time},{path:`channel.${selectedChannel()}.vertical_scale`,value:scale},{path:'trigger.level',value:0}]);
 el('summary').textContent='Readable training setup: '+result.summary;
});
function updateLessonCheck(){
 const box=document.getElementById('lesson-check');if(!box||!frame)return;
 if(!fresh){box.textContent='Lesson checks are paused until fresh simulator data is available.';return;}
 const lesson=(el('bench-lesson') as HTMLSelectElement).value,ch=frame.state.channels['1'];
 const checks:Record<string,[string,boolean][]>= {
 time:[['Load the 1 kHz sine',frame.scenario==='sine'],['Approve 100 us/div (one cycle across ten divisions)',Math.abs(frame.state.timebase_scale-.0001)<1e-10]],
 scale:[['Load the 2 Vpp sine',frame.scenario==='sine'],['Approve 0.1 V/div and observe clipping',ch.vertical_scale===.1&&frame.clipped]],
 coupling:[['Load the +1 V offset exercise',frame.scenario==='offset'],['Approve AC coupling to remove DC',ch.coupling==='ACLimit']],
 measure:[['Use sine or square source',['sine','square'].includes(frame.scenario)],['Approve a frequency measurement',measurement?.measurement_type==='frequency'&&measurement?.status==='simulator']]
 };
 box.replaceChildren();for(const [title,done] of checks[lesson]??[]){const row=document.createElement('p');row.style.margin='6px 0';row.textContent=(done?'Complete: ':'Next: ')+title;box.append(row);}
 const note=document.createElement('small');note.textContent='Checked against the current simulator state. This is practice feedback, not a hardware qualification.';box.append(note);
}
const signalPanel=el('scope').closest('.panel') as HTMLElement;
notebook=installCaptureNotebook(signalPanel.parentElement!,()=>({frame,readbackAt,measurement,ready:!busy&&fresh&&training&&!hasPending()}));
onInstrumentChange(()=>{changes++;if(!frame)return;freshness(false,'Shared simulator settings changed in another page. Refresh state before measuring or capturing evidence.');clearMeasurement();updateLessonCheck();controls();});
window.addEventListener('pageshow',event=>{if(event.persisted&&frame){freshness(false,'The bench was restored from browser history. Refresh state before comparing or capturing evidence.');clearMeasurement();updateLessonCheck();controls();}});
controls();void act(connect);

if(document.getElementById('instrument-view')) {
 const lessons:Record<string,string>={
 time:'Load the 1 kHz sine exercise. Preview 0.0001 s/div and approve: ten divisions span 1 ms, or one expected cycle. Compare 0.0005 s/div (five cycles). The horizontal Scale knob cycles standard values; the numeric controls allow a precise value.',
 scale:'Load the 2 Vpp sine. Compare 0.5 V/div and 0.1 V/div. Across eight divisions those ranges are 4 V and 0.8 V. Predict which clips, approve the change, and check the trace warning. Display clipping does not change the underlying ideal signal.',
 coupling:'Choose Sine +1 V DC offset and click Load exercise. Compare approved DC and AC coupling settings. The ideal AC model removes the offset. For physical work, consult the input-coupling and probe sections; actual filter behavior is not simulated.',
 measure:'Load a sine or square exercise. Click Meas or Quick meas on the 3D instrument, then approve the measurement. The source should yield 1000 Hz or 500 Hz respectively, with 2 Vpp. A disconnected source must not produce a fabricated reading.'
 };
 const select=document.getElementById('bench-lesson') as HTMLSelectElement;
 const show=()=>{document.getElementById('lesson-guide')!.textContent=lessons[select.value];updateLessonCheck();};select.onchange=show;show();
 void import('./spatialScope').then(module=>{
  spatial=module.createSpatialScope(el<HTMLCanvasElement>('scope'));
  if(frame)spatial.update(frame);
  spatial.setFreshness(fresh,el('data-status').textContent||'Waiting for simulator readback.');
 }).catch(()=>{document.getElementById('instrument-view')!.textContent='3D is unavailable in this browser. Use the equivalent 2D screen and controls below.';});
}
