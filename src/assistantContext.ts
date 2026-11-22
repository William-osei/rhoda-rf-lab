import { LAB_DOMAINS, ASSISTANT_MODES, labContext, type LabDomain, type AssistantMode } from './labTopics';
export type AssistantPreferences = {domain:LabDomain; mode:AssistantMode; model:string; depth:string};
const KEY='rhoda_assistance_context_v1';
const defaults:AssistantPreferences={domain:'general',mode:'learn',model:'',depth:'balanced'};
export function readPreferences():AssistantPreferences {
  try {
    const p=JSON.parse(localStorage.getItem(KEY)||'{}');
    return {domain:LAB_DOMAINS.some(d=>d[0]===p.domain)?p.domain:defaults.domain,
      mode:ASSISTANT_MODES.some(m=>m[0]===p.mode)?p.mode:defaults.mode,
      model:typeof p.model==='string'?p.model.slice(0,160):'',
      depth:['brief','balanced','detailed'].includes(p.depth)?p.depth:'balanced'};
  } catch { return {...defaults}; }
}
export function savePreferences(p:AssistantPreferences) { try {localStorage.setItem(KEY,JSON.stringify(p));} catch {} }
export function sharedAssistanceContext() { const p=readPreferences(); return labContext(p.domain,p.mode,p.model,p.depth); }
export function assertControlTopic() {
  if (!['general','rtb'].includes(readPreferences().domain)) throw new Error('This topic supports guidance only; select RTB practice in chat to use the current control adapter.');
}
