import './labAccessUI';
import {labFetch} from './authRequest';
import {getLabAccess} from './labAccess';
import {BACKEND} from './runtimeConfig';
import {prepareReview,createAuthoredReview,MAX_REVIEW_BYTES,MAX_REVIEW_CHARS} from './instructorAuthoredReview';
import {installAiReviewUI} from './instructorAiReview';

type JournalEvent = {
  session_id:string; owner_id?:string|null; owner_label?:unknown; auth_owner?:unknown;
  role?:unknown; timestamp?:unknown; server_timestamp?:unknown; tool_call?:unknown; confirmed?:unknown; content?:unknown;
};
type ReviewScope = {sessionId:string;ownerId?:string};
const element = (id:string) => document.getElementById(id)!;
const refreshButton = element('refresh-records') as HTMLButtonElement;
const exportButton = element('export-all') as HTMLButtonElement;
const sessionSelect = element('review-session') as HTMLSelectElement;
const status = element('status');
const context = element('session-context');
const dashboard = document.querySelector('main')!;
const escape = (value:unknown) => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const count = (value:unknown) => typeof value==='number'&&Number.isFinite(value)?Math.max(0,value):0;
const validSession = (id:unknown):id is string => typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
const validOwner = (id:unknown):id is string => typeof id==='string'&&(id==='legacy'||/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
function reviewScope(selection:string):ReviewScope|null {
  if(validSession(selection))return {sessionId:selection};
  try {
    const parts:unknown=JSON.parse(selection);
    if(Array.isArray(parts)&&parts.length===2&&validOwner(parts[0])&&validSession(parts[1]))return {ownerId:parts[0].toLowerCase(),sessionId:parts[1]};
  } catch { /* Only validated scopes are sent to the API. */ }
  return null;
}
const selectionFor = (log:JournalEvent) => Object.prototype.hasOwnProperty.call(log,'owner_id')?JSON.stringify([log.owner_id??'legacy',log.session_id]):log.session_id;
const sessionQuery = (selection:string) => {
  const scope=reviewScope(selection);if(!scope)return '';
  const query=new URLSearchParams({session_id:scope.sessionId});
  if(scope.ownerId)query.set('owner_id',scope.ownerId);
  return `?${query}`;
};
const owner = (log:JournalEvent) => typeof log.owner_label==='string'&&log.owner_label?log.owner_label:typeof log.auth_owner==='string'&&log.auth_owner ? log.auth_owner : 'Offline / owner unavailable';
const timestamp = (log:JournalEvent) => String(log.timestamp||log.server_timestamp||'');
const displayTime = (value:string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Time unavailable';
const currentOnly = () => {const access=getLabAccess();return !!access?.enabled&&!access.permissions['inspectAllSessions'];};
const exportLabel = () => sessionSelect.value?'Export selected transcript':currentOnly()?'Export current transcript':'Export all accessible transcripts';
let busy=false, loaded=false, timer:number|undefined, revision=0;
let active:AbortController|undefined;
let selectedRecords:JournalEvent[]=[],selectedRecordsScope='';
let aiReviewUI:ReturnType<typeof installAiReviewUI>;

const initialSession = new URLSearchParams(location.search).get('session_id');
const initialOwner = new URLSearchParams(location.search).get('owner_id');
if(validSession(initialSession)) {
  const selected=validOwner(initialOwner)?JSON.stringify([initialOwner.toLowerCase(),initialSession]):initialSession;
  sessionSelect.add(new Option(initialSession,selected));sessionSelect.value=selected;
}

async function fetchJSON(path:string,signal:AbortSignal) {
  try {
    const response=await labFetch(`${BACKEND}${path}`,{signal:AbortSignal.any([signal,AbortSignal.timeout(8000)])});
    const data=await response.json();
    if(!response.ok)return {code:data?.code,status:response.status};
    return data&&typeof data==='object'&&!Array.isArray(data)?data:null;
  } catch {return null;}
}

function clearRecords(message:string) {
  selectedRecords=[];selectedRecordsScope='';authoredReviewUI?.recordsUnavailable();
  for(const id of ['total-logs','total-turns','total-errors','next-topic'])element(id).textContent='—';
  element('transcript').textContent=message;
  element('progress-bars').textContent=message;
  element('failure-list').textContent=message;
  loaded=false;exportButton.disabled=true;
}

function updateSessions(logs:JournalEvent[],selected:string,indexAvailable=true) {
  const groups=new Map<string,JournalEvent[]>();
  for(const log of logs) {
    const key=selectionFor(log),entries=groups.get(key)||[];entries.push(log);groups.set(key,entries);
  }
  const newest=(entries:JournalEvent[])=>entries.reduce((latest,log)=>Math.max(latest,Date.parse(timestamp(log))||0),0);
  const options=[new Option(!indexAvailable?'All sessions · list unavailable':currentOnly()?'Current session':`All accessible sessions (${groups.size})`,'')];
  for(const [selection,entries] of [...groups].sort((a,b)=>newest(b[1])-newest(a[1]))) {
    const owners=[...new Set(entries.map(owner))].join(', ');
    options.push(new Option(`${owners} · ${reviewScope(selection)?.sessionId} · ${entries.length} events`,selection));
  }
  // Keep a deep-linked or newly empty session selected rather than silently showing all learners.
  if(selected&&!groups.has(selected))options.push(new Option(`${reviewScope(selected)?.sessionId||'Session'} · no available events`,selected));
  sessionSelect.replaceChildren(...options);sessionSelect.value=selected;sessionSelect.disabled=false;
  exportButton.textContent=exportLabel();
  return groups;
}

function renderLogs(entries:JournalEvent[],selected:string) {
  element('total-logs').textContent=String(entries.length);
  element('total-turns').textContent=String(entries.filter(log=>log.role==='user'||log.role==='assistant').length);
  element('transcript').innerHTML=entries.map(log=>{
    const role=typeof log.role==='string'?log.role:'system';
    const cls=['user','assistant','system','tool'].includes(role)?role:'system';
    const call=log.tool_call as {name?:unknown;category?:unknown}|null;
    const content=call&&typeof call==='object'?`TOOL: ${call.name} (${call.category}) confirmed=${log.confirmed??'?'}`:log.content||'';
    const attribution=selected?'':` [${log.session_id} · ${owner(log)}]`;
    return `<span class="log-${cls}">[${escape(displayTime(timestamp(log)))}]${escape(attribution)} ${escape(role.toUpperCase())}: ${escape(content)}</span>`;
  }).join('\n')||'No events recorded for this selection yet.';
}

async function refresh(replace=false) {
  if(busy&&!replace)return;
  active?.abort();const controller=new AbortController();active=controller;
  const run=++revision,selected=sessionSelect.value,query=sessionQuery(selected);
  busy=true;refreshButton.disabled=true;exportButton.disabled=true;dashboard.setAttribute('aria-busy','true');
  authoredReviewUI?.syncSelection();
  status.textContent='Refreshing records…';
  try {
    // The API enforces visibility. Session choices come only from the authorized journal.
    const indexRequest=fetchJSON('/api/session/logs',controller.signal);
    const [logs,scopedLogs,progress,failures]=await Promise.all([
      indexRequest,
      selected?fetchJSON(`/api/session/logs${query}`,controller.signal):indexRequest,
      fetchJSON(`/api/session/progress${query}`,controller.signal),
      fetchJSON(`/api/session/failure-points${query}`,controller.signal),
    ]);
    if(run!==revision)return;
    const indexAvailable=Array.isArray(logs?.logs);
    if(!indexAvailable&&!selected) {
      clearRecords('Records unavailable. Use Refresh to reconnect.');
      sessionSelect.replaceChildren(new Option('Session list unavailable',''));sessionSelect.disabled=true;
      context.textContent='Session list unavailable. No records are displayed.';
      status.textContent=logs?.code==='journal_limit'?'The journal exceeds the review limit. Open a specific owner/session link to review a smaller selection.':'Could not load session records. Check lab access and the backend, then refresh.';
      return;
    }
    const allEntries:JournalEvent[]=indexAvailable?logs.logs.filter((log:unknown):log is JournalEvent=>!!log&&typeof log==='object'&&validSession((log as JournalEvent).session_id)):[];
    if(!Array.isArray(scopedLogs?.logs)) {
      updateSessions(allEntries,selected,indexAvailable);
      clearRecords('Selected session unavailable or not permitted.');
      context.textContent=`Session ${reviewScope(selected)?.sessionId||'selection'} could not be loaded. No records are displayed.`;
      status.textContent=scopedLogs?.code==='ambiguous_session'?'This session ID has more than one owner. Choose an owner-specific option from Review session.':scopedLogs?.code==='journal_limit'?'This selection exceeds the review limit. Choose a smaller session.':'Could not load the selected session. Choose another session or refresh.';
      return;
    }
    const scope=reviewScope(selected);
    const entries:JournalEvent[]=scopedLogs.logs.filter((log:unknown):log is JournalEvent=>!!log&&typeof log==='object'&&validSession((log as JournalEvent).session_id)&&(!scope||((log as JournalEvent).session_id===scope.sessionId&&(!scope.ownerId||((log as JournalEvent).owner_id??'legacy')===scope.ownerId))));
    selectedRecords=scope?structuredClone(entries):[];selectedRecordsScope=scope?selected:'';
    // Learners may deep-link an older owned session that is absent from their current-session list.
    const groups=updateSessions(selected?[...allEntries.filter(log=>selectionFor(log)!==selected),...entries]:allEntries,selected,indexAvailable);
    const missing:string[]=indexAvailable?[]:['session list'];
    renderLogs(entries,selected);
    const latest=entries.map(timestamp).sort((a,b)=>(Date.parse(b)||0)-(Date.parse(a)||0))[0]||'';
    context.textContent=selected
      ? `Session ${scope?.sessionId} · ${[...new Set(entries.map(owner))].join(', ')||'Owner unavailable'} · ${entries.length} events. Latest activity: ${displayTime(latest)}.`
      : `${currentOnly()?'Current session':`${groups.size} accessible sessions`} · ${entries.length} events. Each transcript entry identifies its session and recorded owner.`;
    if(progress?.topic_scores&&typeof progress.topic_scores==='object'&&!Array.isArray(progress.topic_scores)) {
      element('progress-bars').innerHTML=Object.entries(progress.topic_scores).map(([topic,score])=>{
        const value=count(score);
        return `<div class="topic-bar"><div class="label"><span>${escape(topic.replace(/_/g,' '))}</span><span>${value}</span></div><div class="bar"><div class="fill" style="width:${Math.min(value,100)}%"></div></div></div>`;
      }).join('')||'<p class="empty-records">No topic activity recorded yet.</p>';
      element('next-topic').textContent=!entries.length?'No activity yet':typeof progress.recommended_next==='string'?progress.recommended_next.replace(/_/g,' '):'—';
    } else {
      missing.push('topic activity');element('progress-bars').textContent='Topic activity unavailable.';element('next-topic').textContent='Unavailable';
    }
    if(Array.isArray(failures?.common_faults)) {
      element('total-errors').textContent=String(count(failures.total_errors));
      const faults=failures.common_faults.filter((row:unknown)=>Array.isArray(row)&&row.length===2);
      element('failure-list').innerHTML=faults.length?'<table><tr><th>Issue</th><th>Count</th></tr>'+faults.map(([description,total]:unknown[])=>`<tr><td>${escape(description)}</td><td><span class="badge badge-fault">${count(total)}</span></td></tr>`).join('')+'</table>':'<p class="empty-records">No failures recorded.</p>';
    } else {missing.push('failure summary');element('total-errors').textContent='—';element('failure-list').textContent='Failure summary unavailable.';}
    loaded=entries.length>0;
    status.textContent=missing.length?`Session records updated. Unavailable: ${missing.join(', ')}. Use Refresh to retry.`:'Updated '+new Date().toLocaleTimeString();
  } finally {
    if(run===revision){busy=false;refreshButton.disabled=false;exportButton.disabled=!loaded;dashboard.setAttribute('aria-busy','false');authoredReviewUI?.syncSelection();}
  }
}

async function exportRecords() {
  if(busy||!loaded)return;
  const selected=sessionSelect.value,run=++revision,controller=new AbortController();active=controller;
  const scope=reviewScope(selected);
  busy=true;exportButton.disabled=true;refreshButton.disabled=true;status.textContent='Preparing transcript export…';
  try {
    const response=await labFetch(`${BACKEND}/api/session/transcript${sessionQuery(selected)}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])});
    if(!response.ok)throw new Error('transcript unavailable');
    const text=await response.text();
    if(run!==revision)return;
    if(!text.trim())throw new Error('empty transcript');
    const url=URL.createObjectURL(new Blob([text],{type:'text/plain'}));
    const name=scope?`${scope.sessionId}${scope.ownerId?`-${scope.ownerId}`:''}`:currentOnly()?'current':'all';
    const anchor=document.createElement('a');anchor.href=url;anchor.download=`rhoda-transcript-${name}.txt`;anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='Transcript export prepared for '+(scope?`session ${scope.sessionId}.`:currentOnly()?'the current session.':'all accessible sessions.');
  } catch {if(run===revision)status.textContent='Transcript export failed or was empty. Refresh the selected session and retry; no export was prepared.';}
  finally {if(run===revision){busy=false;exportButton.disabled=!loaded;refreshButton.disabled=false;}}
}

sessionSelect.addEventListener('change',()=>{
  authoredReviewUI?.clear('Session selection changed. Review input and results were cleared.');
  selectedRecords=[];selectedRecordsScope='';
  const url=new URL(location.href);
  const scope=reviewScope(sessionSelect.value);
  if(scope)url.searchParams.set('session_id',scope.sessionId);else url.searchParams.delete('session_id');
  if(scope?.ownerId)url.searchParams.set('owner_id',scope.ownerId);else url.searchParams.delete('owner_id');
  history.replaceState(null,'',url);
  exportButton.textContent=exportLabel();
  clearRecords('Loading selected records…');context.textContent='Loading selected session…';void refresh(true);
});

function installAuthoredReview() {
  const section=document.getElementById('authored-review');
  // Older embedded dashboard fixtures and pages can still use their existing controls.
  if(!section)return undefined;
  const panel=section;
  const input=element('authored-log') as HTMLTextAreaElement;
  const format=element('authored-format') as HTMLSelectElement;
  const file=element('authored-file') as HTMLInputElement;
  const useSelection=element('authored-use-selection') as HTMLButtonElement;
  const previewButton=element('authored-preview') as HTMLButtonElement;
  const startButton=element('authored-start') as HTMLButtonElement;
  const cancelButton=element('authored-cancel') as HTMLButtonElement;
  const clearButton=element('authored-clear') as HTMLButtonElement;
  const preview=element('authored-input-preview');
  const output=element('authored-output');
  const reviewStatus=element('authored-status');
  const sourceLabel=element('authored-source');
  const inputCount=element('authored-input-count');
  let prepared:ReturnType<typeof prepareReview>|null=null;
  let reader:FileReader|undefined,workTimer:number|undefined,workRevision=0,working=false;
  let origin:'paste'|'file'|'selection'='paste';
  const allowed=()=>{const access=getLabAccess();return !!access&&(!access.enabled||Boolean(access.authenticated&&access.permissions['inspectAllSessions']));};
  const accessKey=()=>{const access=getLabAccess();return JSON.stringify([access?.enabled,access?.authenticated,access?.user?.username,access?.user?.role,access?.sessionId,access?.permissions['inspectAllSessions']]);};
  let account=accessKey();
  function selectedSnapshot() {
    const selected=sessionSelect.value,scope=reviewScope(selected);
    if(!allowed()||busy||!loaded||!scope||selected!==selectedRecordsScope||!selectedRecords.length)return null;
    // Cloud records require the explicit owner/session option. Never import an aggregate or ambiguous deep link.
    if(!scope.ownerId&&selectedRecords.some(log=>Object.prototype.hasOwnProperty.call(log,'owner_id')))return null;
    const entries=selectedRecords.filter(log=>log.session_id===scope.sessionId&&(!scope.ownerId||(log.owner_id??'legacy')===scope.ownerId));
    return entries.length===selectedRecords.length?{scope,entries}:null;
  }
  function controls() {
    const permitted=allowed();
    input.disabled=!permitted||working;format.disabled=!permitted||working;file.disabled=!permitted||working;
    useSelection.disabled=!selectedSnapshot()||working;
    previewButton.disabled=!permitted||working||!input.value.trim();
    startButton.disabled=!permitted||working||!prepared;
    cancelButton.disabled=!working;
    clearButton.disabled=!input.value&&!prepared&&!working&&output.hidden;
    inputCount.textContent=`${input.value.length.toLocaleString()} / ${MAX_REVIEW_CHARS.toLocaleString()} characters`;
    panel.setAttribute('aria-busy',String(working));
    aiReviewUI?.syncPreview();
  }
  function stop() {
    workRevision++;clearTimeout(workTimer);workTimer=undefined;
    const old=reader;reader=undefined;old?.abort();working=false;
  }
  function discard(message:string) {
    aiReviewUI?.clear('Local review input changed. AI input and results were cleared.');
    stop();prepared=null;output.replaceChildren();output.hidden=true;
    preview.textContent='Preview an input before starting the authored checklist.';
    reviewStatus.textContent=message;controls();
  }
  function clear(message:string) {
    discard(message);input.value='';file.value='';origin='paste';
    sourceLabel.textContent='No input selected.';controls();
  }
  function showPreview() {
    discard('Checking input…');
    if(!allowed()){reviewStatus.textContent='Instructor access must be verified before preparing a checklist.';return;}
    try {
      prepared=prepareReview(input.value,format.value as 'text'|'json'|'auto');
      preview.textContent=prepared.text;
      if(prepared.truncated){prepared=null;reviewStatus.textContent='This input is marked as partial. Choose a complete, narrower log before starting a checklist.';controls();return;}
      reviewStatus.textContent=`Input ready: ${prepared.eventCount} recorded events. Start creates the built-in authored checklist; it sends no model request.`;
    } catch(error) {
      const small=input.value.length<=MAX_REVIEW_CHARS&&new TextEncoder().encode(input.value).byteLength<=MAX_REVIEW_BYTES;
      preview.textContent=small?input.value:'Input exceeds the preview limit. Shorten it before preparing a checklist.';
      reviewStatus.textContent=error instanceof Error?error.message:'Could not prepare this input. Use a UTF-8 TXT or supported JSON log.';
    }
    controls();
  }
  function appendList(parent:HTMLElement,title:string,items:string[]) {
    const heading=document.createElement('h4');heading.textContent=title;parent.append(heading);
    const list=document.createElement('ul');
    for(const text of items){const item=document.createElement('li');item.textContent=text;list.append(item);}
    parent.append(list);
  }
  function showResult(result:ReturnType<typeof createAuthoredReview>) {
    const heading=document.createElement('h3');heading.textContent='Authored checklist';
    const summary=document.createElement('p');summary.textContent=result.summary;
    output.replaceChildren(heading,summary);
    appendList(output,'Evidence in the supplied log',result.evidence);
    appendList(output,'Gaps and uncertainty',result.gaps);
    const nextHeading=document.createElement('h4');nextHeading.textContent='Practical next steps';output.append(nextHeading);
    const steps=document.createElement('ol');
    for(const step of result.nextSteps){
      const item=document.createElement('li'),title=document.createElement('strong');title.textContent=step.title;item.append(title);
      for(const [label,text] of [['Procedure',step.procedure],['Expected observation',step.expected],['Check',step.check]]){
        const paragraph=document.createElement('p');paragraph.textContent=`${label}: ${text}`;item.append(paragraph);
      }
      steps.append(item);
    }
    output.append(steps);appendList(output,'Instructor checks',result.instructorChecks);output.hidden=false;
  }
  input.addEventListener('input',()=>{origin='paste';sourceLabel.textContent='Pasted or edited text · kept on this page only.';discard('Input changed. Preview it before starting.');});
  format.addEventListener('change',()=>discard('Input format changed. Preview it before starting.'));
  previewButton.addEventListener('click',showPreview);
  useSelection.addEventListener('click',()=>{
    const snapshot=selectedSnapshot();if(!snapshot)return;
    stop();origin='selection';input.value=JSON.stringify(snapshot.entries,null,2);format.value='json';file.value='';
    sourceLabel.textContent=`${owner(snapshot.entries[0]!)} · session ${snapshot.scope.sessionId} · ${snapshot.entries.length} recorded events · frozen snapshot.`;
    showPreview();
  });
  file.addEventListener('change',()=>{
    const chosen=file.files?.[0];if(!chosen)return;
    discard('Reading the selected file…');
    if(!allowed()){reviewStatus.textContent='Instructor access is required.';file.value='';return;}
    if(!/\.(txt|json)$/i.test(chosen.name)){reviewStatus.textContent='Choose a UTF-8 .txt or .json file.';file.value='';return;}
    if(chosen.size>MAX_REVIEW_BYTES){reviewStatus.textContent='The file exceeds 64 KiB. Choose a smaller log; existing input is retained.';file.value='';return;}
    const run=workRevision,currentReader=new FileReader();reader=currentReader;working=true;controls();
    currentReader.onload=()=>{
      if(run!==workRevision||reader!==currentReader||!allowed())return;
      reader=undefined;working=false;
      try {
        if(!(currentReader.result instanceof ArrayBuffer))throw Error('Could not read the selected file.');
        input.value=new TextDecoder('utf-8',{fatal:true}).decode(currentReader.result);origin='file';
        format.value=/\.json$/i.test(chosen.name)?'json':'text';
        sourceLabel.textContent=`Imported ${chosen.name} · kept on this page only.`;showPreview();
      } catch {prepared=null;reviewStatus.textContent='This file could not be decoded as UTF-8 text. Choose a UTF-8 TXT or JSON log.';controls();}
    };
    currentReader.onerror=()=>{if(run===workRevision){reader=undefined;working=false;reviewStatus.textContent='Could not read this file. Existing input is retained.';controls();}};
    currentReader.readAsArrayBuffer(chosen);
  });
  startButton.addEventListener('click',()=>{
    if(!allowed()||!prepared||working)return;
    const snapshot=prepared;stop();const run=workRevision;working=true;output.replaceChildren();output.hidden=true;
    reviewStatus.textContent='Building the authored checklist locally…';controls();
    workTimer=window.setTimeout(()=>{
      if(run!==workRevision||!allowed())return;
      try {showResult(createAuthoredReview(snapshot));reviewStatus.textContent='Authored checklist ready. This is built-in guidance for instructor review, not AI output or a grade.';}
      catch(error){reviewStatus.textContent=error instanceof Error?error.message:'Could not create the authored checklist. Input is retained.';}
      finally{if(run===workRevision){working=false;workTimer=undefined;controls();}}
    },0);
  });
  cancelButton.addEventListener('click',()=>{stop();output.replaceChildren();output.hidden=true;reviewStatus.textContent='Cancelled. Input is retained; no model request was sent.';controls();});
  clearButton.addEventListener('click',()=>clear('Input and authored results cleared.'));
  window.addEventListener('rhoda-access-updated',()=>{
    const next=accessKey();if(next!==account){
      account=next;active?.abort();revision++;busy=false;
      clearRecords('Account access changed. Previous private records were cleared.');
      sessionSelect.replaceChildren(new Option('Account access changed',''));sessionSelect.disabled=true;
      const url=new URL(location.href);url.searchParams.delete('owner_id');url.searchParams.delete('session_id');history.replaceState(null,'',url);
      clear('Account access changed. Input and authored results were cleared.');
      if(allowed())void refresh(true);
    }else controls();
  });
  window.addEventListener('pagehide',()=>{selectedRecords=[];selectedRecordsScope='';clear('Input and authored results cleared when leaving this page.');});
  controls();
  return {clear,syncSelection:controls,getPreviewedLog:()=>allowed()&&!working&&prepared?.text===input.value.trim()?prepared.text:null,recordsUnavailable:()=>{if(origin==='selection')clear('Selected records became unavailable. Input and authored results were cleared.');else controls();}};
}
const authoredReviewUI=installAuthoredReview();
aiReviewUI=installAiReviewUI({request:labFetch,getAccess:getLabAccess,getPreviewedLog:()=>authoredReviewUI?.getPreviewedLog()??null,base:BACKEND});
exportButton.textContent=exportLabel();
function startRefresh(){if(timer===undefined)timer=window.setInterval(()=>{if(!document.hidden)void refresh();},10000);void refresh();}
refreshButton.addEventListener('click',()=>void refresh());exportButton.addEventListener('click',()=>void exportRecords());
window.addEventListener('pagehide',()=>{clearInterval(timer);timer=undefined;active?.abort();revision++;busy=false;});
window.addEventListener('pageshow',startRefresh);startRefresh();
