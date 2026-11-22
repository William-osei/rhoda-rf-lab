import { sessionLogger } from './session';
import { labFetch } from './authRequest';
import { announceInstrumentChange } from './instrumentChanges';

import { BACKEND } from './runtimeConfig';
export { BACKEND } from './runtimeConfig';
export type Operation = { path: string; value: unknown } | { measurementType: string; source: string };
type Pending = { operation: Operation; token: string; sessionId: string; summary: string; cleanupOnly?:boolean };
let pending: Pending[] = [];
let busy = false;
let cachedState: Record<string, unknown> = { status: 'unavailable' };

export async function api(path: string, body?: unknown, sessionId = sessionLogger.getSessionId()): Promise<any> {
  let response: Response;
  try { response = await labFetch(`${BACKEND}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Rhoda-Session': sessionId },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  }); } catch (error) {
    if (error instanceof DOMException && ['TimeoutError', 'AbortError'].includes(error.name)) throw new Error('Instrument request timed out. Check the connection and refresh the readback before retrying.');
    throw new Error('Instrument service is unavailable. Check the backend connection and try again.');
  }
  let data;
  try { data = await response.json(); } catch { throw new Error(`Instrument service returned an unreadable response (${response.status}). Check the API connection.`); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Instrument service returned an invalid response. Refresh the connection before continuing.');
  if (!response.ok || data.ok === false) throw new Error(data.error || `Instrument request failed (${response.status})`);
  if (body && (path === '/api/training/scenarios' || (['/api/instrument/set','/api/instrument/measure'].includes(path) && (body as {confirmed?:unknown}).confirmed === true))) announceInstrumentChange();
  return data;
}

export async function readState(scope = 'all') {
  try {
    const data = await api(`/api/instrument/state?scope=${encodeURIComponent(scope)}`);
    if (scope === 'all') cachedState = data.result;
    return data;
  } catch (error) {
    cachedState = { status: 'unavailable' };
    throw error;
  }
}
export function getCachedState() { return structuredClone(cachedState); }
export function hasPending() { return pending.length > 0; }
export function getPendingSummary() { return pending.map(item => item.summary).join('; '); }
export function pendingNeedsCancellation() { return pending.some(item=>item.cleanupOnly); }

async function discard(items: Pending[]) {
  const results = await Promise.allSettled(items.map(p => api('/api/instrument/cancel', { confirmationId: p.token }, p.sessionId)));
  return items.filter((_item, index) => results[index].status === 'rejected');
}

export async function cancelOperations() {
  if (busy) throw new Error('An instrument operation is already in progress');
  busy = true;
  const old = pending;
  try {
    pending = await discard(old);
    if (pending.length) throw new Error(`Cancellation could not be verified for ${pending.length} pending operation${pending.length === 1 ? '' : 's'}. Reconnect and retry Cancel; no approval was sent.`);
    if (old.length) sessionLogger.log({role:'system',content:'Pending operation cancelled',confirmed:false},old[0].sessionId);
  } finally { busy = false; }
}

export async function previewOperations(operations: Operation[]) {
  if (busy) throw new Error('An instrument operation is already in progress');
  if (pending.length) throw new Error('Approve or cancel the pending operation first');
  if (!operations.length) throw new Error('No supported instrument operation');
  const sessionId = sessionLogger.getSessionId();
  const snapshot = structuredClone(operations);
  busy = true;
  const staged: Pending[] = [];
  const summaries: string[] = [];
  try {
    for (const operation of snapshot) {
      const endpoint = 'path' in operation ? 'set' : 'measure';
      const data = await api(`/api/instrument/${endpoint}`, { ...operation, confirmed: false },sessionId);
      if (!data.needsConfirmation || !data.confirmationId) throw new Error('Backend did not issue an approval token');
      staged.push({ operation, token: data.confirmationId, sessionId, summary:data.summary });
      summaries.push(data.summary);
    }
    pending = staged;
    return { ok: true, needsConfirmation: true, confirmationId: staged[0].token, summary: summaries.join('; ') };
  } catch (error) {
    pending = await discard(staged);
    pending.forEach(item=>item.cleanupOnly=true);
    if (pending.length) throw new Error(`${(error as Error).message}. ${pending.length} unapproved preview could not be cancelled; retry Cancel before preparing another operation.`);
    throw error;
  } finally { busy = false; }
}

export async function confirmOperations() {
  if (busy) throw new Error('An instrument operation is already in progress');
  if (!pending.length) throw new Error('No pending confirmation');
  if (pendingNeedsCancellation()) throw new Error('A previous request needs cancellation cleanup. Retry Cancel, then refresh and prepare a new preview.');
  if (pending.some(item => item.sessionId !== sessionLogger.getSessionId())) throw new Error('The active session changed after this preview. Cancel it and prepare a new preview in the current session.');
  busy = true;
  const approved = pending;
  pending = [];
  const completed: unknown[] = [];
  try {
    for (const { operation, token, sessionId } of approved) {
      const endpoint = 'path' in operation ? 'set' : 'measure';
      const data = await api(`/api/instrument/${endpoint}`, { ...operation, confirmed: true, confirmationId: token },sessionId);
      completed.push(data.result);
      sessionLogger.logToolCall(endpoint, operation, 'WRITE', {value:data.result,provenance:data.provenance}, true, sessionId);
    }
    await readState();
    return { ok: true, result: completed.length === 1 ? completed[0] : completed };
  } catch (error) {
    sessionLogger.logSystemEvent(`Instrument error: ${(error as Error).message}; ${completed.length} operations completed before failure.`,approved[0].sessionId);
    throw new Error(`${(error as Error).message}${completed.length ? ` (${completed.length} earlier settings applied; inspect state before retrying)` : ''}`);
  } finally {
    pending = await discard(approved);
    pending.forEach(item=>item.cleanupOnly=true);
    busy = false;
  }
}

export function operationsFor(name: string, p: Record<string, unknown>): Operation[] {
  const channel = p.channel ?? 1;
  switch (name) {
    case 'set_timebase': return [{ path: 'timebase.scale', value: p.timebase_s_div }];
    case 'set_vertical_scale': return [{ path: `channel.${channel}.vertical_scale`, value: p.scale_v_div }];
    case 'set_channel_coupling': return [{ path: `channel.${channel}.coupling`, value: p.coupling }];
    case 'set_channel_enabled': return [{ path: `channel.${channel}.enabled`, value: p.enabled }];
    case 'set_probe_attenuation': return [{ path: `channel.${channel}.probe_attenuation`, value: p.attenuation }];
    case 'get_measurement': return [{ measurementType: 'frequency', source: `CH${channel}` }];
    case 'set_trigger': {
      const ops: Operation[] = [];
      if (p.source !== undefined) ops.push({ path: 'trigger.source', value: `CH${p.source}` });
      if (p.level_v !== undefined) ops.push({ path: 'trigger.level', value: p.level_v });
      if (p.slope !== undefined) ops.push({ path: 'trigger.slope', value: p.slope });
      if (p.mode !== undefined) ops.push({ path: 'trigger.mode', value: p.mode });
      return ops;
    }
    default: throw new Error(`Unsupported instrument function: ${name}`);
  }
}
