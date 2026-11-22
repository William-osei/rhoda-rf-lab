/** Cross-page invalidation only; no commands or measurements are transferred. */
const eventName = 'rhoda-instrument-changed';
const storageKey = 'rhoda-instrument-change-v1';
const sender = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Math.random());
let channel: BroadcastChannel | null = null;
try { channel = new BroadcastChannel(eventName); } catch { /* Storage events remain available. */ }
let seen = '';
function receive(value: unknown) {
  const record = value as {id?:unknown;sender?:unknown} | null;
  if (!record || typeof record.id !== 'string' || record.sender === sender || record.id === seen) return;
  seen = record.id;
  window.dispatchEvent(new Event(eventName));
}
if (channel) channel.onmessage = event => receive(event.data);
window.addEventListener('storage', event => {
  if (event.key !== storageKey || !event.newValue) return;
  try { receive(JSON.parse(event.newValue)); } catch { /* Ignore malformed external storage. */ }
});
window.addEventListener('pagehide', event => { if (!event.persisted) channel?.close(); });
export function announceInstrumentChange() {
  const record = {id: `${sender}-${performance.now()}-${Math.random()}`, sender};
  channel?.postMessage(record);
  try { localStorage.setItem(storageKey, JSON.stringify(record)); } catch { /* Broadcast remains available. */ }
}
export function onInstrumentChange(callback: () => void) {
  window.addEventListener(eventName, callback);
  return () => window.removeEventListener(eventName, callback);
}
