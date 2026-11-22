import { BACKEND } from './runtimeConfig';

export type LabRole = 'viewer' | 'learner' | 'operator' | 'instructor' | 'admin';
export type LabPermissions = {readJournal:boolean;writeJournal:boolean;operateInstrument:boolean;inspectAllSessions:boolean;manageUsers:boolean};
export type LabAccessStatus = {enabled:boolean;authenticated:boolean;user:{username:string;role:LabRole}|null;csrfToken:string|null;sessionId:string|null;permissions:LabPermissions;expiresAt:string|null};
const roles:LabRole[]=['viewer','learner','operator','instructor','admin'];
const sessionPattern=/^[A-Za-z0-9_-]{1,128}$/;

export function validateAccessStatus(value:unknown): asserts value is LabAccessStatus {
  const s=value as LabAccessStatus|null;
  if(!s||typeof s.enabled!=='boolean'||typeof s.authenticated!=='boolean'||!s.permissions
    ||['readJournal','writeJournal','operateInstrument','inspectAllSessions','manageUsers'].some(k=>typeof s.permissions[k as keyof LabPermissions]!=='boolean'))throw Error('Lab access returned an invalid status. Reconnect before using the shared lab.');
  if(s.enabled&&s.authenticated){
    if(!s.user||typeof s.user.username!=='string'||!s.user.username||!roles.includes(s.user.role)||typeof s.csrfToken!=='string'||s.csrfToken.length<16||typeof s.sessionId!=='string'||!sessionPattern.test(s.sessionId)||typeof s.expiresAt!=='string'||!Number.isFinite(Date.parse(s.expiresAt)))throw Error('Lab sign-in returned an incomplete session. Sign in again.');
  }else if(s.authenticated||s.user!==null||s.csrfToken!==null||s.sessionId!==null)throw Error('Lab access returned inconsistent sign-in information.');
}

/** Credentials and CSRF tokens live only in memory; cookies remain HTTPOnly. */
export class LabAccessClient {
  private current:LabAccessStatus|null=null;
  private pending:Promise<LabAccessStatus>|null=null;
  private checkedAt=0;
  private generation=0;
  constructor(private base=BACKEND,private notify:(status:LabAccessStatus)=>void=()=>{}){}
  snapshot(){return this.current?structuredClone(this.current):null;}
  revision(){return this.generation;}
  invalidate(){this.checkedAt=0;this.generation++;}
  private accept(status:unknown){
    validateAccessStatus(status);
    const before=JSON.stringify(this.current);this.current=structuredClone(status);this.checkedAt=Date.now();
    if(before!==JSON.stringify(this.current)){this.generation++;this.notify(this.snapshot()!);}
    return this.snapshot()!;
  }
  async refresh(force=false):Promise<LabAccessStatus>{
    if(this.pending)return this.pending;
    if(!force&&this.current&&Date.now()-this.checkedAt<15000)return this.snapshot()!;
    const revision=this.generation;
    const work=(async()=>{
      const response=await fetch(`${this.base}/api/auth/status`,{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(6000)});
      if(!response.ok)throw Error('Lab access service is unavailable. Start or reconnect the backend.');
      const status=await response.json();
      if(revision!==this.generation){this.checkedAt=0;throw Error('Lab access changed while reconnecting. Retry the request.');}
      return this.accept(status);
    })();this.pending=work;
    try{return await work;}finally{if(this.pending===work)this.pending=null;}
  }
  private async post(path:string,body:unknown,csrf?:string|null){
    const headers:Record<string,string>={'Content-Type':'application/json'};
    if(csrf)headers['X-Rhoda-CSRF']=csrf;
    const response=await fetch(`${this.base}/api/auth/${path}`,{method:'POST',credentials:'include',cache:'no-store',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    let data;try{data=await response.json();}catch{throw Error('Lab access returned an unreadable response. Retry sign-in.');}
    if(!response.ok||data.ok===false)throw Error(typeof data.error==='string'?data.error:'Lab access request failed.');
    return data;
  }
  async login(username:string,password:string){
    await this.refresh();
    await this.post('login',{username:username.trim(),password});
    this.invalidate();return this.refresh(true);
  }
  async logout(){
    const s=await this.refresh();
    if(!s.enabled||!s.authenticated)return s;
    await this.post('logout',{},s.csrfToken);
    this.invalidate();return this.refresh(true);
  }
  async newSession(){
    const s=await this.refresh();if(!s.enabled)return null;
    if(!s.authenticated||!s.permissions.writeJournal)throw Error('Sign in with a learner account to start a lab session.');
    const result=await this.post('session',{},s.csrfToken);
    if(typeof result.sessionId!=='string'||!sessionPattern.test(result.sessionId))throw Error('The lab did not return a valid new session.');
    return this.accept({...s,sessionId:result.sessionId});
  }
}

export const labAccess=new LabAccessClient(BACKEND,status=>{
  // Tokens are never broadcast or attached to DOM events.
  const {csrfToken:_csrf,...publicStatus}=status;
  window.dispatchEvent(new CustomEvent('rhoda-access-updated',{detail:publicStatus}));
});
export const getLabAccess=()=>labAccess.snapshot();
export const ensureLabAccess=()=>labAccess.refresh();

