import './lessons.css';
import { lessons, lessonQuizzes } from './content';
import {
  emptyProgress,
  evaluatePractice,
  jumpToStep,
  LESSON_STORAGE_KEY,
  MAX_NOTE_LENGTH,
  moveStep,
  quizFeedback,
  restoreLessonProgress,
  stepKey,
  toggleReviewed,
  totalLessonSteps,
  type LabSnapshot,
  type LessonProgress,
} from './lessonState';

export type { LabSnapshot } from './lessonState';
type Callbacks = {
  openBench(lessonId: string): void;
  openInstrument(partId: string): void;
  getSnapshot(): LabSnapshot;
};
type VisualStage = { title: string; body: string };
type Visual = { title: string; stages: VisualStage[]; svg(stage: number): string };
const esc = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
const arrowIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
const smallIcon = (name: 'speaker' | 'bench' | 'export' | 'check' | 'model') =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${{ speaker: '<path d="m4 9 5-1 5-4v16l-5-4-5-1zM18 8a7 7 0 0 1 0 8m2-11a11 11 0 0 1 0 14"/>', bench: '<path d="M2 12h4l3-8 6 16 3-8h4"/>', export: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>', check: '<path d="m4 12 5 5L20 6"/>', model: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M6 8h9v8H6zM18 9h1m-1 4h1"/>' }[name]}</svg>`;

function visualFor(lessonId: string, index: number): Visual {
  const key = stepKey(lessonId, index);
  const t = (x: number, y: number, value: string, cls = '') =>
    `<text x="${x}" y="${y}" class="${cls}" text-anchor="middle">${value}</text>`;
  const box = (x: number, y: number, w: number, h: number, label: string, cls = '') =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" class="ls-v-box ${cls}"/>${t(x + w / 2, y + h / 2 + 6, label, 'ls-v-strong')}`;
  const port = (x: number, label: string) =>
    `<circle cx="${x}" cy="125" r="24" class="ls-v-port"/>${t(x, 132, label, 'ls-v-white')}`;
  const line = (x1: number, y1: number, x2: number, y2: number, cls = '') =>
    `<path d="M${x1} ${y1}L${x2} ${y2}" class="ls-v-wire ${cls}"/>`;
  const flow = () =>
    `${port(78, '1')}${port(642, '2')}${line(103, 125, 250, 125, 'ls-v-flow')}${box(250, 86, 220, 78, 'NETWORK')}${line(470, 125, 617, 125, 'ls-v-flow')}`;
  const plot = (path: string, extra = '') =>
    `<path d="M105 35v160h535" class="ls-v-axis"/><path d="M105 75h535M105 115h535M105 155h535" class="ls-v-grid"/><path d="${path}" class="ls-v-response"/>${t(370, 228, 'FREQUENCY →')}${extra}`;
  const bell = 'M108 182C175 182 221 176 266 135S327 55 364 53S419 117 462 147S554 179 637 182';
  const result = (
    title: string,
    stages: [string, string][],
    draw: (stage: number) => string,
  ): Visual => ({
    title,
    stages: stages.map(([stageTitle, body]) => ({ title: stageTitle, body })),
    svg(stage) {
      return `<svg viewBox="0 0 720 250" role="img" aria-label="${esc(title)}. ${esc(stages[stage][1])}"><defs><marker id="ls-v-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="m0 0 10 5L0 10z" fill="#0986c3"/></marker></defs>${draw(stage)}</svg>`;
    },
  });
  switch (key) {
    case 'getting-started:0':
      return result(
        'A known wave, two paths',
        [
          ['Drive Port 1', 'The VNA supplies the incident wave at Port 1.'],
          ['Observe the response', 'Some wave returns to Port 1; another part reaches Port 2.'],
          ['Name the paths', 'S11 is reflection. S21 is forward transmission.'],
        ],
        (stage) =>
          `${flow()}${t(172, 87, 'incident a₁')}${t(553, 87, stage === 2 ? 'S21 = b₂ / a₁' : 'transmitted b₂', stage === 2 ? 'ls-v-strong' : '')}<path d="M275 164C240 223 117 218 105 157" class="ls-v-wire ${stage > 0 ? 'ls-v-flow' : 'ls-v-muted'}"/>${t(198, 238, stage === 2 ? 'S11 = b₁ / a₁' : 'reflected b₁')}`,
      );
    case 'getting-started:1':
      return result(
        'The sweep is a set of frequency samples',
        [
          ['Choose a span', 'Start and stop define the region you investigate.'],
          ['Place samples', 'Each point is one sampled frequency, not a new physical device.'],
          ['Resolve more detail', 'More points in the same span reduce sample spacing.'],
        ],
        (stage) => {
          const count = stage === 2 ? 17 : 7;
          return `${line(95, 142, 635, 142)}${Array.from({ length: count }, (_, i) => `<circle cx="${105 + (i * 520) / (count - 1)}" cy="142" r="${stage === 2 ? 6 : 9}" class="ls-v-sample"/>`).join('')}${t(110, 184, '100 MHz')}${t(615, 184, '3 GHz')}${t(360, 79, stage === 2 ? 'Δf = span / (N − 1)' : 'frequency →', 'ls-v-large')}<path d="M110 205h505" class="ls-v-bracket"/>${t(360, 233, 'SAME SPAN · DIFFERENT SAMPLING DENSITY')}`;
        },
      );
    case 'getting-started:2':
      return result(
        'Read the two-port indices',
        [
          ['Reflection', 'S11 describes the wave reflected back at Port 1.'],
          ['Transmission', 'S21 describes the wave leaving Port 2 when Port 1 is driven.'],
          ['Add phase', 'Magnitude gives the wave ratio; phase describes its rotation.'],
        ],
        (stage) =>
          `${flow()}${t(360, 48, stage === 0 ? 'S11 · INPUT REFLECTION' : stage === 1 ? 'S21 · FORWARD TRANSMISSION' : 'MAGNITUDE + PHASE', 'ls-v-large')}<path d="${stage === 0 ? 'M275 164C220 225 120 218 105 158' : 'M120 125H610'}" class="ls-v-wire ls-v-flow"/>${t(360, 218, stage === 2 ? 'A complex response has two components.' : 'First index: outgoing port · second index: incident port')}`,
      );
    case 'getting-started:3':
      return result(
        'A marker is one observation on a trace',
        [
          ['Choose a frequency', 'Move the marker within the current sweep.'],
          ['Read the value', 'A readout belongs to that frequency and the selected parameter.'],
          ['Record the context', 'One point does not describe the entire frequency response.'],
        ],
        (stage) =>
          plot(
            bell,
            `<path d="M${[270, 365, 485][stage]} 40v155" class="ls-v-marker"/><circle cx="${[270, 365, 485][stage]}" cy="${[131, 53, 158][stage]}" r="8" class="ls-v-sample"/>${t([270, 365, 485][stage], 26, 'M1', 'ls-v-strong')}${stage === 2 ? t(525, 68, 'f · S21 · dB', 'ls-v-strong') : ''}`,
          ),
      );
    case 'reflection-calibration:0':
      return result(
        'Choose the DUT reference plane',
        [
          ['Keep the test path', 'Your test cable belongs to the setup being characterized.'],
          ['Define the plane', 'Connect the standards where the DUT will connect.'],
          ['Keep it consistent', 'An added adapter can move the effective DUT connection.'],
        ],
        (stage) =>
          `${port(80, '1')}${line(105, 125, 290, 125, 'ls-v-flow')}${t(192, 87, 'TEST CABLE')}<path d="M305 35v180" class="ls-v-marker"/>${t(305, 235, 'REFERENCE PLANE', 'ls-v-strong')}${box(330, 86, stage === 2 ? 120 : 225, 78, stage === 2 ? 'ADAPTER' : 'STANDARD / DUT')}${stage === 2 ? `${line(450, 125, 490, 125)}${box(490, 86, 135, 78, 'DUT')}${t(470, 50, 'new path added', 'ls-v-warning')}` : ''}`,
      );
    case 'reflection-calibration:1':
      return result(
        'Three known reflection conditions',
        [
          ['Open', 'The ideal open has Γ = +1.'],
          ['Short', 'The ideal short has Γ = −1: equal magnitude, opposite phase.'],
          ['Match', 'The ideal 50 Ω load has Γ = 0.'],
        ],
        (stage) =>
          `${[150, 360, 570].map((x, i) => `<g class="${stage === i ? 'ls-v-selected' : 'ls-v-muted'}"><circle cx="${x}" cy="108" r="47" class="ls-v-standard"/>${t(x, 118, ['○', '⊥', '50 Ω'][i], 'ls-v-large')}${t(x, 185, ['OPEN', 'SHORT', 'LOAD'][i], 'ls-v-strong')}${t(x, 215, ['Γ = +1', 'Γ = −1', 'Γ = 0'][i])}</g>`).join('')}`,
      );
    case 'reflection-calibration:2':
      return result(
        'The known error model can be inverted',
        [
          [
            'Raw reflection',
            'The simulator adds deterministic directivity, tracking and source-match errors.',
          ],
          [
            'Solve with SOL',
            'Three known standards determine the implemented one-port coefficients.',
          ],
          [
            'Inspect the load',
            'After correction, an ideal matched load approaches zero reflection.',
          ],
        ],
        (stage) =>
          `${plot('M110 102C205 86 265 122 360 103S524 89 636 111')}<path d="M110 185H636" class="ls-v-response ${stage > 0 ? '' : 'ls-v-muted'}"/>${t(496, 74, 'uncorrected S11', 'ls-v-warning')}${t(490, 174, stage > 0 ? 'SOL-corrected S11' : 'known model error')}${t(360, 22, 'PORT 1 ONLY', 'ls-v-strong')}`,
      );
    case 'reflection-calibration:3':
      return result(
        'Captures belong to one frequency grid',
        [
          ['Original sweep', 'The original standards were captured at these frequencies.'],
          ['Change the grid', 'A new window or point count no longer matches those captures.'],
          ['Capture again', 'The app clears the old correction and asks for a new set.'],
        ],
        (stage) =>
          `<path d="M110 84h500M110 154h500" class="ls-v-axis"/>${Array.from({ length: 8 }, (_, i) => `<circle cx="${120 + i * 67}" cy="84" r="7" class="ls-v-sample"/>`).join('')}${Array.from({ length: 12 }, (_, i) => `<circle cx="${180 + i * 34}" cy="154" r="6" class="${stage > 0 ? 'ls-v-new-sample' : 'ls-v-muted'}"/>`).join('')}${t(360, 47, 'CAPTURED GRID')}${t(360, 205, stage === 2 ? 'NEW SOL CAPTURES REQUIRED' : 'CHANGED GRID', 'ls-v-strong')}`,
      );
    case 'transmission-normalization:0':
      return result(
        'A cable changes phase as well as magnitude',
        [
          ['Transmit', 'The matched analytic cable passes a signal with modest loss.'],
          ['Rotate phase', 'The finite transit time produces frequency-dependent phase.'],
          ['Read delay', 'The cable model has approximately 2 ns group delay.'],
        ],
        (stage) =>
          `${port(80, '1')}${port(640, '2')}${line(105, 125, 245, 125, 'ls-v-flow')}${box(245, 84, 230, 82, 'THROUGH CABLE')}${line(475, 125, 615, 125, 'ls-v-flow')}${t(360, 48, stage === 2 ? '≈ 2 ns DELAY' : stage === 1 ? 'φ(f) = −2πfτ' : 'S21 · ANALYTIC PATH', 'ls-v-large')}${t(360, 220, 'SOL reflection correction does not correct transmission.')}`,
      );
    case 'transmission-normalization:1':
      return result(
        'Compare transmission with its captured reference',
        [
          ['Capture Tref', 'Save the through transmission on the current frequency grid.'],
          ['Form the ratio', 'Divide the current complex transmission by Tref.'],
          [
            'Same path, unity',
            'The same nonzero path divided by itself gives 0 dB and 0° relative response.',
          ],
        ],
        (stage) =>
          `${box(75, 70, 165, 70, 'T(f)')}${box(270, 70, 165, 70, 'Tref(f)')}${box(480, 70, 165, 70, stage === 2 ? '1 + j0' : 'T / Tref')}${t(254, 116, '÷', 'ls-v-large')}${t(456, 116, '=', 'ls-v-large')}${t(360, 185, stage === 2 ? '0 dB · 0° · RELATIVE TRANSMISSION' : 'Match the reference frequency grid.', 'ls-v-strong')}${t(360, 223, 'Reflection is unchanged. This is not full two-port calibration.')}`,
      );
    case 'transmission-normalization:2':
      return result(
        'Wave amplitude and power are different ratios',
        [
          ['Clear the reference', 'Use the unnormalized analytic attenuator response.'],
          ['Read amplitude', 'A 10 dB attenuator gives |S21| ≈ 0.316.'],
          ['Interpret the loss', 'For equal reference impedances, the power ratio is about 0.1.'],
        ],
        (stage) =>
          `<path d="M140 195V60M140 195h445" class="ls-v-axis"/><rect x="210" y="65" width="85" height="130" rx="9" class="ls-v-bar"/><rect x="410" y="${195 - [41, 41, 13][stage]}" width="85" height="${[41, 41, 13][stage]}" rx="6" class="ls-v-bar secondary"/>${t(253, 229, 'INPUT')}${t(453, 229, stage === 2 ? 'POWER ≈ 0.1' : 'OUTPUT')}${t(430, 44, stage === 0 ? 'RELATIVE REFERENCE OFF' : stage === 1 ? 'AMPLITUDE ≈ 0.316' : '−10 dB', 'ls-v-strong')}`,
      );
    case 'transmission-normalization:3':
      return result(
        'Choose the correction that answers your question',
        [
          ['Reflection SOL', 'This app solves its three-term Port 1 S11 model.'],
          ['Relative THRU', 'This app compares transmission with a captured response.'],
          [
            'Full two-port',
            'Real full calibration needs more measurements and standards than these exercises.',
          ],
        ],
        (stage) =>
          `${[60, 275, 490].map((x, i) => `<g class="${stage === i ? 'ls-v-selected' : 'ls-v-muted'}">${box(x, 72, 170, 92, ['PORT 1 SOL', 'THRU RATIO', 'FULL 2-PORT'][i])}${t(x + 85, 198, ['S11 correction', 'S21 / S12 ratio', 'not implemented'][i])}</g>`).join('')}${t(360, 38, 'DIFFERENT SCOPE · DIFFERENT EVIDENCE', 'ls-v-strong')}`,
      );
    case 'filter-investigation:0':
      return result(
        'Find the region of stronger transmission',
        [
          ['Sweep broadly', 'Include frequencies below and above the expected feature.'],
          ['Find the passband', 'The central region transmits more strongly.'],
          [
            'Compare stopbands',
            'Outside that region the analytic transmission is more attenuated.',
          ],
        ],
        (stage) =>
          plot(
            bell,
            `<rect x="${stage === 2 ? 110 : 285}" y="42" width="${stage === 2 ? 130 : 160}" height="153" class="ls-v-region"/>${t(stage === 2 ? 180 : 365, 28, stage === 2 ? 'STOPBAND' : 'PASSBAND', 'ls-v-strong')}`,
          ),
      );
    case 'filter-investigation:1':
      return result(
        'Peak search operates on the sampled trace',
        [
          [
            'The underlying shape',
            'The analytic response has a maximum between surrounding points.',
          ],
          ['The sampled peak', 'Search chooses the largest available sampled value.'],
          ['Increase resolution', 'More closely spaced points better resolve a narrow feature.'],
        ],
        (stage) =>
          plot(
            bell,
            `${Array.from({ length: stage === 2 ? 19 : 7 }, (_, i) => {
              const count = stage === 2 ? 19 : 7,
                x = 115 + (i * 510) / (count - 1),
                y = 182 - 129 * Math.exp(-(((x - 364) / 90) ** 2));
              return `<circle cx="${x}" cy="${y}" r="5" class="ls-v-sample"/>`;
            }).join(
              '',
            )}<path d="M364 35v160" class="ls-v-marker"/>${t(364, 26, 'PEAK', 'ls-v-strong')}`,
          ),
      );
    case 'filter-investigation:2':
      return result(
        'Bandwidth uses a stated threshold',
        [
          ['Read the peak', 'Use the measured maximum as the reference level.'],
          ['Move down 3 dB', 'The threshold is peak minus 3 dB, not always absolute −3 dB.'],
          [
            'Find both edges',
            'Bandwidth is the upper crossing frequency minus the lower crossing frequency.',
          ],
        ],
        (stage) =>
          plot(
            bell,
            `<path d="M150 ${stage === 0 ? 53 : 100}h420" class="ls-v-marker"/>${stage === 0 ? t(544, 43, 'PEAK') : `${line(295, 100, 295, 195, 'ls-v-marker')}${line(424, 100, 424, 195, 'ls-v-marker')}${t(550, 89, 'PEAK − 3 dB', 'ls-v-strong')}${t(295, 214, 'fL')}${t(424, 214, 'fH')}`}${stage === 2 ? `${line(295, 168, 424, 168, 'ls-v-bracket')}${t(360, 155, 'BW = fH − fL', 'ls-v-strong')}` : ''}`,
          ),
      );
    case 'filter-investigation:3':
      return result(
        'Rejected transmission can be reflected',
        [
          ['Incident wave', 'The device receives the incident signal.'],
          ['Two observable paths', 'Reflection and transmission account for different wave paths.'],
          [
            'Explain what is missing',
            'A lower transmission alone does not establish how much energy was dissipated.',
          ],
        ],
        (stage) =>
          `${flow()}<path d="M280 164C221 225 130 213 108 154" class="ls-v-wire ${stage > 0 ? 'ls-v-flow' : 'ls-v-muted'}"/>${t(174, 229, 'REFLECTED')}${t(551, 86, 'TRANSMITTED')}${stage === 2 ? `${line(360, 165, 360, 207, 'ls-v-marker')}${t(426, 230, 'LOSS? Check the model.')}` : ''}`,
      );
    case 'evidence-report:0':
      return result(
        'Keep the settings with the observation',
        [
          ['Identify the DUT', 'Name the analytic network being explored.'],
          ['Keep the setup', 'Record the sweep, reference impedance and correction state.'],
          ['State the readout', 'Record the parameter, display format, frequency and value.'],
        ],
        (stage) =>
          `<rect x="170" y="25" width="380" height="205" rx="14" class="ls-v-paper"/>${[65, 112, 159].map((y, i) => `${t(360, y, ['DUT · ANALYTIC MODEL', 'SWEEP · 50 Ω · CORRECTION', 'f · S-PARAMETER · FORMAT · VALUE'][i], stage === i ? 'ls-v-strong' : 'ls-v-faint')}${line(200, y + 18, 520, y + 18, 'ls-v-grid')}`).join('')}`,
      );
    case 'evidence-report:1':
      return result(
        'Export the numbers and their meaning',
        [
          ['Preserve samples', 'Touchstone preserves sampled complex response data.'],
          ['Keep context', 'The report records settings and simulated marker information.'],
          ['Explain separately', 'Add your observation and limitation to the lab note.'],
        ],
        (stage) =>
          `${[90, 285, 480].map((x, i) => `<g class="${stage === i ? 'ls-v-selected' : 'ls-v-muted'}"><rect x="${x}" y="50" width="145" height="155" rx="10" class="ls-v-paper"/>${t(x + 72, 111, ['.s2p', '.json', 'NOTE'][i], 'ls-v-large')}${t(x + 72, 158, ['SAMPLES', 'SETTINGS', 'EXPLANATION'][i])}</g>`).join('')}`,
      );
    default:
      return result(
        'Make a claim the evidence can support',
        [
          ['Observe', 'State one feature actually present in the simulated trace.'],
          ['Explain', 'Connect that observation to a network concept.'],
          ['Limit', 'Name what would still need a supervised physical check.'],
        ],
        (stage) =>
          `${[60, 275, 490].map((x, i) => `<g class="${stage === i ? 'ls-v-selected' : 'ls-v-muted'}">${box(x, 65, 170, 100, ['OBSERVE', 'EXPLAIN', 'LIMIT'][i])}${t(x + 85, 198, ['trace evidence', 'network reasoning', 'real lab checks'][i])}</g>`).join('')}`,
      );
  }
}

export function createLessonStudio(container: HTMLElement, callbacks: Callbacks) {
  let state: LessonProgress = emptyProgress(),
    storageAvailable = true,
    disposed = false,
    active = true;
  try {
    state = restoreLessonProgress(
      localStorage.getItem(LESSON_STORAGE_KEY),
      localStorage.getItem('vna-lab-reviewed-v1'),
    );
  } catch {
    storageAvailable = false;
  }
  let phase = 0,
    playing = false,
    visualTimer: ReturnType<typeof setInterval> | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let narration: 'idle' | 'reading' | 'paused' = 'idle',
    narrationToken = 0;
  let selectedVoice = '',
    rate = 1;
  let utterance: SpeechSynthesisUtterance | null = null;
  let voices: SpeechSynthesisVoice[] = [];
  const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const synth = canSpeak ? window.speechSynthesis : null;
  const within = <T extends HTMLElement = HTMLElement>(selector: string) =>
    container.querySelector<T>(selector)!;
  const lesson = () => lessons.find((item) => item.id === state.lessonId)!;
  const key = () => stepKey(state.lessonId, state.stepIndex);
  const safeSnapshot = () => {
    try {
      return callbacks.getSnapshot();
    } catch {
      return null;
    }
  };
  const persist = () => {
    if (disposed) return;
    try {
      localStorage.setItem(LESSON_STORAGE_KEY, JSON.stringify(state));
    } catch {
      storageAvailable = false;
      updateStorageLabel();
    }
  };
  function updateStorageLabel() {
    const label = container.querySelector<HTMLElement>('[data-ls-storage]');
    if (label)
      label.textContent = storageAvailable
        ? 'Notes, choices and review marks stay in this browser.'
        : 'Browser storage is unavailable. Keep this page open or export your notes.';
  }
  function stopVisual() {
    playing = false;
    if (visualTimer) clearInterval(visualTimer);
    visualTimer = null;
    const button = container.querySelector<HTMLButtonElement>('[data-ls-action="play-visual"]');
    if (button) {
      button.textContent = 'Play explanation';
      button.setAttribute('aria-pressed', 'false');
    }
    const visual = container.querySelector<HTMLElement>('.ls-visual');
    if (visual) visual.dataset.playing = 'false';
  }
  function stopReading(message = '') {
    narrationToken++;
    if (utterance && synth) synth.cancel();
    utterance = null;
    narration = 'idle';
    updateNarration(message);
  }
  function updateNarration(message = '') {
    const status = container.querySelector<HTMLElement>('[data-ls-narration-status]');
    if (!status) return;
    const usable = Boolean(synth && voices.length);
    within<HTMLButtonElement>('[data-ls-action="read"]').disabled = !usable || !active;
    within<HTMLButtonElement>('[data-ls-action="pause-read"]').disabled = narration !== 'reading';
    within<HTMLButtonElement>('[data-ls-action="resume-read"]').disabled = narration !== 'paused';
    within<HTMLButtonElement>('[data-ls-action="stop-read"]').disabled = narration === 'idle';
    within<HTMLSelectElement>('[data-ls-voice]').disabled = !usable || narration !== 'idle';
    status.textContent =
      message ||
      (!canSpeak
        ? 'Speech is unavailable here. The complete step text is displayed below.'
        : !voices.length
          ? 'No local English voice is available. The on-screen lesson remains complete.'
          : narration === 'reading'
            ? 'Reading this step. Follow the text below.'
            : narration === 'paused'
              ? 'Reading paused.'
              : 'Ready when you are. Reading starts only when you choose Read step.');
  }
  function refreshVoices() {
    voices = synth
      ? synth.getVoices().filter((voice) => voice.localService && /^en(?:-|$)/i.test(voice.lang))
      : [];
    if (!voices.some((voice) => voice.voiceURI === selectedVoice))
      selectedVoice = voices[0]?.voiceURI ?? '';
    const select = container.querySelector<HTMLSelectElement>('[data-ls-voice]');
    if (select)
      select.innerHTML = voices.length
        ? voices
            .map(
              (voice) =>
                `<option value="${esc(voice.voiceURI)}" ${voice.voiceURI === selectedVoice ? 'selected' : ''}>${esc(voice.name)} · ${esc(voice.lang)}</option>`,
            )
            .join('')
        : '<option>No local voice available</option>';
    updateNarration();
  }
  function readStep() {
    if (!synth || !voices.length || !active) return;
    stopReading();
    const current = lesson().steps[state.stepIndex],
      token = narrationToken;
    utterance = new SpeechSynthesisUtterance(
      `${current.title}. ${current.body} Try this. ${current.action} Look for this. ${current.expected} Your checkpoint. ${current.checkpoint}`,
    );
    utterance.voice = voices.find((voice) => voice.voiceURI === selectedVoice) ?? voices[0];
    utterance.lang = utterance.voice.lang;
    utterance.rate = rate;
    utterance.onstart = () => {
      if (token !== narrationToken) return;
      narration = 'reading';
      updateNarration();
    };
    utterance.onend = () => {
      if (token !== narrationToken) return;
      utterance = null;
      narration = 'idle';
      updateNarration('Step reading finished. Replay it or continue at your own pace.');
    };
    utterance.onerror = () => {
      if (token !== narrationToken) return;
      utterance = null;
      narration = 'idle';
      updateNarration(
        'This device could not read the step. All instructions remain available on screen.',
      );
    };
    narration = 'reading';
    updateNarration();
    if (synth.paused) synth.resume();
    synth.speak(utterance);
  }
  function renderVisual() {
    const visual = visualFor(state.lessonId, state.stepIndex);
    within('[data-ls-diagram]').innerHTML = visual.svg(phase);
    within('[data-ls-stage-title]').textContent = visual.stages[phase].title;
    within('[data-ls-stage-body]').textContent = visual.stages[phase].body;
    container.querySelectorAll<HTMLElement>('[data-ls-stage]').forEach((button) => {
      const selected = Number(button.dataset.lsStage) === phase;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }
  function renderBench() {
    const checks = evaluatePractice(state.lessonId, state.stepIndex, safeSnapshot());
    within('[data-ls-checks]').innerHTML = checks.length
      ? checks
          .map(
            (check) =>
              `<li class="${check.met === true ? 'is-met' : check.met === false ? 'is-unmet' : 'is-unknown'}"><span class="ls-check-symbol" aria-hidden="true">${check.met === true ? '✓' : check.met === false ? '○' : '—'}</span><div><strong>${esc(check.label)}</strong><small>${check.met === true ? 'Ready now' : check.met === false ? 'Not yet' : 'Not automatically checked'}</small><p>${esc(check.detail)}</p></div></li>`,
          )
          .join('')
      : '<li class="is-unknown"><span class="ls-check-symbol" aria-hidden="true">✎</span><div><strong>Explain it in your own words</strong><p>This step is about interpretation. Use the question and your note; bench settings alone cannot verify the explanation.</p></div></li>';
  }
  function renderQuiz() {
    const quiz = lessonQuizzes[key()],
      chosen = state.answers[key()],
      feedback = quizFeedback(key(), chosen);
    within('[data-ls-quiz]').innerHTML =
      `<fieldset><legend>${esc(quiz.question)}</legend><div class="ls-answer-options">${quiz.options.map((option, index) => `<label class="${chosen === index ? 'is-selected' : ''}"><input type="radio" name="ls-quiz-answer" value="${index}" ${chosen === index ? 'checked' : ''}><span class="ls-option-letter" aria-hidden="true">${String.fromCharCode(65 + index)}</span><span>${esc(option)}</span></label>`).join('')}</div></fieldset><div class="ls-quiz-feedback ${feedback ? (feedback.correct ? 'is-correct' : 'is-rethink') : ''}" role="status" aria-live="polite">${feedback ? `<strong>${feedback.correct ? 'That matches the explanation.' : 'Pause and reason it through.'}</strong><p>${esc(feedback.explanation)}</p><small>Practice feedback · not a grade or a claim of lab competence.</small>` : '<p>Choose an explanation to see why it fits. You can try again.</p>'}</div>`;
  }
  function render() {
    if (disposed) return;
    const currentLesson = lesson(),
      current = currentLesson.steps[state.stepIndex],
      visual = visualFor(state.lessonId, state.stepIndex);
    const index = lessons.indexOf(currentLesson),
      reviewed = state.reviewed.includes(key());
    const prior = index === 0 && state.stepIndex === 0,
      final = index === lessons.length - 1 && state.stepIndex === currentLesson.steps.length - 1;
    container.classList.add('lesson-studio');
    container.innerHTML = `<div class="ls-heading"><div><div class="ls-eyebrow">GUIDED LAB / LEARN AT YOUR OWN PACE</div><h1>A clear path to<br>a better measurement<span>.</span></h1><p>See the idea. Try it at the bench. Explain what you observed.</p></div><div class="ls-course-summary"><b>${state.reviewed.length}<span> / ${totalLessonSteps}</span></b><small>steps marked reviewed</small><div class="ls-course-meter"><span style="width:${(state.reviewed.length / totalLessonSteps) * 100}%"></span></div><small>Self-reported review · not an assessment</small></div></div>
    <div class="ls-layout"><aside class="ls-path"><div class="ls-path-heading"><span class="ls-eyebrow">YOUR LEARNING PATH</span><span>5 short lessons</span></div>${lessons
      .map((item, lessonIndex) => {
        const marks = item.steps.filter((_, i) =>
          state.reviewed.includes(stepKey(item.id, i)),
        ).length;
        return `<div class="ls-lesson ${item.id === state.lessonId ? 'is-current' : ''}"><button class="ls-lesson-button" data-ls-lesson="${item.id}" aria-expanded="${item.id === state.lessonId}"><span class="ls-lesson-number">${String(lessonIndex + 1).padStart(2, '0')}</span><span><strong>${esc(item.title)}</strong><small>${esc(item.duration)} · ${marks}/${item.steps.length} reviewed</small></span>${arrowIcon}</button>${item.id === state.lessonId ? `<ol class="ls-step-list">${item.steps.map((step, i) => `<li><button data-ls-step="${i}" class="${i === state.stepIndex ? 'is-active' : ''}" ${i === state.stepIndex ? 'aria-current="step"' : ''}><span>${state.reviewed.includes(stepKey(item.id, i)) ? '✓' : i + 1}</span><span>${esc(step.title)}</span></button></li>`).join('')}</ol>` : ''}</div>`;
      })
      .join(
        '',
      )}<p class="ls-local-note" data-ls-storage></p><div class="ls-path-actions"><button data-ls-action="export-notes">${smallIcon('export')} Export learning notes</button><button data-ls-action="reset">Reset local progress</button></div></aside>
    <div class="ls-main"><article class="ls-step-card"><div class="ls-step-top"><span class="ls-eyebrow">LESSON ${index + 1} / ${esc(currentLesson.subtitle)}</span><span class="ls-step-counter">STEP ${state.stepIndex + 1} OF ${currentLesson.steps.length}</span></div><div class="ls-step-meter">${currentLesson.steps.map((_, i) => `<span class="${i <= state.stepIndex ? 'is-filled' : ''}"></span>`).join('')}</div><label class="ls-step-jump">Jump to step<select data-ls-jump aria-label="Jump to lesson step">${currentLesson.steps.map((item, i) => `<option value="${i}" ${i === state.stepIndex ? 'selected' : ''}>${i + 1}. ${esc(item.title)}</option>`).join('')}</select></label><h2 tabindex="-1" data-ls-title>${esc(current.title)}</h2><p class="ls-understand">${esc(current.body)}</p>
      <section class="ls-visual" data-playing="false" aria-label="Visual explanation"><div class="ls-visual-header"><span>${esc(visual.title)}</span><button data-ls-action="play-visual" aria-pressed="false">Play explanation</button></div><div data-ls-diagram></div><div class="ls-stages" role="group" aria-label="Explanation stage">${visual.stages.map((stage, i) => `<button data-ls-stage="${i}" aria-pressed="${i === phase}"><span>${i + 1}</span>${esc(stage.title)}</button>`).join('')}</div><div class="ls-stage-caption"><strong data-ls-stage-title></strong><p data-ls-stage-body></p></div><span class="ls-schematic-label">Conceptual illustration · not a measurement trace</span></section>
      <div class="ls-instruction-grid"><section><span class="ls-section-index">01 / TRY THIS</span><p>${esc(current.action)}</p><button class="ls-primary" data-ls-action="bench">${smallIcon('bench')} Open practice bench ${arrowIcon}</button></section><section><span class="ls-section-index">02 / LOOK FOR</span><p>${esc(current.expected)}</p><button class="ls-link-button" data-ls-action="instrument">${smallIcon('model')} Locate the control ${arrowIcon}</button></section></div>
      <section class="ls-reflect"><span class="ls-section-index">03 / EXPLAIN IT</span><p>${esc(current.checkpoint)}</p></section>
      <section class="ls-quiz"><div class="ls-section-heading"><span class="ls-section-index">A QUICK UNDERSTANDING CHECK</span><span>Try · read feedback · retry</span></div><div data-ls-quiz></div></section>
      <div class="ls-bottom-nav"><button class="ls-secondary" data-ls-action="previous" ${prior ? 'disabled' : ''}>${arrowIcon} Previous</button><button class="ls-review ${reviewed ? 'is-reviewed' : ''}" data-ls-action="review" aria-pressed="${reviewed}">${smallIcon('check')}${reviewed ? 'Marked as reviewed' : 'Mark this step reviewed'}</button><button class="ls-primary" data-ls-action="next" ${final ? 'disabled' : ''}>${state.stepIndex === currentLesson.steps.length - 1 ? 'Next lesson' : 'Next step'}${arrowIcon}</button></div><p class="ls-review-boundary">Move freely between steps. Review marks are your own record; quiz answers and bench checks do not award proficiency.</p></article>
    </div><aside class="ls-companion"><section class="ls-narration-card"><span class="ls-eyebrow">LISTEN & FOLLOW ALONG</span><h3>${smallIcon('speaker')} Read this step</h3><p>The text stays on screen while the device voice reads.</p><label>Device voice<select data-ls-voice aria-label="Local device voice"></select></label><label>Reading pace<select data-ls-rate aria-label="Reading pace"><option value="0.8" ${rate === 0.8 ? 'selected' : ''}>Unhurried · 0.8×</option><option value="1" ${rate === 1 ? 'selected' : ''}>Natural · 1×</option><option value="1.15" ${rate === 1.15 ? 'selected' : ''}>Brisk · 1.15×</option></select></label><button class="ls-primary" data-ls-action="read">${smallIcon('speaker')} Read step</button><div class="ls-reading-actions"><button data-ls-action="pause-read">Pause</button><button data-ls-action="resume-read">Resume</button><button data-ls-action="stop-read">Stop</button></div><p class="ls-narration-status" data-ls-narration-status role="status" aria-live="polite"></p><small>Only voices reported as local by your browser are offered. Device support varies; offline speech is not guaranteed. No voice download or cloud AI is requested.</small></section>
      <section class="ls-bench-card"><div class="ls-section-heading"><span class="ls-eyebrow">AT THE BENCH</span><button data-ls-action="check-bench">Check setup</button></div><h3>What is ready now?</h3><ul class="ls-bench-checks" data-ls-checks></ul><p class="ls-check-boundary">Current simulator state only. These checks do not prove the sequence of actions or a physical measurement.</p></section>
      <section class="ls-note-card"><label for="ls-note"><span class="ls-eyebrow">YOUR LAB NOTE</span><span class="ls-note-title">Capture the observation</span></label><p>What changed, why might it happen, and what would you check next?</p><textarea id="ls-note" data-ls-note maxlength="${MAX_NOTE_LENGTH}" rows="6" placeholder="I observed…\nThis suggests…\nOne limitation is…">${esc(state.notes[key()] ?? '')}</textarea><div class="ls-note-footer"><span data-ls-note-count>${(state.notes[key()] ?? '').length}/${MAX_NOTE_LENGTH}</span><span>Stored locally</span></div></section>
    </aside></div><div class="ls-reset-panel" data-ls-reset hidden role="region" aria-label="Reset learning notes"><h3>Reset this browser’s lesson record?</h3><p>This clears the saved step, review marks, answers and notes. Export learning notes first if you want a copy.</p><div><button class="ls-secondary" data-ls-action="cancel-reset">Keep my notes</button><button class="ls-primary" data-ls-action="confirm-reset">Reset lesson record</button></div></div><p class="ls-action-status" data-ls-status role="status" aria-live="polite"></p>`;
    updateStorageLabel();
    renderVisual();
    renderQuiz();
    renderBench();
    refreshVoices();
  }
  function navigate(next: LessonProgress) {
    if (disposed || next === state) return;
    stopVisual();
    stopReading();
    state = next;
    phase = 0;
    persist();
    render();
    within('[data-ls-title]').focus({ preventScroll: true });
    within('[data-ls-title]').scrollIntoView({ behavior: 'instant', block: 'start' });
  }
  function downloadNotes() {
    const record = {
      kind: 'student-learning-notes-not-an-assessment',
      application: 'VNA Student Lab',
      version: 2,
      exportedAt: new Date().toISOString(),
      reviewMeaning: 'Self-reported review, not verified practical competence.',
      progress: state,
      currentSimulatedBench: safeSnapshot(),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'VNA-learning-notes.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    within('[data-ls-status]').textContent =
      'Learning notes are ready to save. This export is a local file, not an assessment result.';
  }
  function handleClick(event: Event) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || !container.contains(button) || button.disabled) return;
    if (button.dataset.lsLesson) {
      navigate(jumpToStep(state, button.dataset.lsLesson, 0));
      return;
    }
    if (button.dataset.lsStep !== undefined) {
      navigate(jumpToStep(state, state.lessonId, Number(button.dataset.lsStep)));
      return;
    }
    if (button.dataset.lsStage !== undefined) {
      stopVisual();
      phase = Number(button.dataset.lsStage);
      renderVisual();
      return;
    }
    switch (button.dataset.lsAction) {
      case 'previous':
        navigate(moveStep(state, -1));
        break;
      case 'next':
        navigate(moveStep(state, 1));
        break;
      case 'review':
        stopVisual();
        state = toggleReviewed(state);
        persist();
        render();
        within<HTMLButtonElement>('[data-ls-action="review"]').focus({ preventScroll: true });
        break;
      case 'bench':
        stopReading();
        stopVisual();
        callbacks.openBench(state.lessonId);
        break;
      case 'instrument': {
        stopReading();
        stopVisual();
        const part = lesson().steps[state.stepIndex].focus ?? 'screen';
        callbacks.openInstrument(part);
        break;
      }
      case 'check-bench':
        renderBench();
        within('[data-ls-status]').textContent =
          'Bench checks refreshed from the current simulator settings.';
        break;
      case 'play-visual':
        if (playing) stopVisual();
        else {
          playing = true;
          within<HTMLElement>('.ls-visual').dataset.playing = 'true';
          button.textContent = 'Pause explanation';
          button.setAttribute('aria-pressed', 'true');
          visualTimer = setInterval(() => {
            phase = (phase + 1) % 3;
            renderVisual();
          }, 4800);
        }
        break;
      case 'read':
        readStep();
        break;
      case 'pause-read':
        if (synth && narration === 'reading') {
          synth.pause();
          narration = 'paused';
          updateNarration();
        }
        break;
      case 'resume-read':
        if (synth && narration === 'paused') {
          synth.resume();
          narration = 'reading';
          updateNarration();
        }
        break;
      case 'stop-read':
        stopReading('Reading stopped. You can replay this step.');
        break;
      case 'export-notes':
        persist();
        downloadNotes();
        break;
      case 'reset':
        within('[data-ls-reset]').hidden = false;
        within<HTMLButtonElement>('[data-ls-action="cancel-reset"]').focus();
        break;
      case 'cancel-reset':
        within('[data-ls-reset]').hidden = true;
        within<HTMLButtonElement>('[data-ls-action="reset"]').focus();
        break;
      case 'confirm-reset':
        stopReading();
        stopVisual();
        state = emptyProgress();
        phase = 0;
        try {
          localStorage.removeItem('vna-lab-reviewed-v1');
        } catch {
          storageAvailable = false;
        }
        persist();
        render();
        within('[data-ls-title]').focus();
        within('[data-ls-status]').textContent = 'This browser’s lesson record was reset.';
        break;
    }
  }
  function handleChange(event: Event) {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    if (input.hasAttribute('data-ls-jump')) {
      navigate(jumpToStep(state, state.lessonId, Number(input.value)));
      return;
    }
    if (input.name === 'ls-quiz-answer') {
      state = { ...state, answers: { ...state.answers, [key()]: Number(input.value) } };
      persist();
      const selected = Number(input.value);
      renderQuiz();
      container
        .querySelector<HTMLInputElement>(`input[name="ls-quiz-answer"][value="${selected}"]`)
        ?.focus({ preventScroll: true });
    }
    if (input.hasAttribute('data-ls-voice')) selectedVoice = input.value;
    if (input.hasAttribute('data-ls-rate')) {
      stopReading('Pace changed. Choose Read step to replay it at the new pace.');
      rate = Number(input.value);
    }
  }
  function handleInput(event: Event) {
    const input = event.target as HTMLTextAreaElement;
    if (!input.hasAttribute('data-ls-note')) return;
    state = { ...state, notes: { ...state.notes, [key()]: input.value.slice(0, MAX_NOTE_LENGTH) } };
    within('[data-ls-note-count]').textContent = `${state.notes[key()].length}/${MAX_NOTE_LENGTH}`;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 250);
  }
  const hide = () => {
    if (document.hidden) {
      stopReading('Reading stopped while this page is hidden.');
      stopVisual();
    }
  };
  const leave = () => {
    stopReading();
    stopVisual();
    persist();
  };
  container.addEventListener('click', handleClick);
  container.addEventListener('change', handleChange);
  container.addEventListener('input', handleInput);
  synth?.addEventListener('voiceschanged', refreshVoices);
  document.addEventListener('visibilitychange', hide);
  window.addEventListener('pagehide', leave);
  render();
  persist();
  return {
    refresh() {
      if (!disposed) {
        renderBench();
        refreshVoices();
      }
    },
    setActive(value: boolean) {
      active = value;
      if (!active) {
        stopReading();
        stopVisual();
      } else {
        renderBench();
        refreshVoices();
      }
    },
    openLesson(lessonId: string, stepIndex = 0) {
      navigate(jumpToStep(state, lessonId, stepIndex));
    },
    getContext() {
      return {
        lessonId: state.lessonId,
        lessonTitle: lesson().title,
        stepIndex: state.stepIndex,
        stepTitle: lesson().steps[state.stepIndex].title,
      };
    },
    dispose() {
      if (disposed) return;
      stopReading();
      stopVisual();
      if (saveTimer) clearTimeout(saveTimer);
      persist();
      disposed = true;
      container.removeEventListener('click', handleClick);
      container.removeEventListener('change', handleChange);
      container.removeEventListener('input', handleInput);
      synth?.removeEventListener('voiceschanged', refreshVoices);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
    },
  };
}
