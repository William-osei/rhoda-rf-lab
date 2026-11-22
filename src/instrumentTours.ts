import './labAccessUI';

type InstrumentId = 'scope' | 'vna';
type Tour = { title: string; kind: string; description: string; viewer: string; full: string; marker: string };
const tours: Record<InstrumentId, Tour> = {
  scope: {
    title: 'Oscilloscope · RTB24 reference',
    kind: 'OSCILLOSCOPE TEACHING MODEL',
    description: 'Explore the scope’s front panel and rear connections. Its training controls use the local RHODA simulator; a live service is needed for measurements.',
    viewer: 'spatial-bench.html?embedded=1',
    full: 'spatial-bench.html',
    marker: '#instrument-view',
  },
  vna: {
    title: 'Vector network analyzer · ZNLE6 reference',
    kind: 'VNA TEACHING MODEL',
    description: 'Inspect the ZNLE6 front and rear panels, then explore S-parameters, virtual calibration and guided lessons. This VNA workspace runs locally without RHODA’s instrument service.',
    viewer: 'learning/vna/index.html?page=instrument&embedded=1',
    full: 'learning/vna/index.html?page=instrument',
    marker: '#model-view',
  },
};
const isInstrument = (value: string | null): value is InstrumentId => value === 'scope' || value === 'vna';
const requestedInstrument = () => {
  const value = new URLSearchParams(location.search).get('instrument');
  return isInstrument(value) ? value : 'scope';
};
const viewport = document.getElementById('tour-viewport')!;
const panel = document.getElementById('tour-panel')!;
const title = document.getElementById('tour-title')!;
const kind = document.getElementById('tour-kind')!;
const description = document.getElementById('tour-description')!;
const status = document.getElementById('tour-status')!;
const full = document.getElementById('tour-open') as HTMLAnchorElement;
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-instrument]')];
let active: InstrumentId | null = null;
let frame: HTMLIFrameElement | null = null;
let loadTimer = 0;
let revision = 0;

function showTour(id: InstrumentId, historyMode: 'push' | 'replace' | 'none' = 'push', force = false) {
  if (id === active && !force) return;
  active = id;
  const current = ++revision;
  clearTimeout(loadTimer);
  const tour = tours[id];
  tabs.forEach(tab => {
    const selected = tab.dataset.instrument === id;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  panel.setAttribute('aria-labelledby', 'tour-tab-' + id);
  title.textContent = tour.title;
  kind.textContent = tour.kind;
  description.textContent = tour.description;
  full.href = tour.full;
  full.setAttribute('aria-label', 'Open ' + tour.title + ' full workspace');
  document.title = 'RHODA · ' + (id === 'scope' ? 'Oscilloscope' : 'VNA') + ' instrument tour';
  status.dataset.state = 'loading';
  status.textContent = 'Loading ' + tour.title + '…';
  viewport.setAttribute('aria-busy', 'true');

  const next = document.createElement('iframe');
  next.className = 'tour-frame';
  next.title = tour.title + ' interactive workspace';
  next.referrerPolicy = 'same-origin';
  next.allowFullscreen = true;
  // Only constant, same-origin application paths enter the viewer. A query
  // string can select one of these two instruments, never supply a frame URL.
  next.src = tour.viewer;
  next.addEventListener('load', () => {
    if (revision !== current || frame !== next) return;
    clearTimeout(loadTimer);
    viewport.setAttribute('aria-busy', 'false');
    try {
      if (!next.contentDocument?.querySelector(tour.marker)) throw new Error('Viewer entry unavailable');
      status.dataset.state = 'ready';
      status.textContent = tour.title + ' loaded. Use its camera and labelled part controls, or open the full workspace.';
    } catch {
      status.dataset.state = 'attention';
      status.textContent = 'The embedded viewer did not finish loading. Try Reload viewer or Open full workspace. The other instrument remains available.';
    }
  });
  next.addEventListener('error', () => {
    if (revision !== current) return;
    clearTimeout(loadTimer);
    viewport.setAttribute('aria-busy', 'false');
    status.dataset.state = 'attention';
    status.textContent = 'The viewer could not be opened. Try Reload viewer or use the full workspace link.';
  });
  // Replacing the previous frame tears down its document/WebGL context. Two
  // hidden instrument render loops are never kept alive just to switch tabs.
  frame = next;
  viewport.replaceChildren(next);
  loadTimer = window.setTimeout(() => {
    if (revision !== current) return;
    viewport.setAttribute('aria-busy', 'false');
    status.dataset.state = 'attention';
    status.textContent = 'This viewer is taking longer to load. You can wait, reload it, or open its full workspace.';
  }, 20000);
  if (historyMode !== 'none') {
    const address = new URL(location.href);
    address.searchParams.set('instrument', id);
    history[historyMode === 'push' ? 'pushState' : 'replaceState'](null, '', address);
  }
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => {
    const id = tab.dataset.instrument;
    if (isInstrument(id ?? null)) showTour(id as InstrumentId);
  });
  tab.addEventListener('keydown', event => {
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[next].focus();
    showTour(tabs[next].dataset.instrument as InstrumentId);
  });
});
document.getElementById('tour-reload')!.addEventListener('click', () => showTour(active ?? 'scope', 'none', true));
window.addEventListener('popstate', () => showTour(requestedInstrument(), 'none'));
window.addEventListener('pagehide', event => {
  if ((event as PageTransitionEvent).persisted) return;
  clearTimeout(loadTimer);
  frame?.remove();
  frame = null;
});
showTour(requestedInstrument(), 'replace');
