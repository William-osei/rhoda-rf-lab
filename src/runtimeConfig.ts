/** Use the page's /api route so LAN and HTTPS clients do not call their own loopback. */
export const BACKEND = (import.meta.env.VITE_INSTRUMENT_API || '').trim().replace(/\/+$/, '');
