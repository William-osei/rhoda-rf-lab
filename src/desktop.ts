import './labAccessUI';
import {labFetch} from './authRequest';
import {BACKEND} from './runtimeConfig';

try{sessionStorage.setItem('rhoda-desktop-home','1');}catch{/* Home navigation remains independent of optional storage. */}

type Availability='checking'|'ready'|'attention';
type Result={state:Availability;title:string;detail:string};
const check=document.getElementById('check-readiness') as HTMLButtonElement;
const desktopSettings=document.getElementById('desktop-display-settings') as HTMLButtonElement|null;
const browserFullscreen=document.getElementById('browser-fullscreen') as HTMLButtonElement|null;
const settingsDialog=document.getElementById('desktop-settings-dialog') as HTMLDialogElement|null;
const settingsClose=document.getElementById('desktop-settings-close') as HTMLButtonElement|null;
const settingsOk=document.getElementById('desktop-settings-ok') as HTMLButtonElement|null;
const displayModeStatus=document.getElementById('display-mode-status') as HTMLElement|null;
const exitButton=document.getElementById('exit-rhoda') as HTMLButtonElement|null;
const exitStatus=document.getElementById('exit-rhoda-status') as HTMLElement|null;
const displayModeLabels:Record<string,string>={borderless:'Borderless',windowed:'Windowed',fullscreen:'Fullscreen'};
let pending=false;
const displayModeCards=document.querySelectorAll<HTMLButtonElement>('[data-display-mode]');
let selectedDisplayMode='borderless';
try{
 const saved=localStorage.getItem('rhoda-display-mode');
 if(saved&&saved in displayModeLabels)selectedDisplayMode=saved;
}catch{/* Preferences remain optional. */}
async function selectDisplayMode(mode:string,save=true){
 if(!(mode in displayModeLabels))return;
 selectedDisplayMode=mode;
 displayModeCards.forEach(card=>{
  const active=card.dataset.displayMode===mode;
  card.setAttribute('aria-checked',String(active));
 });
 if(!save){if(displayModeStatus)displayModeStatus.textContent=`${displayModeLabels[mode]} selected · restart RHODA to apply.`;return;}
 if(displayModeStatus)displayModeStatus.textContent=`Saving ${displayModeLabels[mode]}…`;
 try{
  const response=await labFetch(BACKEND+'/api/desktop/display-mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode})});
  if(!response.ok)throw Error('Display mode could not be saved');
  try{localStorage.setItem('rhoda-display-mode',mode);}catch{/* Selection remains active for this page. */}
  if(displayModeStatus)displayModeStatus.textContent=`${displayModeLabels[mode]} selected · restart RHODA to apply.`;
 }catch{
  if(displayModeStatus)displayModeStatus.textContent='Could not save this choice. Use the RHODA tray Display settings.';
 }
}
displayModeCards.forEach(card=>card.addEventListener('click',()=>void selectDisplayMode(card.dataset.displayMode||'borderless')));
void (async()=>{
 try{
  const response=await labFetch(BACKEND+'/api/desktop/display-mode',{cache:'no-store'});
  if(response.ok){
   const data=await response.json() as {mode?:string};
   if(data.mode&&data.mode in displayModeLabels)selectedDisplayMode=data.mode;
  }
 }catch{/* The tray setting remains available if the service is unavailable. */}
 await selectDisplayMode(selectedDisplayMode,false);
})();
desktopSettings?.addEventListener('click',()=>{
 if(settingsDialog?.showModal)settingsDialog.showModal();
});
settingsClose?.addEventListener('click',()=>settingsDialog?.close());
settingsOk?.addEventListener('click',()=>settingsDialog?.close());
browserFullscreen?.addEventListener('click',async()=>{
 try{
  if(document.fullscreenElement){await document.exitFullscreen();browserFullscreen.textContent='Enter browser fullscreen';}
  else{await document.documentElement.requestFullscreen();browserFullscreen.textContent='Exit browser fullscreen';}
 }catch{window.alert('Browser fullscreen is unavailable in this window. Use the RHODA tray Display settings instead.');}
});
exitButton?.addEventListener('click',async()=>{
 if(exitButton.disabled)return;
 exitButton.disabled=true;
 if(exitStatus)exitStatus.textContent='Closing RHODA…';
 try{
  const response=await labFetch(BACKEND+'/api/desktop/exit',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store',signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('The desktop supervisor did not accept the exit request');
  if(exitStatus)exitStatus.textContent='RHODA is closing.';
 }catch{
  exitButton.disabled=false;
  if(exitStatus)exitStatus.textContent='Could not close automatically. Close this RHODA window or choose Exit RHODA in the tray menu.';
 }
});
function render(area:'service'|'library'|'knowledge',result:Result){
 document.getElementById(area+'-card')!.dataset.state=result.state;
 document.getElementById(area+'-status')!.textContent=result.title;
 document.getElementById(area+'-detail')!.textContent=result.detail;
}
async function localJSON(path:string){
 const response=await labFetch(BACKEND+path,{cache:'no-store',signal:AbortSignal.timeout(7000)});
 if(response.status===401)return null;
 if(!response.ok)throw Error('Local service unavailable');
 const data:unknown=await response.json();
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Unexpected local response');
 return data as Record<string,unknown>;
}
async function serviceStatus():Promise<Result>{
 try{
  const data=await localJSON('/api/health');
  if(!data)return {state:'attention',title:'Lab sign-in required',detail:'Sign in above to check the shared lab. Built-in lessons remain available.'};
  if(data.status!=='ok'||typeof data.instrument!=='string')throw Error('Unexpected health response');
  if(data.instrument==='mock'||data.instrument==='driver-simulation')return {state:'ready',title:'Practice simulator ready',detail:'Explore settings and measurements using generated training signals.'};
  if(data.instrument==='unavailable')return {state:'attention',title:'Practice service needs attention',detail:'The app is running, but instrument practice is unavailable. Guides and companion lessons remain available.'};
  return {state:'ready',title:'Instrument service ready',detail:'A configured instrument mode is active. Review the bench’s connection information before changing settings.'};
 }catch{
  return {state:'attention',title:'Local practice service unavailable',detail:'Guided lessons still open. Check the connection again or reopen RHODA to restore simulator practice.'};
 }
}
async function libraryStatus():Promise<Result>{
 try{
  const data=await localJSON('/api/library/documents');
  if(!data)return {state:'attention',title:'References need lab sign-in',detail:'Sign in above to search shared documents. Built-in study guides are available in Resources.'};
  if(!Array.isArray(data.documents)||!Number.isInteger(data.indexed_pages)||Number(data.indexed_pages)<0)throw Error('Unexpected catalogue response');
  const count=data.documents.length,pages=Number(data.indexed_pages);
  if(!count)return {state:'attention',title:'No local documents found',detail:'Built-in fundamentals and study guides remain available in Resources.'};
  return {state:'ready',title:`${count.toLocaleString()} local ${count===1?'document':'documents'} ready`,detail:`Search ${pages.toLocaleString()} reference pages, plus built-in fundamentals and study paths.`};
 }catch{
  return {state:'attention',title:'Local document search unavailable',detail:'Open Resources for built-in study guides, or check the connection again to restore document search.'};
 }
}
async function knowledgeStatus():Promise<Result>{
 try{
  const data=await localJSON('/api/rag/status');
  if(!data||data.available!==true||typeof data.method!=='string'||!Number.isInteger(data.documents)||typeof data.corpus_version!=='string')throw Error('Canonical retrieval unavailable');
  const count=Number(data.documents),method=data.method==='lexical'?'offline lexical':data.method;
  return {state:'ready',title:`Canonical ${method} knowledge ready`,detail:`${count.toLocaleString()} source-grounded ${count===1?'document':'documents'} · corpus ${data.corpus_version.slice(0,16)} · no cloud AI.`};
 }catch{
  return {state:'attention',title:'Canonical knowledge unavailable',detail:'Chat can still use its embedded local fallback. Reopen RHODA or check the connection to restore source-grounded retrieval.'};
 }
}
async function refresh(){
 if(pending)return;
 pending=true;check.disabled=true;check.textContent='Checking…';
 try{
  const [service,library,knowledge]=await Promise.all([serviceStatus(),libraryStatus(),knowledgeStatus()]);
  render('service',service);render('library',library);render('knowledge',knowledge);
 }finally{pending=false;check.disabled=false;check.textContent='Check connection';}
}
check.onclick=()=>void refresh();
window.addEventListener('pageshow',event=>{if((event as PageTransitionEvent).persisted)void refresh();});

// Remember only a known workspace link, never a free-form URL or account detail.
const sections=new Map<string,string>();
for(const link of document.querySelectorAll<HTMLAnchorElement>('.workspace-card[data-section]')){
 const route=link.getAttribute('href')!,label=link.dataset.section!;sections.set(route,label);
 link.addEventListener('click',()=>{try{localStorage.setItem('rhoda-desktop-last-workspace',route);}catch{/* Navigation remains available without storage. */}});
}
try{
 const route=localStorage.getItem('rhoda-desktop-last-workspace');
 if(route&&sections.has(route)){
  const resume=document.getElementById('resume-workspace') as HTMLAnchorElement;
  resume.href=route;resume.textContent='Continue in '+sections.get(route)+' →';resume.hidden=false;
 }
}catch{/* Local storage is optional. */}
void refresh();
