import './labAccessUI';
import {labFetch} from './authRequest';
import { detectAction } from './commandIntent';
import { offlineAnswer } from './offlineAnswer';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { askGemini, AIRequestError, type ChatTurn } from './genai';
import { getContextForQuery, getServerContextForQuery } from './rag';
// instrument.ts only used by XR avatar — chat routes all instrument calls through Flask backend
import { sessionLogger } from './session';
import { diagnoseTrace, type DiagnoseResult } from './anomaly';
import { getProgress } from './progress';
import {
  startWorkflow, getActiveWorkflow, getCurrentStep,
  advanceStep, getStepIndex, getTotalSteps, stopWorkflow,
  getWorkflowContext, getAvailableWorkflows,
} from './workflows';

import { BACKEND, previewOperations as backendPreviewOperations, confirmOperations, cancelOperations, hasPending, pendingNeedsCancellation, getPendingSummary, operationsFor, type Operation } from './instrumentApi';
import { LAB_DOMAINS, ASSISTANT_MODES, PROMPT_CARDS, labContext, type LabDomain, type AssistantMode } from './labTopics';
import { readPreferences, savePreferences } from './assistantContext';
import { onInstrumentChange } from './instrumentChanges';

// ── DOM ──
const messagesEl = document.getElementById('messages')!;
const inputEl = document.getElementById('input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('send') as HTMLButtonElement;
const confirmBanner = document.getElementById('confirm-bar')!;
const confirmText = document.getElementById('confirm-text')!;
const btnY = document.getElementById('btn-y')!;
const btnN = document.getElementById('btn-n')!;
const scopePanel = document.getElementById('scope-panel')!;
const anomPanel = document.getElementById('anom-panel')!;
const progPanel = document.getElementById('prog-panel')!;
const slogPanel = document.getElementById('slog-panel')!;
const wfStepsEl = document.getElementById('wf-steps')!;
const lblBe = document.getElementById('lbl-be')!;
const dotBe = document.getElementById('dot-be')!;
const lblHw = document.getElementById('lbl-hw')!;
const dotHw = document.getElementById('dot-hw')!;
const btnExport = document.getElementById('btn-export')!;
const btnClear = document.getElementById('btn-clear')!;
const domainEl = document.getElementById('lab-domain') as HTMLSelectElement;
const modeEl = document.getElementById('assistant-mode') as HTMLSelectElement;
const depthEl = document.getElementById('answer-depth') as HTMLSelectElement;
const modelEl = document.getElementById('model-context') as HTMLInputElement;
for (const [id, title] of LAB_DOMAINS) domainEl.add(new Option(title, id));
for (const [id, title] of ASSISTANT_MODES) modeEl.add(new Option(title, id));
const savedPreferences=readPreferences();
domainEl.value=savedPreferences.domain; modeEl.value=savedPreferences.mode; depthEl.value=savedPreferences.depth; modelEl.value=savedPreferences.model;
for (const field of [domainEl,modeEl,depthEl,modelEl]) field.addEventListener('change',()=>savePreferences({domain:domainEl.value as LabDomain,mode:modeEl.value as AssistantMode,model:modelEl.value,depth:depthEl.value}));
function renderSync() {
  const status=sessionLogger.getSyncStatus();
  document.getElementById('session-status')!.textContent = `${status.session_id} · ${status.error || (status.syncing?'saving records…':'local journal ready')}`;
}
window.addEventListener('rhoda-sync-updated',renderSync);
async function refreshAIStatus() {
  const status = document.getElementById('ai-status')!;
  try {
    const data = await fetchJSON(`${BACKEND}/api/ai/status`);
    if(sourceEl.value!=='ai')return;
    status.textContent = data.configured ? `OpenAI · ${data.model} · ready to request` : 'AI unavailable · prompts and guided tasks still work';
  } catch { if(sourceEl.value==='ai')status.textContent = 'AI service unavailable · guided tasks still work'; }
}
async function refreshRagStatus() {
  const status = document.getElementById('rag-status')!;
  try {
    const data = await fetchJSON(`${BACKEND}/api/rag/status`);
    if (data.available !== true) {
      status.textContent = 'Knowledge base: local fallback available · backend retrieval unavailable';
      return;
    }
    const method = data.method === 'semantic' ? 'semantic retrieval' : 'local lexical retrieval';
    const count = typeof data.documents === 'number' ? `${data.documents} documents` : 'document set';
    const version = typeof data.corpus_version === 'string' ? ` · ${data.corpus_version}` : '';
    status.textContent = `Knowledge base: canonical ${method} · ${count}${version}`;
  } catch {
    status.textContent = 'Knowledge base: embedded local fallback · backend unavailable';
  }
}
const sourceEl=document.getElementById('answer-source') as HTMLSelectElement;
function updateSourceStatus(){
  if(sourceEl.value==='local') document.getElementById('ai-status')!.textContent='Local reference mode · no AI calls · source-linked notes, reading plans and excerpts';
  else void refreshAIStatus();
}
sourceEl.addEventListener('change',updateSourceStatus);
updateSourceStatus();
void refreshRagStatus();
window.addEventListener('rhoda-ai-error', event => {
  const code = (event as CustomEvent).detail;
  document.getElementById('ai-status')!.textContent = code === 'quota'
    ? 'AI unavailable · OpenAI API credits / quota exhausted · guided tasks still available'
    : 'AI request failed · see the message below';
});
document.getElementById('toggle-panel')!.addEventListener('click', e => {
  const open = document.body.classList.toggle('show-lab');
  (e.currentTarget as HTMLButtonElement).setAttribute('aria-expanded', String(open));
});

function renderPromptCards() {
  document.getElementById('topic-status')!.textContent = ['general','rtb'].includes(domainEl.value)
    ? 'Device commands use the current RTB adapter and require approval.'
    : 'This topic supports discussion and planning. A dedicated control adapter is not implemented.';
  const search = (document.getElementById('prompt-search') as HTMLInputElement).value.toLowerCase();
  const cards = PROMPT_CARDS.filter(p => (domainEl.value === 'general' || p.domain === domainEl.value) && `${p.title} ${p.prompt}`.toLowerCase().includes(search));
  const container = document.getElementById('prompt-cards')!; container.replaceChildren();
  for (const card of cards) {
    const button = document.createElement('button'); button.type='button'; button.dataset.prompt=card.id;
    button.textContent = card.title;
    const hint = document.createElement('small'); hint.textContent = LAB_DOMAINS.find(d=>d[0]===card.domain)![1]; button.append(hint);
    button.onclick = () => { inputEl.value=card.prompt; updateComposer(); closePrompts(true); };
    container.append(button);
  }
  document.getElementById('prompt-count')!.textContent = `${cards.length} prompts shown · ${PROMPT_CARDS.length} total`;
}
document.getElementById('prompt-search')!.addEventListener('input',renderPromptCards);
domainEl.addEventListener('change',renderPromptCards);
renderPromptCards();
const guides = getAvailableWorkflows();
const guidePicker = document.getElementById('guide-picker') as HTMLSelectElement;
for (const guide of guides) {
  guidePicker.add(new Option(guide.title,guide.id));
  const button=document.createElement('button'); button.className='wf-btn'; button.dataset.wf=guide.id; button.textContent=guide.title;
  document.getElementById('workflow-list')!.append(button);
}

async function previewOperations(operations: Operation[]) {
  if (!['general','rtb'].includes(domainEl.value)) throw new Error('This topic supports guidance only. Select RTB / oscilloscope practice for the current control adapter; no command was sent.');
  return backendPreviewOperations(operations);
}

// ── State ──
const history: ChatTurn[] = [];
const anomalies: DiagnoseResult[] = [];
let backendOnline = false;
let instrumentMode = 'offline';
let lastScopeState: Record<string, any> | null = null;
let pendingConfirmationId: string | null = null;
let pendingConfirmationSessionId: string | null = null;
let pendingCancellationOnly=false;
let displayedSessionId = sessionLogger.getSessionId();
let scopeReadRequest=0, lastScopeReadAt='';
let pendingConfirmationPath: string | null = null;
let pendingConfirmationValue: any = null;

const welcomeEl = document.getElementById('welcome')!;
const jumpLatest = document.getElementById('jump-latest') as HTMLButtonElement;
function updateWelcome() { welcomeEl.hidden = !!messagesEl.querySelector('.msg-user,.msg-assistant'); }
function updateComposer() {
  inputEl.value=inputEl.value.slice(0,12000);
  inputEl.style.height = 'auto';
  inputEl.style.height = `${Math.min(180, Math.max(60, inputEl.scrollHeight))}px`;
  try { localStorage.setItem('rhoda-chat-draft', inputEl.value); } catch {}
  document.getElementById('draft-status')!.textContent = inputEl.value ? `${inputEl.value.length.toLocaleString()} / 12,000` : '';
}
try { inputEl.value = (localStorage.getItem('rhoda-chat-draft') || '').slice(0,12000); } catch {}
inputEl.addEventListener('input', updateComposer);
updateComposer();
function summarizeSettings() {
  document.getElementById('settings-summary')!.textContent = `${domainEl.selectedOptions[0]?.text} · ${modeEl.selectedOptions[0]?.text} · ${depthEl.selectedOptions[0]?.text}`;
}
for (const field of [domainEl, modeEl, depthEl]) field.addEventListener('change', summarizeSettings);
summarizeSettings();
document.querySelectorAll<HTMLButtonElement>('[data-starter]').forEach(button => {
  button.onclick = () => { inputEl.value = button.dataset.starter!; updateComposer(); inputEl.focus(); };
});
messagesEl.addEventListener('scroll', () => { jumpLatest.hidden = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 100; });
jumpLatest.onclick = () => { messagesEl.scrollTop = messagesEl.scrollHeight; jumpLatest.hidden = true; };

const promptLibrary=document.getElementById('prompt-library') as HTMLDetailsElement;
const promptDialog=document.getElementById('prompt-dialog') as HTMLDialogElement;
promptLibrary.addEventListener('toggle',()=>{
  if(promptLibrary.open&&!promptDialog.open){promptDialog.showModal();(document.getElementById('prompt-search') as HTMLInputElement).focus();}
  else if(!promptLibrary.open&&promptDialog.open)promptDialog.close();
});
promptDialog.addEventListener('close',()=>{promptLibrary.open=false;});
function closePrompts(focusComposer=false){promptLibrary.open=false;promptDialog.close();if(focusComposer)inputEl.focus();}
document.getElementById('close-prompts')!.onclick=()=>closePrompts();
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    document.body.classList.remove('show-lab');
    document.getElementById('toggle-panel')!.setAttribute('aria-expanded','false');
    (document.getElementById('prompt-library') as HTMLDetailsElement).open = false;
  }
});

// ── Helpers ──
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function now(): string {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function addMsg(role: 'user' | 'assistant' | 'system' | 'tool', text: string, tags?: string[]) {
  const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 100;
  const div = document.createElement('div');
  div.className = `msg msg-${role}`;
  const rl = role === 'user' ? 'YOU' : role === 'assistant' ? 'RHODA' : role === 'tool' ? 'INSTR' : 'SYS';
  const tagHtml = (tags || []).map(t => {
    const c = t === 'READ' ? 'tag-read' : t === 'WRITE' ? 'tag-write' : t === 'anomaly' ? 'tag-anomaly' : t === 'rag' ? 'tag-rag' : 'tag-wf';
    return `<span class="tag ${c}">${esc(t)}</span>`;
  }).join('');
  const body = role === 'assistant' ? DOMPurify.sanitize(marked.parse(text, {async: false}) as string) : esc(text);
  div.innerHTML = `<div class="msg-h"><span class="ts">${now()}</span><span class="role role-${role}">${rl}</span>${tagHtml}</div><div class="msg-body">${body}</div>`;
  if (role === 'assistant') {
    const copy = document.createElement('button'); copy.className = 'copy-reply'; copy.textContent = 'Copy';
    copy.setAttribute('aria-label', 'Copy response');
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied'; }
      catch { copy.textContent = 'Copy unavailable'; }
      setTimeout(() => { copy.textContent = 'Copy'; }, 2000);
    };
    div.querySelector('.msg-h')!.append(copy);
  }
  messagesEl.appendChild(div);
  updateWelcome();
  if (nearBottom || role === 'user') messagesEl.scrollTop = messagesEl.scrollHeight;
  else jumpLatest.hidden = false;
}

// ── Backend communication ──
async function fetchJSON(url: string, opts?: RequestInit): Promise<any> {
  const r = await labFetch(url, { ...opts, signal: AbortSignal.timeout(5000) });
  if (!r.ok) {const data=await r.json().catch(()=>null);throw new Error(data?.error||`${r.status} ${r.statusText}`);}
  return r.json();
}

async function probeBackend() {
  try {
    const data = await fetchJSON(`${BACKEND}/api/health`);
    if(data?.status!=='ok'||typeof data.instrument!=='string')throw Error('Unrecognized backend health response');
    backendOnline = true;
    instrumentMode = data.instrument;
    dotBe.className = 'dot dot-on';
    lblBe.textContent = 'backend: online';
    if (instrumentMode === 'mock' || instrumentMode === 'driver-simulation') {
      dotHw.className = 'dot dot-warn';
      lblHw.textContent = 'instrument: simulator';
    } else if (instrumentMode === 'unavailable') {
      dotHw.className = 'dot dot-err';
      lblHw.textContent = 'instrument: unavailable';
    } else {
      dotHw.className = 'dot dot-on';
      lblHw.textContent = `instrument: ${instrumentMode}`;
    }
  } catch {
    backendOnline = false;
    instrumentMode = 'offline';
    dotBe.className = 'dot dot-err';
    lblBe.textContent = 'backend: offline';
    dotHw.className = 'dot dot-off';
    lblHw.textContent = 'instrument: not available';
  }
}

async function fetchScopeState() {
  const token=++scopeReadRequest;
  if (!backendOnline) {
    lastScopeState = null;
    return;
  }
  try {
    const data = await fetchJSON(`${BACKEND}/api/instrument/state?scope=all`);
    if(token!==scopeReadRequest)return;
    if (data.ok&&data.result&&typeof data.result==='object'&&!Array.isArray(data.result)) {lastScopeState = data.result;lastScopeReadAt=new Date().toLocaleTimeString();}
    else lastScopeState = null;
  } catch {
    if(token!==scopeReadRequest)return;
    lastScopeState = null;
    await probeBackend();
  }
}

async function sendInstrumentSet(path: string, value: unknown, _confirmed = false) {
  return previewOperations([{ path, value }]);
}
async function sendInstrumentConfirm(_path: string, _value: unknown, _id: string) {
  return confirmOperations();
}
async function sendMeasurement(type: string, source = 'CH1') {
  return previewOperations([{ measurementType: type, source }]);
}

function showPreview(data: any, sessionId=sessionLogger.getSessionId()) {
  pendingConfirmationId = data.confirmationId;
  pendingConfirmationSessionId=sessionId;
  pendingCancellationOnly=false;
  showConfirm(sessionId===sessionLogger.getSessionId()?`${data.summary} — confirm?`:'This preview belongs to the previous session. Cancel it before preparing a new operation.');
  (btnY as HTMLButtonElement).disabled=sessionId!==sessionLogger.getSessionId()||sendBtn.disabled;
  if(sessionId===displayedSessionId)addMsg('tool', `preview: ${data.summary}`, ['WRITE']);
}

// ── Render panels ──
function renderScope() {
  if (!backendOnline) {
    scopePanel.innerHTML = '<div class="scope-disconnected">backend offline — start server with: python server/app.py</div>';
    return;
  }
  if (!lastScopeState) {
    scopePanel.innerHTML = '<div class="scope-disconnected">Readback unavailable. Refresh the connection before interpreting settings.</div>';
    return;
  }
  const s = lastScopeState;
  const rows: string[] = [];

  function row(k: string, v: unknown, cls = '') {
    rows.push(`<span class="k">${k}</span><span class="v ${cls}">${esc(String(v))}</span>`);
  }

  if (s.instrument_id) row('id', String(s.instrument_id).substring(0, 30));
  if (s.acquisition_state) row('acq', s.acquisition_state);
  if (s.timebase_scale != null) row('timebase', fmtTime(s.timebase_scale) + '/div');

  const channels = s.channels || {};
  for (const ch of [1, 2, 3, 4]) {
    const c = channels[ch] || channels[String(ch)];
    if (!c) continue;
    const en = c.enabled === true || c.enabled === 'ON' || c.enabled === '1';
    if (!en && ch > 2) continue;
    row(`CH${ch}`, en ? 'ON' : 'OFF', en ? 'v-on' : 'v-off');
    if (en) {
      row(`CH${ch} scale`, (c.vertical_scale ?? c.scale ?? '?') + ' V/div');
      if (c.coupling) row(`CH${ch} coup`, c.coupling);
    }
  }

  const trig = s.trigger || {};
  if (trig.source) row('trig src', trig.source);
  if (trig.level != null) row('trig lvl', trig.level + ' V');
  if (trig.mode) row('trig mode', trig.mode);
  if (trig.edge) row('trig edge', trig.edge);

  scopePanel.innerHTML = `<p class="scope-disconnected">Readback received ${esc(lastScopeReadAt)} · refresh after an external change.</p><div class="sg">${rows.join('')}</div>`;
}

function fmtTime(s: number): string {
  if (s >= 1) return s + ' s';
  if (s >= 0.001) return (s * 1000).toFixed(2) + ' ms';
  if (s >= 0.000001) return (s * 1000000).toFixed(1) + ' µs';
  return (s * 1000000000).toFixed(1) + ' ns';
}

function renderAnomalies() {
  if (anomalies.length === 0) { anomPanel.innerHTML = '<div style="font-size:10px;color:var(--dim)">none</div>'; return; }
  anomPanel.innerHTML = anomalies.slice(-5).reverse().map(a => `
    <div class="anom">
      ${a.unsafe_flag ? '<div class="anom-unsafe">⚠ SAFETY FLAG</div>' : ''}
      <div class="anom-cause">${esc(a.probable_cause)}</div>
      <div class="anom-meta">${(a.confidence * 100).toFixed(0)}% · ${a.fix_steps.length} steps</div>
    </div>`).join('');
}

function renderProgress() {
  const p = getProgress();
  const entries = Object.entries(p.topic_scores);
  if (entries.length === 0) { progPanel.innerHTML = '<div style="font-size:10px;color:var(--dim)">ask questions to build progress</div>'; return; }
  progPanel.innerHTML = '<p style="font-size:10px;color:var(--dim);line-height:1.6">Conversation activity only. Asking questions and receiving replies do not assess understanding or lab competency.</p>'+entries.map(([n, s]) => `<div class="pr"><div class="pr-l"><span>${esc(n)}</span><span>${s}%</span></div><div class="pr-b"><div class="pr-f" style="width:${Math.min(s as number, 100)}%"></div></div></div>`).join('')
    + `<div style="font-size:9px;color:var(--dim);margin-top:4px">next → ${esc(p.recommended_next_topic)}</div>`;
}

function renderSessionLog() {
  const logs = sessionLogger.getSessionLogs().slice(-40);
  if (logs.length === 0) { slogPanel.innerHTML = '<div style="font-size:9px;color:var(--dim)">empty</div>'; return; }
  slogPanel.innerHTML = logs.map(l => {
    const t = l.timestamp.substring(11, 19);
    const r = l.role[0].toUpperCase();
    const content = l.tool_call ? `${l.tool_call.category} ${l.tool_call.name}` : l.content.substring(0, 50);
    return `<div class="sl"><span class="sl-ts">${t}</span><span class="sl-r sl-r-${r}">${r}</span><span class="sl-c">${esc(content)}</span></div>`;
  }).join('');
  slogPanel.scrollTop = slogPanel.scrollHeight;
}

function renderWorkflow() {
  const wf = getActiveWorkflow();
  if (!wf) { wfStepsEl.innerHTML = ''; return; }
  const idx = getStepIndex();
  wfStepsEl.innerHTML = `<div style="font-size:10px;color:var(--cyan);margin:4px 0 2px">${esc(wf.title)} [${idx + 1}/${getTotalSteps()}]</div>`
    + wf.steps.map((s, i) => {
      const nc = i === idx ? 'act' : '';
      const tc = i < idx ? 'done' : i === idx ? 'act' : '';
      return `<div class="ws"><span class="ws-n ${nc}">${s.id}</span><span class="ws-t ${tc}">${esc(s.instruction)}</span></div>`;
    }).join('');
}

async function refreshAll() {
  await fetchScopeState();
  renderScope();
  renderAnomalies();
  renderProgress();
  renderSessionLog();
  renderWorkflow();
}
let connectionRefresh:Promise<void>|null=null;
const refreshConnectionButton=document.getElementById('refresh-connection') as HTMLButtonElement;
function refreshConnection():Promise<void> {
 if(connectionRefresh)return connectionRefresh;
 refreshConnectionButton.disabled=true;
 connectionRefresh=(async()=>{await probeBackend();await refreshAll();if(sourceEl.value==='ai')await refreshAIStatus();})().finally(()=>{connectionRefresh=null;refreshConnectionButton.disabled=false;});
 return connectionRefresh;
}
refreshConnectionButton.onclick=()=>void refreshConnection();
window.addEventListener('online',()=>void refreshConnection());
window.addEventListener('focus',()=>{if(!document.hidden)void refreshConnection();});
onInstrumentChange(()=>{++scopeReadRequest;lastScopeState=null;renderScope();if(!document.hidden)void (backendOnline?refreshAll():refreshConnection());});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshConnection();});
function retainUncancelledPreview(sessionId:string) {
 if(!hasPending()){hideConfirm();pendingConfirmationId=null;pendingConfirmationSessionId=null;pendingCancellationOnly=false;return;}
 pendingConfirmationId||='uncancelled-preview';pendingConfirmationSessionId=sessionId;
 pendingCancellationOnly=true;
 showConfirm('An unapproved preview still needs cancellation. '+getPendingSummary());
 (btnY as HTMLButtonElement).disabled=true;
}

function setRequestBusy(busy:boolean,message='RHODA is working…'){
  sendBtn.disabled=busy;
  for(const button of [btnClear,btnY,btnN])(button as HTMLButtonElement).disabled=busy;
  (btnY as HTMLButtonElement).disabled=busy||pendingCancellationOnly||pendingNeedsCancellation()||Boolean(pendingConfirmationSessionId&&pendingConfirmationSessionId!==sessionLogger.getSessionId());
  messagesEl.setAttribute('aria-busy',String(busy));
  document.getElementById('reply-status')!.textContent=busy?message:'';
}

// ── Instrument action detection ──
// ── Send ──
async function handleSend() {
  const requestSession=sessionLogger.getSessionId();
  const reply=(role:'user'|'assistant'|'system'|'tool',text:string,tags?:string[])=>{if(requestSession===displayedSessionId)addMsg(role,text,tags);};
  const text = inputEl.value.trim();
  if (!text || sendBtn.disabled) return;
  inputEl.value = '';
  updateComposer();
  setRequestBusy(true);

  reply('user', text);
  sessionLogger.logUserInput(text,undefined,requestSession);

  try {
    const lower = text.toLowerCase();
    if(!backendOnline&&(detectAction(text)||/^(measure|read) (frequency|period|rms|peak.to.peak)/i.test(text)))await refreshConnection();
    if(requestSession!==sessionLogger.getSessionId())return;

    // Pending confirmation response
    if (pendingConfirmationId) {
      if (/^(yes|confirm|proceed|go ahead|allow|okay|ok|do it)[.!]?$/i.test(lower)) {
        if(pendingCancellationOnly||pendingNeedsCancellation()||pendingConfirmationSessionId!==requestSession)throw Error('This earlier preview must be cancelled. Prepare a fresh preview in the current session.');
        const data = await sendInstrumentConfirm(pendingConfirmationPath!, pendingConfirmationValue, pendingConfirmationId);
        hideConfirm();
        reply('tool', `confirmed → ${JSON.stringify(data.result)}`, ['WRITE']);

        pendingConfirmationId = null;
        await refreshAll();
        sendBtn.disabled = false;
        return;
      }
      if (/^(no|cancel|deny|stop|don't)[.!]?$/i.test(lower)) {
        await cancelOperations();
        hideConfirm();
        reply('system', 'action denied');
        pendingConfirmationId = null;
        sendBtn.disabled = false;
        return;
      }
      reply('system', 'Please approve or cancel the pending operation first.');
      sendBtn.disabled = false;
      return;
    }

    if (/^(stop|cancel) workflow[.!]?$/.test(lower)) { stopWorkflow(); reply('system', 'Guided task stopped.'); await refreshAll(); sendBtn.disabled = false; return; }

    // Workflow step
    if (/^(next step|continue|done|move on|proceed)[.!]?$/.test(lower) && getActiveWorkflow()) {
      const step = advanceStep();
      if (step) {
        let msg = `[step ${step.id}/${getTotalSteps()}] ${step.instruction}\n${step.detail}`;
        if (step.safetyCheck) msg += `\n⚠️ ${step.safetyCheck}`;
        reply('assistant', msg, ['workflow']);
        sessionLogger.logAssistantResponse(msg,undefined,requestSession);
        if(requestSession===displayedSessionId)history.push({ role: 'user', content: text }, { role: 'model', content: msg });

        if (step.instrumentAction && backendOnline) {
          try {
            showPreview(await previewOperations(operationsFor(step.instrumentAction.name, step.instrumentAction.params)),requestSession);
          } catch (e) {
            reply('system', `instrument error: ${(e as Error).message}`);
          }
        }
      } else {
        reply('system', 'workflow complete', ['workflow']);
      }
      await refreshAll();
      sendBtn.disabled = false;
      return;
    }

    // Workflow start
    if (/walk me through|guide me|help me measure|start workflow/.test(lower)) {
      let wfId: string | null = null;
      if (/sine|1.?khz/.test(lower)) wfId = 'measure-1khz-sine';
      if (/safety|overvoltage|overload|danger/.test(lower)) wfId = 'safety-overvoltage';
      if (wfId) {
        const wf = startWorkflow(wfId);
        if (wf) {
          const step = getCurrentStep()!;
          let msg = `workflow: ${wf.title}\n\n[step 1/${getTotalSteps()}] ${step.instruction}\n${step.detail}`;
          if (step.safetyCheck) msg += `\n⚠️ ${step.safetyCheck}`;
          reply('assistant', msg, ['workflow']);
          sessionLogger.logAssistantResponse(msg,undefined,requestSession);
          if(requestSession===displayedSessionId)history.push({ role: 'user', content: text }, { role: 'model', content: msg });
          await refreshAll();
          sendBtn.disabled = false;
          return;
        }
      }
    }

    if (/^(measure|read) (frequency|period|rms|peak.to.peak)(?: on ch[1-4])?[.!]?$/i.test(text)) {
      const match = text.match(/^(?:measure|read) (frequency|period|rms|peak.to.peak)(?: on (ch[1-4]))?/i)!;
      const type = match[1].toLowerCase().replace(/peak.to.peak/, 'peak_to_peak');
      showPreview(await sendMeasurement(type, match[2]?.toUpperCase()),requestSession);
      sendBtn.disabled = false;
      return;
    }

    // Direct instrument command (user types "set timebase to 1ms")
    const directAction = detectAction(text);
    if(directAction&&!backendOnline)throw Error('The instrument backend is unavailable. Use Refresh connection, then retry this command. No setting was sent.');
    if (directAction && backendOnline) {
      try {
        const data = await sendInstrumentSet(directAction.path, directAction.value, false);
        if (data.needsConfirmation) {
          pendingConfirmationId = data.confirmationId;
          pendingConfirmationSessionId=requestSession;
          pendingCancellationOnly=false;
          pendingConfirmationPath = directAction.path;
          pendingConfirmationValue = directAction.value;
          showConfirm(requestSession===displayedSessionId?`${data.summary} — confirm?`:'This preview belongs to the previous session. Cancel it before preparing a new operation.');
          reply('tool', `preview: ${data.summary}`, ['WRITE']);
          sessionLogger.logToolCall('set_parameter', directAction, 'WRITE',undefined,undefined,requestSession);
        } else if (data.ok) {
          reply('tool', `set ${directAction.path} = ${directAction.value}`, ['WRITE']);
        }
        await refreshAll();
        sendBtn.disabled = false;
        return; // The preview is the complete response; do not overwrite it with an AI suggestion.
      } catch (e) {
        reply('system', `instrument error: ${(e as Error).message}`);
        sendBtn.disabled = false;
        return;
      }
    }

    // Anomaly detection
    if ((document.getElementById('answer-source') as HTMLSelectElement).value === 'ai' && /noise|noisy|clip|clipped|unstable|drift|alias|wrong|broken|fault|problem|issue|diagnos|overvoltage|overload/.test(lower)) {
      const diag = await diagnoseTrace({ description: text });
      if(requestSession===displayedSessionId)anomalies.push(diag);
      let msg = diag.probable_cause;
      if (diag.unsafe_flag) msg = '⚠️ SAFETY: ' + msg;
      msg += '\n\nfix steps:';
      diag.fix_steps.forEach((s, i) => { msg += `\n  ${i + 1}. ${s}`; });
      msg += `\n\nconfidence: ${(diag.confidence * 100).toFixed(0)}%`;
      reply('assistant', msg, ['anomaly']);
      sessionLogger.logAssistantResponse(msg, 'troubleshooting',requestSession);
      if(requestSession===displayedSessionId)history.push({ role: 'user', content: text }, { role: 'model', content: msg });
      await refreshAll();
      sendBtn.disabled = false;
      return;
    }

    if ((document.getElementById('answer-source') as HTMLSelectElement).value === 'local') {
      const response = await offlineAnswer(text);
      reply('assistant', response, ['local sources']);
      sessionLogger.logAssistantResponse(response,undefined,requestSession);
      await refreshAll();
      return;
    }
    // Project reference context + server-side AI
    const ragCtx = (await getServerContextForQuery(text)) || getContextForQuery(text);
    if (ragCtx) reply('system', `${ragCtx.split('---').length} context chunks retrieved`, ['rag']);

    const scopeStr = lastScopeState ? JSON.stringify(lastScopeState, null, 1) : 'instrument not connected';
    const wfCtx = getWorkflowContext() || undefined;
    const assistance = labContext(domainEl.value as LabDomain, modeEl.value as AssistantMode, modelEl.value, depthEl.value);
    let response: string;
    try {
      response = await askGemini(text, ragCtx, scopeStr, sessionLogger.getConversationHistory(text,requestSession), wfCtx, assistance);
    } catch (error) {
      if (!(error instanceof AIRequestError) || error.code !== 'not_configured') throw error;
      response = await offlineAnswer(text);
      reply('system', 'Online AI is not configured; answered with local RHODA resources instead.', ['offline fallback']);
    }

    reply('assistant', response);
    sessionLogger.logAssistantResponse(response,undefined,requestSession);
    if(requestSession===displayedSessionId)history.push({ role: 'user', content: text }, { role: 'model', content: response });
    if (history.length > 40) history.splice(0, history.length - 40);

    // AI prose is guidance; device changes use explicit validated commands and approval.
    await refreshAll();
  } catch (err) {
    hideConfirm();
    pendingConfirmationId = null;
    await cancelOperations().catch(() => undefined);
    retainUncancelledPreview(requestSession);
    reply('system', `Unable to complete the request: ${(err as Error).message}`);
    if (requestSession===displayedSessionId&&!inputEl.value) inputEl.value = text;
    updateComposer();
  } finally {
    setRequestBusy(false);
  }
  inputEl.focus();
}


function showConfirm(t: string) { confirmText.textContent = t; confirmBanner.classList.add('active'); }
function hideConfirm() { confirmBanner.classList.remove('active'); }

// ── Events ──
sendBtn.addEventListener('click', handleSend);
inputEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); handleSend(); } });

btnY.addEventListener('click', async () => {
  if (!pendingConfirmationId||sendBtn.disabled||pendingCancellationOnly||pendingNeedsCancellation()||pendingConfirmationSessionId!==sessionLogger.getSessionId()) return;
  const requestSession=sessionLogger.getSessionId();
  setRequestBusy(true,'Applying the approved operation…');
  try {
    const data = await sendInstrumentConfirm(pendingConfirmationPath!, pendingConfirmationValue, pendingConfirmationId);
    hideConfirm();
    if(requestSession===displayedSessionId)addMsg('tool', `confirmed → ${JSON.stringify(data.result)}`, ['WRITE']);

    pendingConfirmationId = null;
    await refreshAll();
  } catch (e) {
    hideConfirm();
    pendingConfirmationId = null;
    retainUncancelledPreview(requestSession);
    if(requestSession===displayedSessionId)addMsg('system', `confirm failed: ${(e as Error).message}`);
  } finally {setRequestBusy(false);inputEl.focus();}
});

btnN.addEventListener('click', async () => { if(sendBtn.disabled||!pendingConfirmationId)return;const requestSession=sessionLogger.getSessionId();setRequestBusy(true,'Cancelling the pending operation…');try { await cancelOperations(); hideConfirm(); pendingConfirmationId = null; pendingConfirmationSessionId=null;pendingCancellationOnly=false;if(requestSession===displayedSessionId)addMsg('system', 'action denied'); } catch(e) { retainUncancelledPreview(pendingConfirmationSessionId||requestSession);if(requestSession===displayedSessionId)addMsg('system', (e as Error).message); } finally{setRequestBusy(false);inputEl.focus();} });

btnExport.addEventListener('click', () => {
  const blob = new Blob([sessionLogger.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rhoda-${sessionLogger.getSessionId()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

btnClear.addEventListener('click', async () => {
  if(sendBtn.disabled)return;
  setRequestBusy(true,'Starting a new session…');
  try { await cancelOperations(); } catch(e) { addMsg('system', (e as Error).message);setRequestBusy(false);return; }
  try {await sessionLogger.startNewSession();}catch(error){addMsg('system',(error as Error).message);setRequestBusy(false);return;}
  history.length = 0;
  anomalies.length = 0;
  stopWorkflow();
  pendingConfirmationId = null;
  messagesEl.innerHTML = '';
  inputEl.value = ''; updateComposer(); updateWelcome(); jumpLatest.hidden = true;
  hideConfirm();
  await refreshAll();
  addMsg('system', `session started: ${sessionLogger.getSessionId()}`);
  setRequestBusy(false);inputEl.focus();
});

document.getElementById('start-guide')!.addEventListener('click', () => {
  (document.querySelector(`[data-wf="${guidePicker.value}"]`) as HTMLButtonElement)?.click();
  closePrompts(true);
});

document.querySelectorAll('.wf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = (btn as HTMLElement).dataset.wf;
    if (!id) return;
    if (sendBtn.disabled) { addMsg('system', 'Wait for the current response before starting a guided task.'); return; }
    if (pendingConfirmationId) { addMsg('system', 'Approve or cancel the pending operation first.'); return; }
    const wf = startWorkflow(id);
    if (!wf) return;
    const step = getCurrentStep()!;
    let msg = `workflow: ${wf.title}\n\n[step 1/${getTotalSteps()}] ${step.instruction}\n${step.detail}`;
    if (step.safetyCheck) msg += `\n⚠️ ${step.safetyCheck}`;
    addMsg('assistant', msg, ['workflow']);
    sessionLogger.logAssistantResponse(msg);
    refreshAll();
  });
});

document.querySelectorAll('.psec h3').forEach((heading,index) => {
  const section=heading.parentElement!, content=section.querySelector<HTMLElement>('.pc');
  if(!content)return;
  if(!content.id)content.id=`lab-section-${index}`;
  const button=document.createElement('button');button.type='button';button.className='panel-section-toggle';button.textContent=heading.textContent;
  button.setAttribute('aria-controls',content.id);button.setAttribute('aria-expanded',String(!section.classList.contains('collapsed')));
  button.onclick=()=>button.setAttribute('aria-expanded',String(!section.classList.toggle('collapsed')));
  heading.replaceChildren(button);
});

function restoreConversation(notify=false) {
  messagesEl.replaceChildren();history.length=0;anomalies.length=0;updateWelcome();jumpLatest.hidden=true;
  const prev = sessionLogger.getSessionLogs(displayedSessionId);
  for (const l of prev) {
    if (l.role === 'user') addMsg('user', l.content);
    else if (l.role === 'assistant') {
      const tags: string[] = [];
      if (l.topic === 'troubleshooting') tags.push('anomaly');
      addMsg('assistant', l.content, tags);
    } else if (l.role === 'tool' && l.tool_call) {
      addMsg('tool', `${l.tool_call.category} ${l.tool_call.name}`, [l.tool_call.category]);
    }
  }
  if (prev.length > 0) {
    addMsg('system', `restored ${prev.length} events from previous session`);
    for (const l of prev) {
      if (l.role === 'user') history.push({ role: 'user', content: l.content });
      if (l.role === 'assistant') history.push({ role: 'model', content: l.content });
    }
    if (history.length > 40) history.splice(0, history.length - 40);
  }

  if(notify)addMsg('system','The active session changed in another workspace. This view now shows its matching conversation.');
}
window.addEventListener('rhoda-session-updated',()=>{
 const next=sessionLogger.getSessionId();if(next===displayedSessionId)return;
 displayedSessionId=next;stopWorkflow();restoreConversation(true);renderSync();renderAnomalies();renderWorkflow();
 if(sendBtn.disabled)document.getElementById('reply-status')!.textContent='Finishing a request from the previous session. Its response will stay in that session’s journal.';
 if(hasPending()){pendingConfirmationId||='previous-session-preview';pendingCancellationOnly=true;showConfirm('An earlier session has an unapproved preview. Cancel it before preparing another operation.');(btnY as HTMLButtonElement).disabled=true;}
 else{hideConfirm();pendingConfirmationId=null;pendingConfirmationSessionId=null;pendingCancellationOnly=false;}
});
window.addEventListener('rhoda-access-updated',()=>{
  // Initial access discovery may retain the same anonymous session identifier.
  // Its history was intentionally hidden until the backend identified the mode.
  if(!sendBtn.disabled&&sessionLogger.getSessionId()===displayedSessionId){restoreConversation();renderSync();renderAnomalies();renderWorkflow();}
});

// ── Init ──
(async () => {
  renderSync();
  restoreConversation();
  await refreshConnection();

  if (!backendOnline) {
    addMsg('system', 'backend offline — start with: python server/app.py');
  } else {
    addMsg('system', `connected to backend (${instrumentMode})`);
  }
  inputEl.focus();
})();
