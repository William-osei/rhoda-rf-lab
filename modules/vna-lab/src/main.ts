import './styles.css';
import './bench.css';
import './embedded.css';
import { rangeCenteredOnMarker, rangeFromMarkers } from './benchSetup';
import { analyzeReflection, findSampledMagnitudeExtreme } from './benchAnalysis';
import { storeTrace, getMemoryCompatibility, compareTraceMemory, type TraceMemory } from './traceMemory';
import labIcon from './assets/rs-lab-icon.png';
import { createLessonStudio } from './lessonStudio';
import type { LabSnapshot } from './lessonState';
import {
  DUTS,
  DEFAULT_SWEEP,
  sampleSweep,
  traceValue,
  markerAt,
  createCalibration,
  recordStandard,
  calibrationComplete,
  validateSweep,
  applyTransmissionReference,
} from './simulation';
import {
  markerReadout,
  markerTraceValue,
  formatMagnitude,
  formatPhase,
  formatDelay,
  formatVSWR,
  phaseSamplingLimitSeconds,
  compareMarkers,
  analyzeTransmissionPassband,
} from './tracePresentation';
import { lessons, resources, instrumentParts } from './content';
import { createInstrument } from './instrument';
import { createTouchstone } from './export';

type Page = 'bench' | 'instrument' | 'learn' | 'resources';
type Parameter = 's11' | 's21' | 's12' | 's22';
type Format = 'logmag' | 'phase' | 'smith' | 'vswr' | 'groupdelay';
type DutId = Parameters<typeof sampleSweep>[1];
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (text: unknown) =>
  String(text).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );
const icons: Record<string, string> = {
  bench: '<path d="M2 12h4l3-8 6 16 3-8h4"/>',
  instrument:
    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M6 8h9v8H6zM18 9h1m-1 4h1"/>',
  learn:
    '<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4zM13 7a3 3 0 0 1 3-3h5v15h-5a4 4 0 0 0-3 2"/>',
  resources: '<path d="M4 3v18h16V7l-4-4zM15 3v5h5M8 12h8m-8 4h6"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
  cube: '<path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5m-9 5v10"/>',
  reset: '<path d="M4 10a8 8 0 1 1 2 8M4 3v7h7"/>',
  link: '<path d="M14 3h7v7m0-7L10 14M9 3H3v18h18v-6"/>',
  play: '<path d="m8 4 12 8-12 8z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  wave: '<path d="M2 12c4-14 6 14 10 0s6 14 10 0"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
};
const icon = (id: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[id] ?? icons.info}</svg>`;
const startup = new URLSearchParams(location.search);
const initialPage = startup.get('page');
let page: Page = ['bench', 'instrument', 'learn', 'resources'].includes(initialPage ?? '')
  ? initialPage as Page : 'bench';
const embedded = startup.get('embedded') === '1';
if (embedded) document.body.classList.add('rhoda-embedded');
let sweep = { ...DEFAULT_SWEEP };
let dut: DutId = 'bandpass';
let parameter: Parameter = 's21';
let format: Format = 'logmag';
let calibration = createCalibration(sweep);
let points = sampleSweep(sweep, dut, calibration);
let throughReference: typeof points | null = null;
let referenceEnabled = false;
let markerHz = 2.4e9;
let power = -10,
  ifBandwidth = 10000;
let running = false,
  animation = 0;
let secondaryMarkerHz = 2.4e9;
let secondaryMarkerEnabled = false;
let autoScale = false;
let settingsDirty = false;
let toastTimer = 0;
let exportCount = 0;
let calibrationInvalidated = false;
const visitedParts = new Set<string>();
let studentNotes = '';
let traceMemory: TraceMemory | null = null;
let showMemory = true;
let returnDut: DutId | null = null;
let plotWidth = 0, resizeFrame = 0;
let plotObserver: ResizeObserver | null = null;

let selectedPart = 'screen';
let cameraView: 'angle' | 'front' | 'rear' | 'screen' | 'controls' | 'ports' = 'angle';
let loadedLesson: string | null = null;
let focusedPart = false;
let benchRevision = 0;
let model: ReturnType<typeof createInstrument> | null = null;
const screen = document.createElement('canvas');
screen.width = 1280;
screen.height = 720;
const app = $('app');
for (const id of ['lab-favicon', 'lab-touch-icon']) {
  const el = document.getElementById(id) as HTMLLinkElement | null;
  if (el) el.href = labIcon;
}
app.innerHTML = `
<aside class="sidebar">
  <a href="#bench" data-page="bench" class="brand" aria-label="R&S VNA Student Lab home"><img class="brand-icon" src="${labIcon}" alt="R&S lab icon"><span><b>R&S<span class="brand-light"> / lab</span></b><small>VNA STUDENT STUDIO</small></span></a>
  <div class="nav-label">EXPLORE & UNDERSTAND</div>
  <nav aria-label="Main workspace">${(['bench', 'instrument', 'learn', 'resources'] as Page[]).map((p, i) => `<button class="nav-item ${i === 0 ? 'active' : ''}" data-page="${p}" ${i === 0 ? 'aria-current="page"' : ''}>${icon(p)}<span>${['Practice bench', 'Instrument tour', 'Guided lessons', 'Learning resources'][i]}</span><span class="nav-count">${['01', '02', '03', '04'][i]}</span></button>`).join('')}</nav>
  <div class="sidebar-card"><span class="tiny-orbit">${icon('cube')}</span><small>BEFORE THE REAL LAB</small><h3>Get to know<br>your instrument.</h3><p>Explore. Calibrate.<br>Make sense of the trace.</p><button class="text-button" data-page="learn">Start a lesson ${icon('arrow')}</button></div>
  <div class="offline-label"><span class="status-dot"></span><div><b>Built to work offline</b><small>No account. No equipment.</small></div></div>
  <span class="sidebar-version">INDEPENDENT EDUCATIONAL PROTOTYPE · v0.3</span>
</aside>
<div class="app-body">
  <header class="topbar"><div class="breadcrumb">RF learning lab <span>/</span> <strong id="page-label">Practice bench</strong></div><div class="top-actions"><span class="model-tag">R&S ZNLE6 <i>REFERENCE</i></span><button class="icon-button" id="reset" aria-label="Reset simulator to defaults" title="Reset simulator">${icon('reset')}</button></div></header>
  <main id="workspace" tabindex="-1">
    <section id="page-bench" class="page">
      <div class="page-heading bench-heading"><div><div class="eyebrow">MEASURE / COMPARE / UNDERSTAND</div><h1>Your RF workbench<span>.</span></h1><p>Set a sweep, inspect a network and compare what changed.</p></div><div class="bench-spec"><b>ZNLE6 <span>LEARNING BENCH</span></b><small>1 MHz–6 GHz · 50 Ω · simulated</small></div></div><div class="bench-jumps" aria-label="Bench shortcuts"><button data-bench-jump="bench-controls">Sweep setup</button><button data-bench-jump="display-card">Trace & markers</button><button data-bench-jump="bench-notes">Lab notes</button></div>
      <div id="guided-context" class="guided-context" hidden><div><span class="eyebrow">GUIDED EXERCISE</span><strong id="guided-context-title"></strong></div><button class="secondary-button" data-page="learn">Return to your lesson ${icon('arrow')}</button></div><div class="bench-layout">
        <div class="bench-main">
          <section class="display-card" id="display-card" aria-label="VNA sweep display">
            <div class="card-toolbar"><div class="section-label"><span class="square-blue"></span> LIVE NETWORK RESPONSE</div><span class="status-badge" id="sweep-state">READY</span></div>
            <div class="trace-toolbar"><div class="trace-parameters" role="group" aria-label="S-parameter">${(['s11', 's21', 's12', 's22'] as Parameter[]).map((p) => `<button data-parameter="${p}" class="trace-tab ${p === parameter ? 'active' : ''}" aria-pressed="${p === parameter}">${p.toUpperCase()}</button>`).join('')}</div><button class="small-button" id="autoscale" aria-pressed="false">Auto scale</button><label class="inline-label">Format <select id="format" aria-label="Trace format"><option value="logmag">Log magnitude</option><option value="phase">Phase</option><option value="smith">Smith chart</option><option value="vswr">VSWR</option><option value="groupdelay">Group delay</option></select></label></div>
            <div class="trace-memory-tools"><button class="small-button" id="store-trace">Store current trace</button><button class="small-button" id="show-memory" aria-pressed="true" disabled>Show stored</button><button class="text-button" id="clear-memory" disabled>Clear</button><span class="trace-key"><i></i>Live <i class="memory-key"></i>Stored</span></div><p id="memory-status" class="memory-status">Store a trace to compare DUTs or correction on the same frequency grid. Stored traces stay in this page only.</p><div class="plot-wrap"><canvas id="plot" width="1280" height="720" tabindex="0" aria-describedby="marker-accessible-summary" aria-label="Simulated VNA trace. Click a frequency to move the marker; use left and right arrows for samples, Home and End for sweep edges."></canvas><span class="plot-caption">${icon('info')} Click to place M1 · arrow keys step samples</span></div>
            <div class="display-footer"><span id="trace-caption">Idealized network · no hardware connected</span><span id="acquisition-caption">401 points · IF BW 10 kHz</span></div><p id="plot-range-note" class="plot-range-note" hidden></p><p id="sampling-warning" class="sampling-warning" hidden></p>
          </section>
          <section class="marker-card" aria-label="Marker results"><div class="marker-heading"><span class="marker-symbol">M1</span><div><b>Marker workspace</b><small>Inspect a frequency, then compare it with M2</small></div><label>Marker frequency <span class="input-unit"><input id="marker" type="number" value="2400" min="1" max="6000" step="any" aria-label="Marker frequency in MHz"><span>MHz</span></span></label></div><div class="marker-search"><button class="small-button" id="previous-sample" aria-label="Previous sampled frequency">← Sample</button><button class="small-button" id="next-sample" aria-label="Next sampled frequency">Sample →</button><button data-marker-search="max" class="text-button">Magnitude max</button><button data-marker-search="min" class="text-button">Magnitude min</button></div><div class="secondary-marker-tools"><button class="small-button" id="set-reference-marker">Set M2 here</button><label>Reference frequency <span class="input-unit"><input id="marker2" type="number" value="2400" min="1" max="6000" step="any" aria-label="Reference marker frequency in MHz"><span>MHz</span></span></label><button class="text-button" id="clear-reference-marker" disabled>Clear M2</button></div><div class="readout-grid"><div><small>FREQUENCY</small><strong id="read-frequency">2.400 <em>GHz</em></strong></div><div><small id="read-value-label">S21 MAGNITUDE</small><strong id="read-value">—</strong></div><div><small>PHASE</small><strong id="read-phase">—</strong></div><div><small id="read-extra-label">GROUP DELAY</small><strong id="read-extra">—</strong></div></div><div id="marker-comparison" class="marker-comparison" hidden><span><small>M2 REFERENCE</small><b id="reference-frequency"></b></span><span><small>Δ f · M2 − M1</small><b id="difference-frequency"></b></span><span><small>Δ MAGNITUDE · M2 − M1</small><b id="difference-magnitude"></b></span></div><div id="memory-comparison" class="memory-comparison" hidden></div><div class="marker-range-tools"><span>PREPARE A NEW SWEEP</span><button class="small-button" id="center-on-marker">Center on M1</button><button class="small-button" id="range-from-markers" disabled>Sweep M1–M2 range</button><small>Range tools create a draft. Run sweep to apply it.</small></div><p id="marker-accessible-summary" class="sr-only" role="status" aria-live="polite"></p></section><section id="reflection-insights" class="network-insights" hidden><div><span class="eyebrow">REFLECTION AT M1</span><h2 id="reflection-heading">What comes back?</h2></div><div id="reflection-readout" class="insight-readout"></div><p id="reflection-note"></p></section><section id="network-insights" class="network-insights"><div><span class="eyebrow">NETWORK INSIGHT</span><h2 id="passband-heading">S21 · sampled −3 dB passband</h2></div><div id="passband-readout"></div><p id="passband-note"></p></section>
          <section class="connection-card"><div class="connection-title"><span class="section-label">YOUR SIGNAL PATH</span><p id="dut-description"></p></div><div class="signal-path"><span class="port-chip">PORT 1</span><span class="cable-line"></span><div class="dut-chip">${icon('wave')}<b id="dut-name">Band-pass filter</b></div><span class="cable-line" id="port2-cable"></span><span class="port-chip" id="port2-path">PORT 2</span></div><p class="connection-note" id="parameter-explanation"></p></section>
          <section class="lab-notes" id="bench-notes"><div><span class="eyebrow">YOUR LAB NOTE</span><h2>Observe, then explain.</h2><p>Notes stay in this page until you save a report. Nothing is uploaded.</p></div><textarea id="student-notes" maxlength="4000" rows="4" aria-label="Your measurement observations" placeholder="What did you change? What did the trace show? What are the limits of this result?"></textarea><div><button class="text-button" id="add-observation">Add current marker observation</button><span id="notes-count">0 / 4,000</span></div></section><div class="learning-nudge">${icon('learn')}<p><b>New to network analysis?</b> Start with a guided setup, then take your first measurement.</p><button class="text-button" data-page="learn">Take the walkthrough ${icon('arrow')}</button></div>
        </div>
        <aside class="control-card" id="bench-controls" aria-label="Simulator controls"><div class="control-title"><h2>Configure the bench</h2><p>Apply a setup. Then inspect the response.</p></div>
          <label class="field-label" for="dut">DEVICE UNDER TEST</label><select id="dut">${DUTS.map((d) => `<option value="${d.id}" ${d.id === dut ? 'selected' : ''}>${esc(d.title)}</option>`).join('')}</select>
          <div class="control-tabs" role="group" aria-label="Control panel"><button data-panel="sweep" class="active" aria-pressed="true">Sweep</button><button data-panel="calibration" aria-pressed="false">Calibration</button></div>
          <div id="panel-sweep"><form id="sweep-form" novalidate><div class="range-presets"><span>QUICK RANGE</span><button type="button" data-range="full">Full span</button><button type="button" data-range="filter">2.4 GHz filter</button><button type="button" data-range="low">Low-pass</button></div><div class="frequency-pair"><label>Start frequency<span class="input-unit"><input id="start" type="number" value="1" min="1" max="6000" step="any" required><span>MHz</span></span></label><label>Stop frequency<span class="input-unit"><input id="stop" type="number" value="6000" min="1" max="6000" step="any" required><span>MHz</span></span></label></div><div class="field-pair"><label>Sweep points<select id="points"><option>201</option><option selected>401</option><option>801</option><option>1601</option></select></label><label>Spacing<select id="spacing"><option value="linear">Linear</option><option value="log">Logarithmic</option></select></label></div><div class="field-pair"><label>Source power<select id="power"><option value="-10">−10 dBm</option><option value="-5">−5 dBm</option><option value="0">0 dBm</option></select></label><label>IF bandwidth<select id="bandwidth"><option value="1000">1 kHz</option><option value="10000" selected>10 kHz</option><option value="100000">100 kHz</option></select></label></div><p id="form-error" class="form-error" role="alert"></p><button class="primary-button wide" type="submit" id="run-sweep">${icon('play')} Run sweep</button></form><div id="pending-setup" class="pending-setup" hidden><b>Changes are not applied yet.</b><span>Run the sweep to use them, or keep the last applied setup.</span><button class="text-button" id="discard-setup">Discard setup changes</button></div><p id="applied-setup" class="applied-setup"></p><button class="secondary-button wide" id="pause-sweep" disabled>${icon('stop')} Stop sweep</button><p class="control-footnote">Power and IF bandwidth are recorded as setup choices. These ideal linear networks do not model compression, noise or real sweep time.</p></div>
          <div id="panel-calibration" hidden><h3>One-port SOL</h3><p class="help-text">Connect three virtual standards at the reference plane. Correction removes this simulator’s known reflection errors.</p><div class="cal-standards">${(['open', 'short', 'load'] as const).map((s, i) => `<button data-standard="${s}"><span>${['○', '⊥', 'Ω'][i]}</span><b>${s[0].toUpperCase() + s.slice(1)}</b><small id="cal-${s}">Capture standard</small></button>`).join('')}</div><p class="cal-status" id="cal-status">0 of 3 standards captured</p><button class="secondary-button wide" id="clear-cal">Clear calibration</button><p class="control-footnote">SOL corrects Port 1 S11 only. S22 is uncorrected. This is not a full two-port hardware calibration.</p><div class="control-divider"></div><h3>Relative THRU reference</h3><p class="help-text">Connect the virtual through cable, capture its trace, then compare transmission relative to that stored response.</p><button class="secondary-button wide" id="capture-thru">Capture virtual THRU</button><label class="check-label"><input type="checkbox" id="enable-thru" disabled> Apply transmission reference</label><button class="text-button" id="clear-thru">Clear THRU reference</button><p id="thru-status" class="control-footnote">No reference captured. This response normalization is not a full two-port calibration.</p></div>
          <button class="secondary-button wide reconnect-dut" id="reconnect-dut" hidden></button><div class="control-divider"></div><div class="cal-indicator"><span id="cal-dot" class="status-dot amber"></span><span id="cal-summary">Reflection: uncorrected</span></div>
          <button id="export-touchstone" class="export-button">${icon('download')} Export Touchstone (.s2p)</button><button id="export-report" class="export-button">${icon('resources')} Save measurement report</button><button id="export-image" class="export-button">${icon('download')} Save trace image (.png)</button>
        </aside>
      </div>
      <p class="simulation-disclaimer">Educational model, not instrument firmware. Generated responses are not measurements or evidence of hardware performance. Settings and connections must be checked against the actual instrument manual in the lab.</p>
    </section>
    <section id="page-instrument" class="page" hidden><div class="page-heading compact"><div><div class="eyebrow">MEET THE INSTRUMENT</div><h1>Every control has a purpose<span>.</span></h1><p>Rotate the photo-referenced model, choose a part, and understand its role.</p></div><span class="outline-chip">PARAMETRIC 3D MODEL</span></div><div class="tour-layout"><section class="model-card"><div class="model-toolbar"><span class="section-label">ZNLE6 · INTERACTIVE ANATOMY</span><div role="group" aria-label="Instrument view"><button class="small-button active" data-view="angle">Angled</button><button class="small-button" data-view="front">Front</button><button class="small-button" data-view="rear">Rear</button><button class="small-button" data-view="screen">Screen</button><button class="small-button" data-view="controls">Controls</button><button class="small-button" data-view="ports">RF ports</button></div></div><div id="model-view" aria-label="Interactive 3D instrument; drag to rotate. Equivalent part selection follows."></div><div class="model-hint">${icon('cube')} Drag to rotate · scroll to zoom · select a control</div></section><aside class="part-card"><span class="eyebrow">INSTRUMENT GUIDE</span><label class="field-label" for="part-select">CHOOSE A PART</label><select id="part-select">${instrumentParts.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select><button class="text-button inspect-part" id="inspect-part">Inspect selected part ${icon('cube')}</button><div class="part-number" id="part-number">01 / FRONT PANEL</div><h2 id="part-title"></h2><p id="part-description"></p><div class="tip-card"><span>AT THE BENCH</span><p id="part-tip"></p></div><button class="primary-button wide" id="try-part-control">Try this at the bench ${icon('arrow')}</button><button class="secondary-button wide part-lesson" id="part-lesson">Explore the related lesson</button><p class="control-footnote">Geometry is an educational interpretation of the supplied photos. It is not a manufacturer CAD model. Rear options vary by instrument configuration.</p></aside></div></section>
    <section id="page-learn" class="page" hidden><div id="lesson-studio"></div></section>
    <section id="page-resources" class="page" hidden><div class="page-heading compact"><div><div class="eyebrow">BUILD A STRONGER UNDERSTANDING</div><h1>The ideas behind<br>the measurement<span>.</span></h1><p>Visual fundamentals, worked exercises and carefully chosen manufacturer references.</p></div><span class="outline-chip">LEARN / PRACTISE / VERIFY</span></div><div class="resource-tools"><label class="search-field">${icon('resources')}<input type="search" id="resource-search" aria-label="Search learning resources" placeholder="Search calibration, S-parameters, setup…"></label><div class="resource-filters" role="group" aria-label="Resource topic"><button data-topic="all" class="active" aria-pressed="true">All references</button><button data-topic="fundamentals" aria-pressed="false">Fundamentals</button><button data-topic="calibration" aria-pressed="false">Calibration</button><button data-topic="instrument" aria-pressed="false">Instrument</button></div></div><div class="concept-grid"><article><span class="concept-index">01 / REFLECTION</span><div class="concept-flow"><b>1</b><span>→ <i>DUT</i> ↶</span><strong>S11</strong></div><h2>What comes back?</h2><p>S11 compares the reflected wave at port 1 with the incident wave. −20 dB means |Γ| = 0.1: 1% reflected power in a matched reference system.</p><button class="text-button" data-exercise="reflection">Explore a mismatch ${icon('arrow')}</button></article><article><span class="concept-index">02 / TRANSMISSION</span><div class="concept-flow"><b>1</b><span>→ <i>DUT</i> →</span><strong>2</strong></div><h2>What gets through?</h2><p>S21 describes forward transmission from port 1 to port 2. A −6 dB magnitude is about half the voltage wave amplitude and one quarter of the power for equal reference impedances.</p><button class="text-button" data-exercise="transmission">Measure an attenuator ${icon('arrow')}</button></article><article><span class="concept-index">03 / REFERENCE PLANE</span><div class="concept-flow"><b>S</b><span>+ <i>O</i> +</span><strong>L</strong></div><h2>Where does the DUT start?</h2><p>Calibration characterizes systematic errors up to a defined plane. Moving a cable or changing setup can invalidate a real calibration. A nice-looking trace is not proof of accuracy.</p><button class="text-button" data-exercise="calibration">Practise virtual SOL ${icon('arrow')}</button></article></div><div class="resource-section-title"><div><span class="eyebrow">GO TO THE SOURCE</span><h2>Reference library</h2></div><span id="resource-count"></span></div><div id="resource-grid" class="resource-grid"></div><p class="simulation-disclaimer">Built-in explanations and exercises work offline. External manuals and websites need internet. Resources are linked, not copied; their publishers retain their rights. This independent student project is not endorsed by Rohde & Schwarz.</p></section>
  </main><footer class="footer"><span>VNA / STUDENT LAB</span><span>Model. Observe. Explain.</span><span>Independent educational prototype · ZNLE6 reference</span></footer>
</div><div id="toast" class="toast" role="status" aria-live="polite"></div>`;

// Setup status remains visible when switching from Sweep to Calibration.
document.querySelector('.control-tabs')!.after($('pending-setup'), $('applied-setup'));
// Configuration comes first in keyboard/reading order, matching the small-screen layout.
document.querySelector('.bench-layout')!.prepend($('bench-controls'));
if (embedded) {
  const navigation = document.createElement('nav');
  navigation.className = 'embedded-vna-nav';
  navigation.setAttribute('aria-label', 'VNA workspace');
  navigation.innerHTML = `<span>ZNLE6 STUDENT LAB</span>${(['instrument', 'bench', 'learn', 'resources'] as Page[]).map(p => `<button type="button" data-page="${p}">${({instrument:'Instrument tour',bench:'VNA practice bench',learn:'Guided lessons',resources:'References'})[p]}</button>`).join('')}`;
  document.querySelector('.app-body')!.prepend(navigation);
}

const lessonStudio = createLessonStudio($('lesson-studio'), {
  openBench(id) {
    if (loadedLesson === id) {
      setPage('bench');
      showPanel(
        id === 'reflection-calibration' || id === 'transmission-normalization'
          ? 'calibration'
          : 'sweep',
      );
    } else loadExercise(id);
    $('guided-context').hidden = false;
    $('guided-context-title').textContent =
      lessons.find((l) => l.id === id)?.title ?? 'Guided exercise';
  },
  openInstrument(id) {
    setPage('instrument');
    selectPart(id);
    focusPartView(id);
  },
  getSnapshot: getLabSnapshot,
});
function getLabSnapshot(): LabSnapshot {
  const marker = markerReadout(points, markerHz, parameter);
  return {
    dut,
    parameter,
    format,
    sweep: { ...sweep },
    markerHz,
    solStandards: (['open', 'short', 'load'] as const).filter((s) =>
      Boolean(calibration.standards[s]),
    ),
    solActive: calibrationComplete(calibration, sweep),
    thruActive: referenceEnabled,
    markerDb: Number.isFinite(marker.magnitudeDb) ? marker.magnitudeDb : null,
    phaseDeg: marker.phaseDegrees,
    groupDelaySeconds: marker.groupDelaySeconds,
    calibrationInvalidated,
    exportCount,
    visitedParts: [...visitedParts],
  };
}
function frequency(hz: number): string {
  return hz >= 1e9
    ? `${(hz / 1e9).toFixed(3)} GHz`
    : hz >= 1e6
      ? `${(hz / 1e6).toFixed(2)} MHz`
      : `${(hz / 1e3).toFixed(1)} kHz`;
}
function notify(message: string) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => $('toast').classList.remove('show'), 4000);
}
function setPage(next: Page, focus = true) {
  page = next;
  lessonStudio.setActive(next === 'learn');
  if (next === 'learn') lessonStudio.refresh();
  document
    .querySelectorAll<HTMLElement>('.page')
    .forEach((el) => (el.hidden = el.id !== `page-${next}`));
  document.querySelectorAll<HTMLElement>('.nav-item').forEach((el) => {
    const active = el.dataset.page === next;
    el.classList.toggle('active', active);
    if (active) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  document.querySelectorAll<HTMLElement>('.embedded-vna-nav button').forEach(el => {
    if (el.dataset.page === next) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  $('page-label').textContent = {
    bench: 'Practice bench',
    instrument: 'Instrument tour',
    learn: 'Guided lessons',
    resources: 'Learning resources',
  }[next];
  if (next === 'instrument' && !model) {
    model = createInstrument($('model-view'), screen, selectPart);
    selectPart(selectedPart, false);
  }
  if (next === 'instrument') draw();
  if (next === 'bench') draw();
  if (focus) {
    $('workspace').focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
}
function selectPart(id: string, track = true) {
  const part = instrumentParts.find((p) => p.id === id);
  if (!part) return;
  selectedPart = id;
  if (track) visitedParts.add(id);
  $<HTMLSelectElement>('part-select').value = id;
  $('part-number').textContent =
    `${String(instrumentParts.indexOf(part) + 1).padStart(2, '0')} / ${part.side.toUpperCase()} PANEL`;
  $('part-title').textContent = part.title;
  $('part-description').textContent = part.description;
  $('part-tip').textContent = part.tip;
  if (part.side === 'rear' && cameraView !== 'rear') setCamera('rear');
  else if (part.side === 'front' && cameraView === 'rear') setCamera('angle');
  if (focusedPart || ['screen', 'controls', 'ports'].includes(cameraView)) focusPartView(id);
  model?.setHighlight(id);
}
function setCamera(view: 'angle' | 'front' | 'rear' | 'screen' | 'controls' | 'ports') {
  cameraView = view;
  focusedPart = false;
  model?.setView(view);
  document.querySelectorAll<HTMLElement>('[data-view]').forEach((el) => {
    const active = el.dataset.view === view;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', String(active));
  });
}
function focusPartView(id: string) {
  const part = instrumentParts.find((p) => p.id === id);
  if (!part) return;
  const view =
    part.side === 'rear'
      ? 'rear'
      : id === 'screen'
        ? 'screen'
        : ['port1', 'port2'].includes(id)
          ? 'ports'
          : 'controls';
  setCamera(view);
  model?.focusPart(id);
  focusedPart = true;
}
function showPanel(panel: string) {
  for (const p of ['sweep', 'calibration']) $(`panel-${p}`).hidden = p !== panel;
  document.querySelectorAll<HTMLElement>('[data-panel]').forEach((el) => {
    el.classList.toggle('active', el.dataset.panel === panel);
    el.setAttribute('aria-pressed', String(el.dataset.panel === panel));
  });
}
function updateCalibration() {
  const done = calibrationComplete(calibration, sweep);
  $('cal-summary').textContent = done ? 'Port 1 S11: SOL corrected' : 'Port 1 S11: uncorrected';
  $('cal-dot').classList.toggle('amber', !done);
  let n = 0;
  for (const s of ['open', 'short', 'load'] as const) {
    const captured = Boolean(calibration.standards[s]);
    n += Number(captured);
    $(`cal-${s}`).textContent = captured ? 'Captured ✓' : 'Capture standard';
  }
  $('cal-status').textContent = done
    ? '3 of 3 · Port 1 S11 correction ready'
    : `${n} of 3 standards captured`;
}
function finishSweep(state = 'READY') {
  running = false;
  cancelAnimationFrame(animation);
  $('sweep-state').textContent = state;
  $<HTMLButtonElement>('pause-sweep').disabled = true;
}
function updateData(animate = false) {
  benchRevision++;
  finishSweep();
  const onePort = DUTS.find((d) => d.id === dut)!.ports === 1;
  if (onePort) parameter = 's11';
  syncTraceButtons();
  points = sampleSweep(sweep, dut, calibration);
  if (referenceEnabled && throughReference)
    points = applyTransmissionReference(points, throughReference);
  markerHz = Math.max(sweep.startHz, Math.min(sweep.stopHz, markerHz));
  secondaryMarkerHz = Math.max(sweep.startHz, Math.min(sweep.stopHz, secondaryMarkerHz));
  for (const id of ['marker2']) {
    const el = $<HTMLInputElement>(id);
    el.min = String(sweep.startHz / 1e6);
    el.max = String(sweep.stopHz / 1e6);
    el.value = String(secondaryMarkerHz / 1e6);
  }
  $('port2-path').hidden = onePort;
  $('port2-cable').hidden = onePort;
  $('network-insights').hidden = onePort || (parameter !== 's21' && parameter !== 's12');
  $('reflection-insights').hidden = parameter !== 's11' && parameter !== 's22';
  $<HTMLInputElement>('marker').value = String(markerHz / 1e6);
  $<HTMLInputElement>('marker').min = String(sweep.startHz / 1e6);
  $<HTMLInputElement>('marker').max = String(sweep.stopHz / 1e6);
  const d = DUTS.find((d) => d.id === dut)!;
  $('dut-name').textContent = d.title;
  $('export-touchstone').innerHTML = `${icon('download')} Export Touchstone (.s${d.ports}p)`;
  $('dut-description').textContent = d.description;
  $('acquisition-caption').textContent =
    `${sweep.points} points · IF BW ${ifBandwidth / 1000} kHz · ${power} dBm`;
  $('trace-caption').textContent =
    `${parameter.toUpperCase()} · ${calibrationComplete(calibration, sweep) ? 'Port 1 S11 SOL on' : 'reflection uncorrected'} · ${referenceEnabled ? 'relative THRU on' : 'idealized transmission'}`;
  $('parameter-explanation').textContent = {
    s11: 'S11: reflection at port 1 with port 2 terminated in the reference impedance.',
    s21: 'S21: forward transmission — the wave leaving port 2 relative to the wave incident at port 1.',
    s12: 'S12: reverse transmission — the wave leaving port 1 relative to the wave incident at port 2.',
    s22: 'S22: reflection at port 2 with port 1 terminated in the reference impedance.',
  }[parameter];
  const limit = phaseSamplingLimitSeconds(points);
  const outsideSmith =
    format === 'smith' &&
    points.some((p) => Math.hypot(p[parameter].re, p[parameter].im) > 1 + 1e-9);
  $('sampling-warning').hidden = !(outsideSmith || format === 'phase' || format === 'groupdelay');
  $('sampling-warning').textContent = outsideSmith
    ? parameter === 's11'
      ? 'Some uncorrected simulated reflection values lie outside |Γ| = 1 and are clipped from the Smith chart. Perform Port 1 SOL, or inspect magnitude to see them.'
      : 'Some S22 values lie outside |Γ| = 1 and are clipped. Port 1 SOL does not correct S22; inspect magnitude to see the uncorrected model.'
    : limit
      ? 'This grid resolves unambiguous local phase delays only below approximately ' +
        (limit * 1e9).toFixed(2) +
        ' ns. Group delay is a sampled estimate; use more points or a narrower sweep when phase changes quickly.'
      : '';
  if (onePort)
    $('parameter-explanation').textContent =
      'One-port termination at Port 1. Only S11 is defined for this exercise; Port 2 and transmission traces are not used.';
  $('reconnect-dut').hidden = returnDut === null;
  $('reconnect-dut').textContent = 'Reconnect ' + (DUTS.find((d) => d.id === returnDut)?.title ?? 'DUT');
  updateInsights();
  updateSetupPending();
  updateCalibration();
  if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    cancelAnimationFrame(animation);
    running = true;
    $('sweep-state').textContent = 'SWEEPING';
    $<HTMLButtonElement>('pause-sweep').disabled = false;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / 650);
      draw(progress);
      if (progress < 1 && running) animation = requestAnimationFrame(step);
      else {
        finishSweep();
        draw();
      }
    };
    animation = requestAnimationFrame(step);
  } else draw();
}

function valueAt(index: number): number {
  return traceValue(points, index, parameter, format === 'smith' ? 'logmag' : format);
}
function draw(progress = 1) {
  const display = $<HTMLCanvasElement>('plot');
  const compact = page === 'bench' && display.clientWidth > 0 && display.clientWidth < 520;
  const chartHeight = compact ? 1000 : 720;
  if (screen.height !== chartHeight) screen.height = chartHeight;
  if (display.height !== chartHeight) display.height = chartHeight;
  display.style.aspectRatio = `1280 / ${chartHeight}`;
  $('plot-range-note').hidden = true;
  const memory = memoryUsable() ? traceMemory : null;
  const c = screen.getContext('2d')!;
  const w = screen.width,
    h = screen.height;
  c.fillStyle = '#0d1d2a';
  c.fillRect(0, 0, w, h);
  c.font = `${compact ? 38 : 24}px system-ui`;
  c.fillStyle = '#a6bacb';
  c.fillText(
    `Trc 1   ${parameter.toUpperCase()}   ${format === 'smith' ? 'SMITH / 50 Ω' : format.toUpperCase()}`,
    40,
    compact ? 45 : 40,
  );
  c.textAlign = 'right';
  c.fillStyle = '#71d6d3';
  c.fillText('M1  ' + frequency(markerHz), w - 40, compact ? 90 : 40);
  c.textAlign = 'left';
  const left = compact ? 170 : 110,
    top = compact ? 140 : 82,
    right = w - 42,
    bottom = h - (compact ? 150 : memory ? 135 : 90),
    pw = right - left,
    ph = bottom - top;
  const xAt = (f: number) =>
    left +
    (sweep.spacing === 'log'
      ? Math.log(f / sweep.startHz) / Math.log(sweep.stopHz / sweep.startHz)
      : (f - sweep.startHz) / (sweep.stopHz - sweep.startHz)) *
      pw;
  if (format === 'smith') {
    const r = Math.min(pw, ph) / 2 - 12,
      cx = (left + right) / 2,
      cy = (top + bottom) / 2;
    c.save();
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.clip();
    c.strokeStyle = '#2b4556';
    c.lineWidth = 1.3;
    for (const resistance of [0, 0.2, 0.5, 1, 2, 5]) {
      c.beginPath();
      c.arc(cx + (r * resistance) / (1 + resistance), cy, r / (1 + resistance), 0, Math.PI * 2);
      c.stroke();
    }
    for (const reactance of [0.2, 0.5, 1, 2, 5])
      for (const sign of [-1, 1]) {
        c.beginPath();
        c.arc(cx + r, cy - (sign * r) / reactance, r / reactance, 0, Math.PI * 2);
        c.stroke();
      }
    c.beginPath();
    c.moveTo(cx - r, cy);
    c.lineTo(cx + r, cy);
    c.stroke();
    c.beginPath();
    if (memory) {
      c.strokeStyle = '#edb4fa';
      c.lineWidth = compact ? 5 : 2.5;
      c.setLineDash([12, 10]);
      memory.points.forEach((p, i) => {
        const z = p[parameter];
        const x = cx + z.re * r, y = cy - z.im * r;
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      });
      c.stroke();
      c.setLineDash([]);
      c.beginPath();
    }
    c.strokeStyle = '#f7cf65';
    c.lineWidth = compact ? 6 : 3;
    points.slice(0, Math.max(1, Math.floor(points.length * progress))).forEach((p, i) => {
      const z = p[parameter];
      const x = cx + z.re * r,
        y = cy - z.im * r;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    });
    c.stroke();
    const z = markerAt(points, markerHz)[parameter];
    c.beginPath();
    c.fillStyle = '#7de2df';
    c.arc(cx + z.re * r, cy - z.im * r, 7, 0, Math.PI * 2);
    c.fill();
    if (secondaryMarkerEnabled) {
      const b = markerAt(points, secondaryMarkerHz)[parameter];
      c.fillStyle = '#edb4fa';
      c.beginPath();
      c.arc(cx + b.re * r, cy - b.im * r, 7, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    c.fillStyle = '#91aabb';
    c.fillText(compact ? 'Γ = 0 at center' : 'Γ = 0 · matched center', left, bottom + 50);
    c.textAlign = 'right';
    c.fillText(compact ? '|Γ| = 1' : 'Outer circle: |Γ| = 1', right, bottom + 50);
    c.textAlign = 'left';
  } else {
    let yMin = -60,
      yMax = 10,
      unit = 'dB';
    if (format === 'phase') {
      yMin = -180;
      yMax = 180;
      unit = '°';
    }
    if (format === 'vswr') {
      yMin = 1;
      yMax = 10;
      unit = ':1';
    }
    if (format === 'groupdelay') {
      yMin = 0;
      yMax = 10;
      unit = 'ns';
      const values = points.map((_, i) => valueAt(i) * 1e9).filter(Number.isFinite);
      yMax = Math.max(5, Math.ceil(Math.max(...values) / 5) * 5);
      yMin = Math.min(0, Math.floor(Math.min(...values) / 5) * 5);
    }
    if (autoScale && format !== 'phase') {
      const values = points
        .map((_, i) => valueAt(i) * (format === 'groupdelay' ? 1e9 : 1))
        .filter(Number.isFinite);
      if (memory) values.push(...memory.points.map((_, i) =>
        traceValue(memory.points, i, parameter, format === 'smith' ? 'logmag' : format) * (format === 'groupdelay' ? 1e9 : 1)
      ).filter(Number.isFinite));
      if (values.length) {
        const lo = Math.min(...values),
          hi = Math.max(...values),
          padding = Math.max(
            (hi - lo) * 0.14,
            format === 'vswr' ? 0.2 : format === 'logmag' ? 1 : 0.1,
          );
        yMin = format === 'vswr' ? Math.max(1, lo - padding) : lo - padding;
        yMax = hi + padding;
      }
    }
    const scale = (v: number) => (format === 'groupdelay' ? v * 1e9 : v);
    // Keep finite coordinates true to the data; canvas clipping handles off-scale values.
    // Clamping here would fabricate a flat trace along the display boundary.
    const yAt = (v: number) => bottom - ((scale(v) - yMin) / (yMax - yMin)) * ph;
    const offscale = points.filter((_, i) => {
      const v = scale(valueAt(i));
      return !Number.isNaN(v) && (v < yMin || v > yMax);
    }).length;
    const memoryOffscale = memory?.points.filter((_, i) => {
      const v = scale(traceValue(memory.points, i, parameter, format === 'smith' ? 'logmag' : format));
      return !Number.isNaN(v) && (v < yMin || v > yMax);
    }).length ?? 0;
    $('plot-range-note').hidden = offscale === 0 && memoryOffscale === 0;
    $('plot-range-note').textContent = offscale + ' live' + (memory ? ' and ' + memoryOffscale + ' stored' : '') + ' sampled values are outside the vertical range; they are not drawn at the border. Try Auto scale or inspect the marker readout.';
    for (let i = 0; i <= 10; i++) {
      const x = left + (i * pw) / 10;
      c.strokeStyle = i === 0 ? '#486174' : '#263e50';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x, top);
      c.lineTo(x, bottom);
      c.stroke();
      if (i % (compact ? 5 : 2) === 0) {
        const f =
          sweep.spacing === 'log'
            ? sweep.startHz * Math.pow(sweep.stopHz / sweep.startHz, i / 10)
            : sweep.startHz + ((sweep.stopHz - sweep.startHz) * i) / 10;
        c.fillStyle = '#91aabb';
        c.textAlign = i === 0 ? 'left' : i === 10 ? 'right' : 'center';
        c.fillText(frequency(f), x, bottom + 40);
      }
    }
    c.textAlign = 'right';
    for (let i = 0; i <= 8; i++) {
      const y = top + (i * ph) / 8;
      c.strokeStyle = '#263e50';
      c.beginPath();
      c.moveTo(left, y);
      c.lineTo(right, y);
      c.stroke();
      c.fillStyle = '#91aabb';
      const v = yMax - ((yMax - yMin) * i) / 8;
      if (!compact || i % 2 === 0) c.fillText(`${Number(v.toFixed(1))}${unit}`, left - 18, y + 6);
    }
    c.textAlign = 'left';
    c.save();
    c.beginPath();
    c.rect(left, top, pw, ph);
    c.clip();
    if (memory) {
      c.beginPath();
      c.strokeStyle = '#edb4fa';
      c.lineWidth = compact ? 5 : 2.5;
      c.setLineDash([12, 10]);
      let pen = false, last = 0;
      memory.points.forEach((p, i) => {
        const v = traceValue(memory.points, i, parameter, format === 'smith' ? 'logmag' : format);
        if (!Number.isFinite(v)) { pen = false; return; }
        const x = xAt(p.frequencyHz), y = yAt(v);
        if (!pen || (format === 'phase' && Math.abs(v - last) > 180)) c.moveTo(x, y);
        else c.lineTo(x, y);
        pen = true; last = v;
      });
      c.stroke();
      c.setLineDash([]);
    }
    c.beginPath();
    c.strokeStyle = '#f7cf65';
    c.lineWidth = compact ? 6 : 3;
    let pen = false,
      last = 0;
    for (let i = 0; i < Math.floor(points.length * progress); i++) {
      const v = valueAt(i),
        x = xAt(points[i].frequencyHz),
        y = yAt(v);
      if (!Number.isFinite(v)) {
        pen = false;
        continue;
      }
      if (!pen || (format === 'phase' && Math.abs(v - last) > 180)) c.moveTo(x, y);
      else c.lineTo(x, y);
      pen = true;
      last = v;
    }
    c.stroke();
    c.restore();
    const x = xAt(markerHz);
    c.strokeStyle = '#6ed6d8';
    c.setLineDash([5, 7]);
    c.beginPath();
    c.moveTo(x, top);
    c.lineTo(x, bottom);
    c.stroke();
    c.setLineDash([]);
    const v = markerTraceValue(points, markerHz, parameter, format);
    if (Number.isFinite(v) && scale(v) >= yMin && scale(v) <= yMax) {
      c.beginPath();
      c.fillStyle = '#7de2df';
      c.arc(x, yAt(v), 6, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#7de2df';
    c.fillText('M1', Math.min(right - 30, x + 10), top + 24);
    if (secondaryMarkerEnabled) {
      const bx = xAt(secondaryMarkerHz),
        bv = markerTraceValue(points, secondaryMarkerHz, parameter, format);
      c.strokeStyle = '#edb4fa';
      c.setLineDash([3, 7]);
      c.beginPath();
      c.moveTo(bx, top);
      c.lineTo(bx, bottom);
      c.stroke();
      c.setLineDash([]);
      if (Number.isFinite(bv) && scale(bv) >= yMin && scale(bv) <= yMax) {
        c.fillStyle = '#edb4fa';
        c.beginPath();
        c.arc(bx, yAt(bv), 6, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = '#edb4fa';
      c.fillText('M2', Math.min(right - 30, bx + 10), top + 48);
    }
  }
  c.fillStyle = '#6f8b9d';
  if (memory) {
    c.fillStyle = '#edb4fa';
    c.font = `${compact ? 26 : 17}px system-ui`;
    c.fillText('DASHED MEMORY · ' + memory.parameter.toUpperCase() + ' · ' + memory.dutTitle, 40, h - 52);
    c.fillStyle = '#6f8b9d';
  }
  c.font = `${compact ? 29 : 17}px system-ui`;
  c.fillText(compact ? 'SIMULATED RESPONSE · NO HARDWARE' : 'EDUCATIONAL SIMULATION · NOT A HARDWARE MEASUREMENT', 40, h - 22);
  display.getContext('2d')!.drawImage(screen, 0, 0);
  model?.updateScreen();
  updateReadout();
}
function updateInsights() {
  const selected = parameter === 's12' ? 's12' : 's21';
  const result = analyzeTransmissionPassband(points, selected);
  const peak = findSampledMagnitudeExtreme(points, selected, 'max', markerHz);
  $('passband-heading').textContent = selected.toUpperCase() + ' · sampled −3 dB passband';
  $('passband-readout').innerHTML = [
    [
      'SAMPLED PEAK',
      peak?.flat ? 'Flat response' : result.peakFrequencyHz === null ? 'Not defined' : frequency(result.peakFrequencyHz),
    ],
    ['LOWER EDGE', result.lowHz === null ? 'Outside sweep' : frequency(result.lowHz)],
    ['UPPER EDGE', result.highHz === null ? 'Outside sweep' : frequency(result.highHz)],
    ['BANDWIDTH', result.bandwidthHz === null ? 'Incomplete range' : frequency(result.bandwidthHz)],
  ]
    .map(
      ([label, value]) => '<div><small>' + label + '</small><strong>' + value + '</strong></div>',
    )
    .join('');
  $('passband-note').textContent =
    result.status === 'complete'
      ? 'Edges are interpolated at 3.00 dB below the sampled ' + selected.toUpperCase() + ' peak. This describes the main contiguous peak region of the generated response.'
      : 'Both −3 dB edges must lie inside the sweep to estimate bandwidth. Flat paths, low-pass traces or limited sweeps may have no complete passband here.';
}
function metric(value: number | null, unit: string, decimals = 2): string {
  return value === null ? 'Not applicable' : value === Infinity ? '∞' + unit : value.toFixed(decimals) + unit;
}
function updateReflection() {
  if (parameter !== 's11' && parameter !== 's22') return;
  const r = analyzeReflection(points, markerHz, parameter);
  $('reflection-heading').textContent = parameter.toUpperCase() + ' · what comes back?';
  $('reflection-readout').innerHTML = [
    ['RETURN LOSS', metric(r.returnLossDb, ' dB')],
    ['REFLECTED POWER', metric(r.reflectedPowerPercent, '%')],
    ['ACCEPTED AT INPUT', metric(r.acceptedPowerPercent, '%')],
    ['MISMATCH LOSS', metric(r.mismatchLossDb, ' dB')],
  ].map(([label, value]) => `<div><small>${label}</small><strong>${value}</strong></div>`).join('');
  $('reflection-note').textContent = r.warning ??
    'For a real 50 Ω reference with the other port matched: reflected power = |Γ|²; return loss = −20 log₁₀|Γ|. Accepted-at-input power is not the same as transmitted or dissipated power. ' +
    (parameter === 's11' && calibrationComplete(calibration, sweep) ? 'Port 1 SOL is applied.' : 'This reflection is uncorrected; these are model readouts, not a passivity test.');
}
function memoryUsable(): boolean {
  return showMemory && getMemoryCompatibility(traceMemory, points, parameter).usable;
}
function updateMemoryReadout() {
  const compatible = getMemoryCompatibility(traceMemory, points, parameter);
  $<HTMLButtonElement>('show-memory').disabled = !compatible.usable;
  $('show-memory').setAttribute('aria-pressed', String(memoryUsable()));
  $('show-memory').textContent = !traceMemory ? 'Show stored' : !compatible.usable ? 'Stored unavailable' : showMemory ? 'Stored visible' : 'Stored hidden';
  $<HTMLButtonElement>('clear-memory').disabled = !traceMemory;
  $('memory-status').textContent = traceMemory
    ? traceMemory.parameter.toUpperCase() + ' · ' + traceMemory.dutTitle + ' · ' + traceMemory.correctionLabel + '. ' + (compatible.usable ? (showMemory ? 'Dashed stored trace overlaid.' : 'Overlay hidden; comparison retained.') : compatible.reason)
    : 'Store a trace to compare DUTs or correction on the same frequency grid. Stored traces stay in this page only.';
  $('memory-comparison').hidden = !compatible.usable;
  if (compatible.usable && traceMemory) {
    const result = compareTraceMemory(points, traceMemory, markerHz);
    $('memory-comparison').textContent = 'At M1 · stored ' + formatMagnitude(result.stored) +
      ' · live − stored ' + (result.deltaMagnitudeDb === null ? 'not defined at display floor' : (result.deltaMagnitudeDb >= 0 ? '+' : '') + result.deltaMagnitudeDb.toFixed(2) + ' dB');
  }
}
function jumpToBench(id: string) {
  $(id).scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  const focus = id === 'bench-controls' ? $('dut') : id === 'bench-notes' ? $('student-notes') : $('plot');
  focus.focus({ preventScroll: true });
}
function prepareRange(next: typeof sweep) {
  $<HTMLInputElement>('start').value = String(next.startHz / 1e6);
  $<HTMLInputElement>('stop').value = String(next.stopHz / 1e6);
  $('form-error').textContent = '';
  showPanel('sweep');
  updateSetupPending();
  jumpToBench('bench-controls');
  notify(settingsDirty ? 'Range prepared. Run sweep to apply; stored data and correction still use the last applied setup.' : 'That range is already applied.');
}
function updateReadout() {
  const r = markerReadout(points, markerHz, parameter);
  $('read-frequency').textContent = frequency(markerHz);
  $('read-value-label').textContent = `${parameter.toUpperCase()} MAGNITUDE`;
  $('read-value').textContent = formatMagnitude(r);
  $('read-phase').textContent = formatPhase(r.phaseDegrees);
  const reflection = parameter === 's11' || parameter === 's22';
  $('read-extra-label').textContent = reflection ? 'VSWR' : 'GROUP DELAY';
  $('read-extra').textContent = reflection
    ? formatVSWR(r.standingWaveRatio)
    : formatDelay(r.groupDelaySeconds);
  $('marker-comparison').hidden = !secondaryMarkerEnabled;
  $<HTMLButtonElement>('clear-reference-marker').disabled = !secondaryMarkerEnabled;
  if (secondaryMarkerEnabled) {
    const result = compareMarkers(points, markerHz, secondaryMarkerHz, parameter);
    $('reference-frequency').textContent = frequency(secondaryMarkerHz);
    $('difference-frequency').textContent =
      (result.deltaFrequencyHz < 0 ? '−' : '+') + frequency(Math.abs(result.deltaFrequencyHz));
    $('difference-magnitude').textContent =
      result.deltaMagnitudeDb === null
        ? 'Not defined'
        : (result.deltaMagnitudeDb >= 0 ? '+' : '') + result.deltaMagnitudeDb.toFixed(2) + ' dB';
  }
  updateReflection();
  updateMemoryReadout();
  $<HTMLButtonElement>('range-from-markers').disabled = !secondaryMarkerEnabled || markerHz === secondaryMarkerHz;
  $<HTMLButtonElement>('previous-sample').disabled = markerHz <= sweep.startHz;
  $<HTMLButtonElement>('next-sample').disabled = markerHz >= sweep.stopHz;
  const summary =
    parameter.toUpperCase() +
    ' at ' +
    frequency(markerHz) +
    ': ' +
    formatMagnitude(r) +
    ', phase ' +
    formatPhase(r.phaseDegrees) +
    (secondaryMarkerEnabled ? '; M2 reference ' + frequency(secondaryMarkerHz) : '');
  if ($('marker-accessible-summary').textContent !== summary)
    $('marker-accessible-summary').textContent = summary;
}
function changeFormat(next: Format) {
  format = next;
  if ((next === 'smith' || next === 'vswr') && (parameter === 's21' || parameter === 's12')) {
    parameter = 's11';
    notify('Reflection format selected · showing S11.');
  }
  syncTraceButtons();
  updateData();
}
function syncTraceButtons() {
  document.querySelectorAll<HTMLElement>('[data-parameter]').forEach((el) => {
    el.classList.toggle('active', el.dataset.parameter === parameter);
    el.setAttribute('aria-pressed', String(el.dataset.parameter === parameter));
    const unavailable =
      DUTS.find((d) => d.id === dut)!.ports === 1 && el.dataset.parameter !== 's11';
    (el as HTMLButtonElement).disabled = unavailable;
    el.title = unavailable ? 'This one-port exercise defines S11 only.' : '';
  });
  $<HTMLSelectElement>('format').value = format;
}
function setMarker(hz: number) {
  if (!Number.isFinite(hz) || hz < sweep.startHz || hz > sweep.stopHz) {
    notify('Choose a marker inside the current sweep.');
    $<HTMLInputElement>('marker').value = String(markerHz / 1e6);
    return;
  }
  finishSweep();
  markerHz = hz;
  $<HTMLInputElement>('marker').value = String(hz / 1e6);
  draw();
}
function syncSetup(force = false) {
  for (const [id, value] of Object.entries({
    start: sweep.startHz / 1e6,
    stop: sweep.stopHz / 1e6,
    points: sweep.points,
    spacing: sweep.spacing,
    dut,
    power,
    bandwidth: ifBandwidth,
  }))
    if (force || !settingsDirty || id === 'dut') $<HTMLInputElement>(id).value = String(value);
  updateSetupPending();
}

function clearReference() {
  throughReference = null;
  referenceEnabled = false;
  $<HTMLInputElement>('enable-thru').checked = false;
  $<HTMLInputElement>('enable-thru').disabled = true;
  $('thru-status').textContent =
    'No reference captured. This response normalization is not a full two-port calibration.';
}
function loadExercise(which: string) {
  finishSweep();
  settingsDirty = false;
  calibrationInvalidated = false;
  exportCount = 0;
  returnDut = null;
  secondaryMarkerEnabled = false;
  loadedLesson = which;
  sweep = { ...DEFAULT_SWEEP };
  const isCal = which === 'calibration' || which === 'reflection-calibration';
  dut =
    which === 'reflection'
      ? 'mismatch'
      : which === 'transmission'
        ? 'attenuator'
        : isCal
          ? 'load'
          : which === 'getting-started' || which === 'transmission-normalization'
            ? 'through'
            : 'bandpass';
  parameter = which === 'reflection' || isCal ? 's11' : 's21';
  format = which === 'reflection' ? 'smith' : 'logmag';
  if (which === 'filter' || which === 'filter-investigation') {
    sweep = { ...sweep, startHz: 1.5e9, stopHz: 3.3e9 };
    markerHz = 2.4e9;
  }
  calibration = createCalibration(sweep);
  clearReference();
  syncSetup();
  syncTraceButtons();
  updateData();
  setPage('bench');
  showPanel(isCal || which === 'transmission-normalization' ? 'calibration' : 'sweep');
  notify('Practice exercise loaded. All responses are simulated.');
}
let resourceTopic = 'all';
function renderResources() {
  const query = $<HTMLInputElement>('resource-search').value.toLowerCase().trim();
  const matches = resources.filter(
    (r) =>
      (resourceTopic === 'all' || r.topic.toLowerCase().includes(resourceTopic)) &&
      `${r.title} ${r.description} ${r.topic}`.toLowerCase().includes(query),
  );
  $('resource-count').textContent = `${matches.length} references`;
  $('resource-grid').innerHTML = matches.length
    ? matches
        .map(
          (r, i) =>
            `<a class="resource-card" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer"><span class="resource-kicker">${esc(r.source)} <b>${icon('link')}</b></span><span class="resource-kind">${esc(r.kind)}</span><h3>${esc(r.title)}</h3><p>${esc(r.description)}</p><div class="resource-card-bottom"><span>${esc(r.topic)}</span><span>OPEN REFERENCE ${icon('arrow')}</span></div><span class="resource-watermark">${String(i + 1).padStart(2, '0')}</span></a>`,
        )
        .join('')
    : '<div class="empty-state">No matching references. Try “calibration”, “S-parameters” or clear the search.</div>';
}
function download(name: string, text: string, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  notify(`${name} is ready to save.`);
}
function exportTouchstone() {
  if (settingsDirty) {
    notify('Apply or discard setup changes before export.');
    return;
  }
  exportCount++;
  const device = DUTS.find((d) => d.id === dut)!;
  const file = createTouchstone(points, {
    dutId: dut,
    ports: device.ports,
    port1Sol: calibrationComplete(calibration, sweep),
    relativeThru: referenceEnabled,
  });
  download(file.filename, file.text);
}
function saveReport() {
  if (settingsDirty) {
    notify('Apply or discard setup changes before export.');
    return;
  }
  exportCount++;
  const p = markerAt(points, markerHz);
  download(
    `VNA-${dut}-report.json`,
    JSON.stringify(
      {
        application: 'VNA Student Lab',
        version: '0.3',
        kind: 'educational-simulation-not-hardware-measurement',
        createdAt: new Date().toISOString(),
        referenceInstrument: 'ZNLE6 standard 1 MHz–6 GHz / 2 port / 50 ohm',
        dut,
        sweep,
        sourcePowerDbm: power,
        ifBandwidthHz: ifBandwidth,
        reflectionCorrection: calibrationComplete(calibration, sweep)
          ? 'simplified Port 1 S11 SOL; S22 remains uncorrected'
          : 'uncorrected model',
        transmission: referenceEnabled
          ? 'relative to stored virtual THRU; not full two-port calibrated'
          : 'idealized, not full two-port calibrated',
        selectedParameter: parameter,
        format,
        marker: p,
        studentNotes,
        reflectionAtMarker: parameter === 's11' || parameter === 's22' ? analyzeReflection(points, markerHz, parameter) : null,
        storedTrace: traceMemory ? { dutTitle: traceMemory.dutTitle, parameter: traceMemory.parameter, correctionLabel: traceMemory.correctionLabel, overlayShown: memoryUsable(), compatibility: getMemoryCompatibility(traceMemory, points, parameter), points: traceMemory.points } : null,
        storedComparison: getMemoryCompatibility(traceMemory, points, parameter).usable && traceMemory ? compareTraceMemory(points, traceMemory, markerHz) : null,
        secondaryMarker: secondaryMarkerEnabled
          ? markerReadout(points, secondaryMarkerHz, parameter)
          : null,
        markerComparison: secondaryMarkerEnabled
          ? compareMarkers(points, markerHz, secondaryMarkerHz, parameter)
          : null,
        passband:
          DUTS.find((d) => d.id === dut)!.ports === 2 && (parameter === 's21' || parameter === 's12') ? analyzeTransmissionPassband(points, parameter) : null,
      },
      (_key, value: unknown) => typeof value === 'number' && !Number.isFinite(value)
        ? value === Infinity ? 'Infinity' : value === -Infinity ? '-Infinity' : 'undefined'
        : value,
      2,
    ),
    'application/json',
  );
}

app.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('button,[data-page]');
  if (!target || target.closest('#lesson-studio')) return;
  if (target.dataset.page) {
    event.preventDefault();
    setPage(target.dataset.page as Page);
    return;
  }
  if (target.dataset.markerSearch) {
    const pick = findSampledMagnitudeExtreme(points, parameter, target.dataset.markerSearch as 'min' | 'max', markerHz);
    if (pick) {
      setMarker(pick.frequencyHz);
      notify(
        pick.flat ? 'Magnitude is flat across the sweep; nearest sampled point selected.' : `${target.dataset.markerSearch === 'max' ? 'Maximum' : 'Minimum'} sampled magnitude: ${frequency(markerHz)}${pick.belowDisplayFloor ? ' · at or below the display floor' : ''}.`,
      );
    } else notify('Magnitude is zero throughout this trace; no distinct extremum is defined.');
    return;
  }
  if (target.dataset.benchJump) {
    jumpToBench(target.dataset.benchJump);
    return;
  }
  if (target.dataset.range) {
    const range = target.dataset.range;
    prepareRange({ ...sweep, startHz: range === 'filter' ? 1.5e9 : 1e6, stopHz: range === 'filter' ? 3.3e9 : range === 'low' ? 3e9 : 6e9 });
    return;
  }
  if (target.dataset.parameter) {
    parameter = target.dataset.parameter as Parameter;
    if ((format === 'smith' || format === 'vswr') && (parameter === 's12' || parameter === 's21'))
      format = 'logmag';
    syncTraceButtons();
    updateData();
  }
  if (target.dataset.panel) showPanel(target.dataset.panel);
  if (target.dataset.standard) {
    if (settingsDirty) {
      notify('Apply or discard setup changes before capturing a standard.');
      return;
    }
    if (returnDut === null) returnDut = dut;
    calibrationInvalidated = false;
    const standard = target.dataset.standard as 'open' | 'short' | 'load';
    calibration = recordStandard(calibration, standard);
    dut = standard;
    parameter = 's11';
    format = 'logmag';
    syncSetup();
    syncTraceButtons();
    updateData();
    notify(
      `${standard.toUpperCase()} virtual standard captured at port 1${calibrationComplete(calibration, sweep) ? ' · SOL correction ready' : ''}. Reconnect your DUT when finished.`,
    );
  }
  if (target.dataset.view) {
    setCamera(target.dataset.view as Parameters<typeof setCamera>[0]);
  }
  if (target.dataset.exercise) loadExercise(target.dataset.exercise);
  if (target.dataset.topic) {
    resourceTopic = target.dataset.topic;
    document.querySelectorAll<HTMLElement>('[data-topic]').forEach((el) => {
      el.classList.toggle('active', el === target);
      el.setAttribute('aria-pressed', String(el === target));
    });
    renderResources();
  }
});
$('sweep-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const next = {
    startHz: Number($<HTMLInputElement>('start').value) * 1e6,
    stopHz: Number($<HTMLInputElement>('stop').value) * 1e6,
    points: Number($<HTMLSelectElement>('points').value),
    spacing: $<HTMLSelectElement>('spacing').value as 'linear' | 'log',
  };
  const errors = validateSweep(next);
  $('form-error').textContent = errors.join(' ');
  if (errors.length) return;
  const changed =
    JSON.stringify(next) !== JSON.stringify(sweep) ||
    power !== Number($<HTMLSelectElement>('power').value) ||
    ifBandwidth !== Number($<HTMLSelectElement>('bandwidth').value);
  const hadCalibration = Object.keys(calibration.standards).length > 0 || Boolean(throughReference);
  sweep = next;
  power = Number($<HTMLSelectElement>('power').value);
  ifBandwidth = Number($<HTMLSelectElement>('bandwidth').value);
  if (changed) {
    calibrationInvalidated = hadCalibration;
    calibration = createCalibration(sweep);
    clearReference();
    if (hadCalibration) notify('Applied setup changed · virtual calibration and THRU reference cleared.');
  }
  settingsDirty = false;
  updateSetupPending();
  updateData(true);
});
$('pause-sweep').addEventListener('click', () => {
  finishSweep('STOPPED');
  draw();
  notify('Sweep stopped. Showing the last complete calculated response.');
});
$('dut').addEventListener('change', () => {
  dut = $<HTMLSelectElement>('dut').value as DutId;
  returnDut = null;
  updateData(true);
});
$('format').addEventListener('change', () =>
  changeFormat($<HTMLSelectElement>('format').value as Format),
);
$('marker').addEventListener('input', () => {
  const hz = Number($<HTMLInputElement>('marker').value) * 1e6;
  if (Number.isFinite(hz) && hz >= sweep.startHz && hz <= sweep.stopHz) {
    markerHz = hz;
    finishSweep();
    draw();
  }
});
$('marker').addEventListener('change', () =>
  setMarker(Number($<HTMLInputElement>('marker').value) * 1e6),
);
$('plot').addEventListener('click', (event) => {
  if (format === 'smith') {
    notify('Use the marker frequency field for a Smith-chart point.');
    return;
  }
  const r = $('plot').getBoundingClientRect();
  const left = screen.height === 1000 ? 170 : 110;
  const fraction = Math.max(
    0,
    Math.min(1, (((event.clientX - r.left) / r.width) * screen.width - left) / (screen.width - 42 - left)),
  );
  setMarker(
    sweep.spacing === 'log'
      ? sweep.startHz * Math.pow(sweep.stopHz / sweep.startHz, fraction)
      : sweep.startHz + fraction * (sweep.stopHz - sweep.startHz),
  );
});
$('plot').addEventListener('keydown', (event) => {
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    setMarker(event.key === 'Home' ? sweep.startHz : sweep.stopHz);
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    const next =
      event.key === 'ArrowRight'
        ? points.find((p) => p.frequencyHz > markerHz)
        : [...points].reverse().find((p) => p.frequencyHz < markerHz);
    if (next) setMarker(next.frequencyHz);
  }
});
$('clear-cal').addEventListener('click', () => {
  calibration = createCalibration(sweep);
  updateData();
  notify('Virtual reflection calibration cleared.');
});
$('export-touchstone').addEventListener('click', exportTouchstone);
$('export-report').addEventListener('click', saveReport);
$('part-select').addEventListener('change', () =>
  selectPart($<HTMLSelectElement>('part-select').value),
);
$('resource-search').addEventListener('input', renderResources);
$('reset').addEventListener('click', () => {
  running = false;
  cancelAnimationFrame(animation);
  sweep = { ...DEFAULT_SWEEP };
  dut = 'bandpass';
  parameter = 's21';
  format = 'logmag';
  markerHz = 2.4e9;
  power = -10;
  ifBandwidth = 10000;
  calibration = createCalibration(sweep);
  clearReference();
  loadedLesson = null;
  syncSetup();
  syncTraceButtons();
  settingsDirty = false;
  secondaryMarkerEnabled = false;
  calibrationInvalidated = false;
  exportCount = 0;
  autoScale = false;
  $('autoscale').setAttribute('aria-pressed', 'false');
  $('autoscale').textContent = 'Auto scale';
  traceMemory = null;
  showMemory = true;
  returnDut = null;
  syncSetup(true);
  $('guided-context').hidden = true;
  $('form-error').textContent = '';
  $('sweep-state').textContent = 'READY';
  $<HTMLButtonElement>('pause-sweep').disabled = true;
  updateData();
  notify('Simulator reset. Your lesson review progress is kept.');
});
window.addEventListener('pagehide', (event) => {
  finishSweep('STOPPED');
  lessonStudio.setActive(false);
  if (!event.persisted) {
    plotObserver?.disconnect();
    cancelAnimationFrame(resizeFrame);
    model?.dispose();
    lessonStudio.dispose();
  }
});
$('capture-thru').addEventListener('click', () => {
  if (settingsDirty) {
    notify('Apply or discard setup changes before capturing a reference.');
    return;
  }
  if (returnDut === null && dut !== 'through') returnDut = dut;
  dut = 'through';
  throughReference = sampleSweep(sweep, dut, calibration);
  referenceEnabled = false;
  $<HTMLInputElement>('enable-thru').disabled = false;
  $<HTMLInputElement>('enable-thru').checked = false;
  $('thru-status').textContent =
    'Virtual THRU captured. Enable the reference to see relative S21/S12. Reflection is unchanged.';
  syncSetup();
  updateData();
  notify('Virtual through cable connected and captured.');
});
$('enable-thru').addEventListener('change', () => {
  referenceEnabled = $<HTMLInputElement>('enable-thru').checked && Boolean(throughReference);
  $('thru-status').textContent = referenceEnabled
    ? 'Relative transmission reference on. This removes the stored curve, not all hardware errors.'
    : 'Reference stored, correction off.';
  updateData();
});
$('clear-thru').addEventListener('click', () => {
  clearReference();
  updateData();
  notify('THRU reference cleared.');
});
function readSetupPending() {
  return (
    Number($<HTMLInputElement>('start').value) * 1e6 !== sweep.startHz ||
    Number($<HTMLInputElement>('stop').value) * 1e6 !== sweep.stopHz ||
    Number($<HTMLSelectElement>('points').value) !== sweep.points ||
    $<HTMLSelectElement>('spacing').value !== sweep.spacing ||
    Number($<HTMLSelectElement>('power').value) !== power ||
    Number($<HTMLSelectElement>('bandwidth').value) !== ifBandwidth
  );
}
function updateSetupPending() {
  settingsDirty = readSetupPending();
  $('pending-setup').hidden = !settingsDirty;
  $('display-card').classList.toggle('has-pending-setup', settingsDirty);
  $('applied-setup').textContent =
    'Applied: ' +
    frequency(sweep.startHz) +
    ' → ' +
    frequency(sweep.stopHz) +
    ' · ' +
    sweep.points +
    ' points';
  for (const id of ['capture-thru', 'export-touchstone', 'export-report', 'export-image', 'store-trace'])
    $<HTMLButtonElement>(id).disabled = settingsDirty;
  document
    .querySelectorAll<HTMLButtonElement>('[data-standard]')
    .forEach((b) => (b.disabled = settingsDirty));
}
$('sweep-form').addEventListener('input', updateSetupPending);
$('sweep-form').addEventListener('change', updateSetupPending);
$('discard-setup').addEventListener('click', () => {
  settingsDirty = false;
  syncSetup(true);
  $('form-error').textContent = '';
  notify('Last applied setup restored.');
});
$('autoscale').addEventListener('click', () => {
  autoScale = !autoScale;
  $('autoscale').setAttribute('aria-pressed', String(autoScale));
  $('autoscale').textContent = autoScale ? 'Auto scale on' : 'Auto scale';
  finishSweep();
  draw();
});
$('set-reference-marker').addEventListener('click', () => {
  secondaryMarkerEnabled = true;
  secondaryMarkerHz = markerHz;
  $<HTMLInputElement>('marker2').value = String(markerHz / 1e6);
  finishSweep();
  draw();
  notify('M2 fixed at the current frequency. Move M1 to compare.');
});
$('marker2').addEventListener('input', () => {
  const hz = Number($<HTMLInputElement>('marker2').value) * 1e6;
  if (Number.isFinite(hz) && hz >= sweep.startHz && hz <= sweep.stopHz) {
    secondaryMarkerEnabled = true;
    secondaryMarkerHz = hz;
    finishSweep();
    draw();
  }
});
$('marker2').addEventListener('change', () => {
  const hz = Number($<HTMLInputElement>('marker2').value) * 1e6;
  if (!Number.isFinite(hz) || hz < sweep.startHz || hz > sweep.stopHz) {
    notify('M2 must be inside the applied sweep.');
    $<HTMLInputElement>('marker2').value = String(secondaryMarkerHz / 1e6);
    return;
  }
  secondaryMarkerEnabled = true;
  secondaryMarkerHz = hz;
  finishSweep();
  draw();
});
$('clear-reference-marker').addEventListener('click', () => {
  secondaryMarkerEnabled = false;
  finishSweep();
  draw();
});
$('student-notes').addEventListener('input', () => {
  studentNotes = $<HTMLTextAreaElement>('student-notes').value.slice(0, 4000);
  $('notes-count').textContent = studentNotes.length + ' / 4,000';
});
$('add-observation').addEventListener('click', () => {
  const r = markerReadout(points, markerHz, parameter);
  studentNotes = (
    studentNotes +
    (studentNotes ? '\n' : '') +
    DUTS.find((d) => d.id === dut)!.title + ' · ' + parameter.toUpperCase() +
    ' at ' +
    frequency(markerHz) +
    ': ' +
    formatMagnitude(r) +
    ', phase ' +
    formatPhase(r.phaseDegrees) +
    '. ' +
    $('cal-summary').textContent +
    '. ' + (referenceEnabled ? 'Relative THRU on.' : 'No relative THRU.')
  ).slice(0, 4000);
  $<HTMLTextAreaElement>('student-notes').value = studentNotes;
  $('notes-count').textContent = studentNotes.length + ' / 4,000';
});
$('store-trace').addEventListener('click', () => {
  if (settingsDirty) return;
  finishSweep();
  traceMemory = storeTrace(points, { dutTitle: DUTS.find((d) => d.id === dut)!.title, parameter,
    correctionLabel: $('cal-summary').textContent + (referenceEnabled ? '; relative THRU on' : '; no THRU') });
  showMemory = true;
  draw();
  notify('Frozen trace stored. Change the DUT or correction to compare on this frequency grid.');
});
$('show-memory').addEventListener('click', () => { showMemory = !showMemory; finishSweep(); draw(); });
$('clear-memory').addEventListener('click', () => { traceMemory = null; finishSweep(); draw(); });
$('center-on-marker').addEventListener('click', () => {
  try { prepareRange(rangeCenteredOnMarker(sweep, markerHz)); } catch (e) { notify((e as Error).message); }
});
$('range-from-markers').addEventListener('click', () => {
  if (!secondaryMarkerEnabled) return;
  try { prepareRange(rangeFromMarkers(sweep, markerHz, secondaryMarkerHz)); } catch (e) { notify((e as Error).message); }
});
function stepMarker(direction: number) {
  const next = direction > 0 ? points.find((p) => p.frequencyHz > markerHz) : [...points].reverse().find((p) => p.frequencyHz < markerHz);
  if (next) setMarker(next.frequencyHz);
}
$('previous-sample').addEventListener('click', () => stepMarker(-1));
$('next-sample').addEventListener('click', () => stepMarker(1));
$('reconnect-dut').addEventListener('click', () => {
  if (returnDut === null) return;
  dut = returnDut;
  returnDut = null;
  syncSetup();
  updateData();
  notify('DUT reconnected on the applied frequency grid. Check the correction status before comparing.');
});
plotObserver = new ResizeObserver((entries) => {
  const width = entries[0]?.contentRect.width ?? 0;
  if (width <= 0 || Math.abs(width - plotWidth) < 0.5) return;
  plotWidth = width;
  cancelAnimationFrame(resizeFrame);
  // Chart height changes layout. Draw outside the observer's delivery cycle,
  // and only for width changes, to avoid resize-notification feedback loops.
  resizeFrame = requestAnimationFrame(() => { if (page === 'bench') draw(); });
});
plotObserver.observe($('plot'));
$('export-image').addEventListener('click', () => {
  if (settingsDirty) return;
  finishSweep();
  draw();
  const filename = 'VNA-' + dut + '-simulated-trace.png';
  const revision = benchRevision;
  const copy = document.createElement('canvas');
  copy.width = screen.width;
  copy.height = screen.height;
  copy.getContext('2d')!.drawImage(screen, 0, 0);
  copy.toBlob((blob) => {
    if (!blob) {
      notify('Image export is unavailable in this browser.');
      return;
    }
    const url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    if (benchRevision === revision) exportCount++;
    notify(filename + ' is ready to save.');
  }, 'image/png');
});
$('inspect-part').addEventListener('click', () => focusPartView(selectedPart));
$('try-part-control').addEventListener('click', () => {
  setPage('bench');
  const cal = ['calibration', 'port1', 'port2'].includes(selectedPart);
  showPanel(cal ? 'calibration' : 'sweep');
  const target =
    selectedPart === 'span' || selectedPart === 'frequency'
      ? 'start'
      : selectedPart === 'marker' || selectedPart === 'marker-search'
        ? 'marker'
        : selectedPart === 'bandwidth'
          ? 'bandwidth'
          : selectedPart === 'format'
            ? 'format'
            : selectedPart === 'measurement' || selectedPart === 'trace'
              ? 'dut'
              : cal
                ? 'panel-calibration'
                : 'sweep-form';
  $(target).scrollIntoView({
    block: 'center',
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
  });
  const focus = $<HTMLElement>(target);
  if (focus.matches('input,select,button')) focus.focus({ preventScroll: true });
});
$('part-lesson').addEventListener('click', () => {
  lessonStudio.openLesson(
    selectedPart === 'calibration'
      ? 'reflection-calibration'
      : ['marker', 'marker-search', 'scale', 'format', 'trace'].includes(selectedPart)
        ? 'filter-investigation'
        : 'getting-started',
  );
  setPage('learn');
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    finishSweep();
    draw();
    lessonStudio.setActive(page === 'learn');
  }
});
updateData();
renderResources();
selectPart('screen', false);
setCamera('angle');
setPage(page, false);
