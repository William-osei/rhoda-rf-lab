import type {WebGLRenderer} from 'three';
import {desktopPixelRatio,frameSummary,type DesktopQuality} from './performanceBudget';

/** Local desktop diagnostics. RAF intervals are not GPU timings or an XR benchmark. */
export function installStudioPerformance(renderer:WebGLRenderer,entryTime:number){
 const details=document.createElement('details');details.id='performance-panel';
 details.innerHTML='<summary>Desktop performance &amp; quality</summary><p>Choose a rendering budget for this screen. Headset rendering uses the XR session’s own framebuffer.</p><label for="desktop-quality">Desktop quality</label><select id="desktop-quality"><option value="balanced">Balanced · adaptive resolution</option><option value="detail">Detail · higher resolution</option><option value="economy">Economy · lower pixel budget</option></select><p id="perf-quality-status" role="status"></p><label class="switch-row"><input id="perf-enabled" type="checkbox"> Measure this desktop session</label><p id="perf-state">Measurements are off. No data is sent anywhere.</p><dl id="perf-metrics"></dl><div class="controls"><button id="perf-reset" disabled>Reset samples</button><button id="perf-export" disabled>Export measurements</button></div><p class="perf-note">Visible desktop frame intervals measure browser scheduling, not GPU time. A 16.7 ms interval corresponds to 60 Hz; 33.3 ms to 30 Hz. Measurements pause in hidden tabs and immersive XR. Transfers may be cached or unavailable. This is not headset validation.</p><a class="subtle-link" href="fonts/LICENSE.txt" target="_blank" rel="noopener">Spatial font attribution ↗</a>';
 document.getElementById('learning-console')?.append(details);
 const select=details.querySelector('#desktop-quality') as HTMLSelectElement;
 const enabled=details.querySelector('#perf-enabled') as HTMLInputElement;
 const state=details.querySelector('#perf-state') as HTMLParagraphElement;
 const metrics=details.querySelector('#perf-metrics') as HTMLElement;
 const reset=details.querySelector('#perf-reset') as HTMLButtonElement;
 const save=details.querySelector('#perf-export') as HTMLButtonElement;
 const qualityStatus=details.querySelector('#perf-quality-status') as HTMLElement;
 let quality:DesktopQuality='balanced';
 try{const saved=localStorage.getItem('rhoda.desktop.quality');if(saved==='balanced'||saved==='detail'||saved==='economy')quality=saved;}catch{}
 select.value=quality;
 let qualitySaved=true;
 const stages:Record<string,number>={'runtime-entry':entryTime,'world-ready':performance.now()};
 let samples:number[]=[];let running=false;let raf=0;let previous:number|null=null;let lastRender=0;let longTasks=0;
 let observer:PerformanceObserver|null=null;
 const longTasksSupported=typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes?.includes('longtask');
 const applyBudget=()=>{
  if(renderer.xr.isPresenting){qualityStatus.textContent='Desktop setting saved for after XR.';return;}
  renderer.setPixelRatio(desktopPixelRatio(innerWidth,innerHeight,devicePixelRatio,quality));
  qualityStatus.textContent=`${renderer.domElement.width} × ${renderer.domElement.height} drawing buffer · ${renderer.getPixelRatio().toFixed(2)} pixel ratio${qualitySaved?'':' · preference could not be saved'}`;
  details.dataset.pixelRatio=String(renderer.getPixelRatio());
 };
 select.addEventListener('change',()=>{quality=select.value as DesktopQuality;try{localStorage.setItem('rhoda.desktop.quality',quality);qualitySaved=true;}catch{qualitySaved=false;}applyBudget();previous=null;samples=[];renderMetrics();});
 const assetSummary=()=>{
  const groups:Record<string,{count:number;transferBytes:number;encodedBytes:number;decodedBytes:number;unavailableOrCached:number}>={};
  for(const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]){
   const url=new URL(entry.name,location.href);if(!['http:','https:'].includes(url.protocol)||url.pathname.startsWith('/api/'))continue;
   const category=entry.initiatorType==='script'||/\.(?:m?js|ts)(?:$|\?)/.test(url.pathname)?'javascript':/\.glb$/.test(url.pathname)?'models':/\/fonts\//.test(url.pathname)?'spatial fonts':/\/ui\//.test(url.pathname)?'spatial panel':null;
   if(!category)continue;
   const group=groups[category]??={count:0,transferBytes:0,encodedBytes:0,decodedBytes:0,unavailableOrCached:0};
   group.count++;group.transferBytes+=entry.transferSize;group.encodedBytes+=entry.encodedBodySize;group.decodedBytes+=entry.decodedBodySize;if(!entry.transferSize)group.unavailableOrCached++;
  }
  return groups;
 };
 const report=()=>({schemaVersion:1,scope:'visible-desktop-browser',generatedAt:new Date().toISOString(),quality,pixelRatio:renderer.getPixelRatio(),drawingBuffer:{width:renderer.domElement.width,height:renderer.domElement.height},startupMsSinceNavigation:{...stages},frames:frameSummary(samples),observedLongTasks:longTasksSupported?longTasks:null,renderer:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures},resources:assetSummary(),notes:['Frame intervals are browser RAF scheduling, not GPU timings. Last 600 intervals only.','Only observed visible desktop intervals are included; XR and hidden tabs are excluded.','Resource transfer totals are browser observations; zero may mean cached or unavailable. Data/blob resources are not counted.','Startup marks are relative to navigation and include browser/module scheduling; they are not download benchmarks.','No session identifiers, resource URLs, tokens, device identifiers or conversation content are exported.']});
 const addMetric=(label:string,value:string)=>{const dt=document.createElement('dt');dt.textContent=label;const dd=document.createElement('dd');dd.textContent=value;metrics.append(dt,dd);};
 function renderMetrics(){
  const data=report();metrics.replaceChildren();
  const time=(n:number|null)=>n===null?'Waiting for samples':`${n.toFixed(1)} ms`;
  addMetric('Studio ready',stages['studio-ready']===undefined?'Preparing scene':time(stages['studio-ready']));
  addMetric('Frame median / 95th',`${time(data.frames.medianMs)} / ${time(data.frames.p95Ms)}`);
  addMetric('Frames over 33.3 ms',`${data.frames.over33ms} of ${data.frames.samples}`);
  addMetric('Draw calls / triangles',`${data.renderer.calls} / ${data.renderer.triangles.toLocaleString()}`);
  addMetric('Geometries / textures',`${data.renderer.geometries} / ${data.renderer.textures}`);
  const resources=Object.values(data.resources);addMetric('Observed asset transfer',`${(resources.reduce((sum,r)=>sum+r.transferBytes,0)/1_000_000).toFixed(2)} MB`);
  addMetric('Zero-transfer entries',String(resources.reduce((sum,r)=>sum+r.unavailableOrCached,0)));
  details.dataset.samples=String(data.frames.samples);
 }
 const tick=(now:number)=>{
  if(!running)return;
  const eligible=!document.hidden&&!renderer.xr.isPresenting;
  if(eligible){if(previous!==null){samples.push(now-previous);if(samples.length>600)samples.shift();}previous=now;}else previous=null;
  if(now-lastRender>1000){lastRender=now;renderMetrics();state.textContent=eligible?'Measuring visible desktop frames. No data is sent anywhere.':'Paused while this tab is hidden or XR is presenting.';}
  raf=requestAnimationFrame(tick);
 };
 const stop=()=>{running=false;cancelAnimationFrame(raf);previous=null;observer?.disconnect();observer=null;details.dataset.sampling='false';};
 const updateSampling=()=>{
  stop();reset.disabled=save.disabled=!enabled.checked;
  if(!enabled.checked){state.textContent='Measurements are off. No data is sent anywhere.';return;}
  if(!details.open){state.textContent='Paused while performance details are closed.';return;}
  running=true;details.dataset.sampling='true';
  if(longTasksSupported)try{observer=new PerformanceObserver(list=>{if(!document.hidden&&!renderer.xr.isPresenting)longTasks+=list.getEntries().length;});observer.observe({entryTypes:['longtask']});}catch{observer=null;}
  raf=requestAnimationFrame(tick);renderMetrics();
 };
 enabled.addEventListener('change',updateSampling);details.addEventListener('toggle',updateSampling);
 reset.onclick=()=>{samples=[];longTasks=0;previous=null;renderMetrics();};
 save.onclick=()=>{const blob=new Blob([JSON.stringify(report(),null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='rhoda-desktop-performance.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 window.addEventListener('resize',applyBudget);renderer.xr.addEventListener('sessionstart',()=>{previous=null;applyBudget();});renderer.xr.addEventListener('sessionend',()=>{previous=null;applyBudget();});
 window.addEventListener('pagehide',stop);window.addEventListener('pageshow',updateSampling);
 applyBudget();renderMetrics();
 if(new URLSearchParams(location.search).get('performance')==='1'){details.open=true;enabled.checked=true;updateSampling();}
 return {mark(name:'avatar-ready'|'studio-ready'|'spatial-panel-requested'){stages[name]=performance.now();renderMetrics();}};
}
