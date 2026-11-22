import { BACKEND } from './runtimeConfig';
import {labFetch} from './authRequest';
import {getLabAccess,ensureLabAccess,labAccess} from './labAccess';
/**
 * Conversation Logging (Core 4c)
 * Append-only session log. Every turn, tool call, and confirmation event is recorded.
 * Storage: local browser outbox and local backend journal. Free text may contain personal data.
 *
 * Contract:
 *   LOG_EVENT { session_id, turn_id, role, content, tool_call?, confirmed?, timestamp }
 *   → { ack: true }
 */

export interface LogEvent {
  event_id?: string;
  surface?: string;
  session_id: string;
  turn_id: number;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_call?: {
    name: string;
    params: Record<string, unknown>;
    category: 'READ' | 'WRITE';
    result?: unknown;
  };
  confirmed?: boolean;
  topic?: string;
  timestamp: string;
}

export interface SessionSummary {
  session_id: string;
  start_time: string;
  turn_count: number;
  topics_covered: string[];
  tool_calls_made: number;
  confirmations_requested: number;
}

const ACTIVE_KEY = 'rhoda_active_session_v2';
const EVENT_PREFIX = 'rhoda_event_v2_';
const ACK_PREFIX = 'rhoda_ack_v2_';
const OWNER_PREFIX = 'rhoda_session_principal_v1_';
const ANONYMOUS_KEY = 'rhoda_anonymous_session_v3';
const validSession = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function validStoredEvent(event: any): event is LogEvent & {event_id:string} {
  return !!event && validSession(event.session_id) && typeof event.event_id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(event.event_id)
    && ['user','assistant','system','tool'].includes(event.role) && typeof event.content === 'string'
    && event.content.length <= 20000 && typeof event.timestamp === 'string' && Number.isFinite(Date.parse(event.timestamp));
}
function uniqueId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), x=>x.toString(16).padStart(2,'0')).join('');
}

class SessionLogger {
  private logs = new Map<string, LogEvent>();
  private sessionId = `session_${uniqueId()}`;
  private syncing = false;
  private resync = false;
  private syncError: string | null = null;
  private owners = new Map<string,string>();
  private principal='anonymous';
  private anonymousSession=this.sessionId;

  constructor() {
    try {
      const storedSession = localStorage.getItem(ANONYMOUS_KEY)||localStorage.getItem(ACTIVE_KEY);
      if (validSession(storedSession)&&!localStorage.getItem(OWNER_PREFIX+storedSession)) this.sessionId = storedSession;
      else if(validSession(storedSession)&&localStorage.getItem(OWNER_PREFIX+storedSession)==='anonymous')this.sessionId=storedSession;
      this.anonymousSession=this.sessionId;
      // Preserve earlier records without claiming they belong to the new session.
      const old = JSON.parse(localStorage.getItem('rhoda_session_logs') || '[]');
      if (Array.isArray(old)) for (const item of old) {
        if (!item?.session_id || typeof item.content !== 'string') continue;
        const id = item.event_id || `legacy_${item.session_id}_${item.turn_id}`;
        if (!localStorage.getItem(EVENT_PREFIX + id)) localStorage.setItem(EVENT_PREFIX + id, JSON.stringify({...item,event_id:id}));
      }
    } catch { this.syncError = 'Browser storage unavailable; records remain in memory until this page closes.'; }
    window.addEventListener('online', () => void this.flush());
    window.addEventListener('storage', () => { this.restore(); window.dispatchEvent(new Event('rhoda-session-updated')); });
    window.addEventListener('rhoda-access-updated',()=>{this.applyAccess();void this.flush();});
    setInterval(() => void this.flush(), 15000);
    this.restore();this.applyAccess();void this.flush();
  }

  private owner(id:string){
    if(this.owners.has(id))return this.owners.get(id)!;
    try{const owner=localStorage.getItem(OWNER_PREFIX+id);if(owner){this.owners.set(id,owner);return owner;}}catch{}
    return 'anonymous';
  }
  private setOwner(id:string,owner:string){this.owners.set(id,owner);try{localStorage.setItem(OWNER_PREFIX+id,owner);}catch{}}
  private applyAccess(){
    const access=getLabAccess();if(!access)return;
    const old=this.sessionId,oldPrincipal=this.principal;
    this.principal=access.enabled?(access.authenticated?`account:${access.user!.username}`:'signed-out'):'anonymous';
    if(access.enabled){
      if(access.authenticated&&access.sessionId){this.sessionId=access.sessionId;this.setOwner(this.sessionId,this.principal);}
      else if(oldPrincipal!=='signed-out')this.sessionId=`signedout_${uniqueId()}`;
    }else{
      this.sessionId=this.anonymousSession;
      try{const stored=localStorage.getItem(ACTIVE_KEY);if(validSession(stored)&&this.owner(stored)==='anonymous')this.sessionId=stored;}catch{}
      this.anonymousSession=this.sessionId;this.setOwner(this.sessionId,'anonymous');
      try{localStorage.setItem(ANONYMOUS_KEY,this.sessionId);}catch{}
    }
    if(!access.enabled||access.authenticated)try{localStorage.setItem(ACTIVE_KEY,this.sessionId);}catch{}
    if(old!==this.sessionId||oldPrincipal!==this.principal)window.dispatchEvent(new Event('rhoda-session-updated'));
  }

  getSessionId(): string {
    const access=getLabAccess();
    if(access?.enabled&&!access.authenticated)return this.sessionId;
    // Shared-lab session IDs come from the server, never another tab's local pointer.
    if(access?.enabled&&access.authenticated&&access.sessionId)return access.sessionId;
    try {
      const stored = localStorage.getItem(ACTIVE_KEY);
      if (validSession(stored)&&this.owner(stored)===this.principal) this.sessionId = stored;
      else if(access)localStorage.setItem(ACTIVE_KEY, this.sessionId);
    } catch {}
    return this.sessionId;
  }
  private restore() {
    try {
      for (let i=0; i<localStorage.length; i++) {
        const key=localStorage.key(i)!;
        if (!key.startsWith(EVENT_PREFIX)) continue;
        try { const e=JSON.parse(localStorage.getItem(key)!); if (validStoredEvent(e) && key===EVENT_PREFIX+e.event_id) this.logs.set(e.event_id,e); } catch {}
      }
    } catch {}
  }
  log(event: Omit<LogEvent, 'session_id' | 'turn_id' | 'timestamp'>, sessionId = this.getSessionId()): LogEvent {
    if (!validSession(sessionId)) throw new Error('Invalid session ID');
    const content=event.content.length>20000?event.content.slice(0,19900)+'\n[Journal text truncated; retain the original response separately.]':event.content;
    const entry: LogEvent = {...structuredClone(event),content, event_id:uniqueId(), session_id:sessionId,
      turn_id:this.getSessionLogs(sessionId).length+1, timestamp:new Date().toISOString(), surface:location.pathname};
    if(sessionId===this.getSessionId())this.setOwner(sessionId,this.principal);
    this.logs.set(entry.event_id!,entry);
    try { localStorage.setItem(EVENT_PREFIX+entry.event_id,JSON.stringify(entry)); }
    catch { this.syncError='Browser storage full or unavailable; export this session before closing the page.'; }
    void this.flush();
    return entry;
  }
  logUserInput(content:string,topic?:string,sessionId?:string) { return this.log({role:'user',content,topic},sessionId); }
  logAssistantResponse(content:string,topic?:string,sessionId?:string) { return this.log({role:'assistant',content,topic},sessionId); }
  logToolCall(name:string,params:Record<string,unknown>,category:'READ'|'WRITE',result?:unknown,confirmed?:boolean,sessionId?:string) {
    return this.log({role:'tool',content:`${category} ${name}`,tool_call:{name,params,category,result},confirmed},sessionId);
  }
  logSystemEvent(content:string,sessionId?:string) { return this.log({role:'system',content},sessionId); }
  getSessionLogs(sessionId=this.getSessionId()) { return this.getAllLogs().filter(e=>e.session_id===sessionId); }
  getAllLogs() { this.restore();const access=getLabAccess();if(access?.enabled&&!access.authenticated)return [];
    return [...this.logs.values()].filter(event=>this.owner(event.session_id)===this.principal).sort((a,b)=>a.timestamp.localeCompare(b.timestamp) || (a.event_id || '').localeCompare(b.event_id || '')); }
  getConversationHistory(currentInput='',sessionId=this.getSessionId()): {role:'user'|'model';content:string}[] {
    const turns=this.getSessionLogs(sessionId).filter(e=>e.role==='user'||e.role==='assistant');
    if (turns[turns.length-1]?.role==='user' && turns[turns.length-1]?.content===currentInput) turns.pop();
    return turns.slice(-40).map(e=>({role:e.role==='user'?'user':'model',content:e.content}));
  }
  getSummary(): SessionSummary {
    const logs=this.getSessionLogs();
    return {session_id:this.getSessionId(),start_time:logs[0]?.timestamp || new Date().toISOString(),turn_count:logs.length,
      topics_covered:[...new Set(logs.flatMap(e=>e.topic?[e.topic]:[]))],tool_calls_made:logs.filter(e=>e.tool_call).length,
      confirmations_requested:logs.filter(e=>e.confirmed!==undefined).length};
  }
  resetSession() {
    if(getLabAccess()?.enabled)throw Error('Use Start New Session to request a session from the signed-in lab.');
    this.sessionId=`session_${uniqueId()}`;
    this.anonymousSession=this.sessionId;this.setOwner(this.sessionId,'anonymous');
    try { localStorage.setItem(ACTIVE_KEY,this.sessionId); } catch {}
    try { localStorage.setItem(ANONYMOUS_KEY,this.sessionId); } catch {}
    this.logSystemEvent('New session started; earlier records retained');
    window.dispatchEvent(new Event('rhoda-session-updated'));
  }
  async startNewSession(){
    const access=await ensureLabAccess();
    if(!access.enabled){this.resetSession();return;}
    await labAccess.newSession();this.applyAccess();this.logSystemEvent('New lab session started; earlier records retained');
    try{localStorage.setItem('rhoda-access-revision',uniqueId());}catch{}
  }
  clearAll() { this.resetSession(); } // A new session must not silently erase the journal.
  exportJSON() { return JSON.stringify(this.getSessionLogs(),null,2); }
  getSyncStatus() { return {session_id:this.getSessionId(),error:this.syncError,syncing:this.syncing}; }
  async flush() {
    if (this.syncing) { this.resync=true; return; }
    this.syncing=true;
    try {
      const access=await ensureLabAccess();this.applyAccess();
      if(access.enabled&&(!access.authenticated||!access.permissions.writeJournal)){this.syncError='Sign in with a learner account to save a lab journal.';return;}
      let rejected = 0;
      for (const event of this.getAllLogs()) {
        if(this.owner(event.session_id)!==this.principal)break;
        let ack=false;
        try { ack=localStorage.getItem(ACK_PREFIX+event.event_id)==='1'; } catch {}
        if (ack) continue;
        const response=await labFetch(`${BACKEND}/api/session/log`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event),signal:AbortSignal.timeout(5000)});
        if (response.status===400||response.status===413) { rejected++; continue; }
        if (!response.ok || !(await response.json()).ack) throw new Error(`Session journal unavailable (${response.status}); unsynced records retained for retry.`);
        try { localStorage.setItem(ACK_PREFIX+event.event_id,'1'); } catch {}
      }
      this.syncError=rejected?`${rejected} journal record${rejected===1?' was':'s were'} rejected by the backend. Other records synced; rejected records remain available in the local export.`:null;
    } catch(error) { this.syncError=(error as Error).message; }
    finally {
      this.syncing=false; window.dispatchEvent(new Event('rhoda-sync-updated'));
      if (this.resync) { this.resync=false; void this.flush(); }
    }
  }
}
export const sessionLogger = new SessionLogger();
