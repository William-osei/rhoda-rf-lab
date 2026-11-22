/**
 * RHODA-independent VNA teaching engine. All responses are synthetic.
 *
 * The DUTs are small analytic, reciprocal 50-ohm network examples, not measured
 * ZNLE6 data. Transmission is idealized. Reflection can include a deterministic
 * three-term one-port error model. The simulated SOL workflow corrects Port 1
 * reflection only; it does not transfer that calibration to Port 2.
 * This deliberately does not claim to emulate full two-port/SOLT calibration,
 * instrument noise/dynamic range, connector repeatability or hardware safety.
 */
export interface Complex {
  re: number;
  im: number;
}
export type SParameter = 's11' | 's21' | 's12' | 's22';
export type TraceFormat = 'logmag' | 'phase' | 'vswr' | 'groupdelay' | 'real' | 'imag';
export type DutId =
  'through' | 'attenuator' | 'lowpass' | 'bandpass' | 'open' | 'short' | 'load' | 'mismatch';
export type CalibrationStandard = 'open' | 'short' | 'load';
export interface SweepSettings {
  startHz: number;
  stopHz: number;
  points: number;
  spacing: 'linear' | 'log';
}
export interface SweepPoint {
  frequencyHz: number;
  s11: Complex;
  s21: Complex;
  s12: Complex;
  s22: Complex;
}
export interface CalibrationState {
  readonly kind: 'one-port-sol';
  readonly sweep: SweepSettings;
  readonly signature: string;
  readonly standards: Partial<Record<CalibrationStandard, readonly Complex[]>>;
}
export interface OnePortErrorTerms {
  directivity: Complex;
  tracking: Complex;
  sourceMatch: Complex;
}

export const MIN_FREQUENCY_HZ = 1e6;
export const MAX_FREQUENCY_HZ = 6e9;
export const MAX_SWEEP_POINTS = 1601;
export const DEFAULT_SWEEP: Readonly<SweepSettings> = Object.freeze({
  startHz: MIN_FREQUENCY_HZ,
  stopHz: MAX_FREQUENCY_HZ,
  points: 401,
  spacing: 'linear',
});

export const DUTS = [
  {
    id: 'through',
    title: 'Through cable',
    ports: 2,
    description:
      'Matched 50 Ω cable; 2 ns propagation delay and a small synthetic frequency-dependent loss.',
  },
  {
    id: 'attenuator',
    title: '10 dB attenuator',
    ports: 2,
    description: 'Matched reciprocal attenuator; 10 dB insertion loss and 0.5 ns delay.',
  },
  {
    id: 'lowpass',
    title: '1 GHz low-pass filter',
    ports: 2,
    description:
      'Ideal first-order reflective low-pass response; corner at 1 GHz, plus 0.25 dB synthetic loss.',
  },
  {
    id: 'bandpass',
    title: '2.4 GHz band-pass filter',
    ports: 2,
    description:
      'Ideal reflective resonant response; 2.4 GHz center and 0.8 GHz nominal bandwidth, plus 0.4 dB synthetic loss.',
  },
  {
    id: 'mismatch',
    title: '75 Ω mismatched line',
    ports: 2,
    description:
      'A lossless 75 Ω line between 50 Ω reference ports; 3 ns delay produces reflection ripple.',
  },
  {
    id: 'open',
    title: 'Open circuit',
    ports: 1,
    description:
      'Ideal open termination at Port 1: reflection coefficient +1. No transmission path.',
  },
  {
    id: 'short',
    title: 'Short circuit',
    ports: 1,
    description:
      'Ideal short termination at Port 1: reflection coefficient −1. No transmission path.',
  },
  {
    id: 'load',
    title: 'Matched 50 Ω load',
    ports: 1,
    description:
      'Ideal matched termination at Port 1: reflection coefficient 0. No transmission path.',
  },
] as const satisfies readonly { id: DutId; title: string; ports: 1 | 2; description: string }[];

const TAU = 2 * Math.PI;
const ZERO: Complex = Object.freeze({ re: 0, im: 0 });
const ONE: Complex = Object.freeze({ re: 1, im: 0 });
const STANDARDS = ['open', 'short', 'load'] as const;
export const complex = (re: number, im = 0): Complex => ({ re, im });
export const add = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
export const subtract = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });
export const multiply = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});
export const scale = (a: Complex, factor: number): Complex => ({
  re: a.re * factor,
  im: a.im * factor,
});
export const magnitude = (a: Complex): number => Math.hypot(a.re, a.im);
export const phaseDeg = (a: Complex): number => (Math.atan2(a.im, a.re) * 180) / Math.PI;
export function divide(a: Complex, b: Complex): Complex {
  const denominator = b.re * b.re + b.im * b.im;
  if (denominator < 1e-30) throw new RangeError('Cannot divide by a zero complex value.');
  return {
    re: (a.re * b.re + a.im * b.im) / denominator,
    im: (a.im * b.re - a.re * b.im) / denominator,
  };
}
export const polar = (amplitude: number, phaseRadians: number): Complex => ({
  re: amplitude * Math.cos(phaseRadians),
  im: amplitude * Math.sin(phaseRadians),
});

/** A finite graph floor represents a value below the visual display range. */
export function toDB(value: Complex | number, floorDb = -120): number {
  const amplitude = typeof value === 'number' ? Math.abs(value) : magnitude(value);
  if (!Number.isFinite(amplitude)) return Number.NaN;
  return amplitude === 0 ? floorDb : Math.max(floorDb, 20 * Math.log10(amplitude));
}
export function vswr(reflection: Complex | number): number {
  const gamma = typeof reflection === 'number' ? Math.abs(reflection) : magnitude(reflection);
  if (!Number.isFinite(gamma)) return Number.NaN;
  return gamma >= 1 - 1e-12 ? Infinity : (1 + gamma) / (1 - gamma);
}

export function validateSweep(sweep: SweepSettings): string[] {
  const errors: string[] = [];
  if (
    !Number.isFinite(sweep.startHz) ||
    sweep.startHz < MIN_FREQUENCY_HZ ||
    sweep.startHz > MAX_FREQUENCY_HZ
  )
    errors.push('Start frequency must be between 1 MHz and 6 GHz.');
  if (
    !Number.isFinite(sweep.stopHz) ||
    sweep.stopHz < MIN_FREQUENCY_HZ ||
    sweep.stopHz > MAX_FREQUENCY_HZ
  )
    errors.push('Stop frequency must be between 1 MHz and 6 GHz.');
  if (sweep.startHz >= sweep.stopHz)
    errors.push('Stop frequency must be greater than start frequency.');
  if (!Number.isInteger(sweep.points) || sweep.points < 2 || sweep.points > MAX_SWEEP_POINTS)
    errors.push('Choose an integer point count from 2 to 1601.');
  if (sweep.spacing !== 'linear' && sweep.spacing !== 'log')
    errors.push('Choose linear or logarithmic spacing.');
  if (!errors.length) {
    const grid = frequencyGrid(sweep);
    if (
      grid.some(
        (frequency, index) =>
          !Number.isFinite(frequency) ||
          frequency < sweep.startHz ||
          frequency > sweep.stopHz ||
          (index > 0 && frequency <= grid[index - 1]),
      )
    )
      errors.push(
        'The frequency span is too narrow for this point count at numeric precision. Widen the span or reduce the point count.',
      );
  }
  return errors;
}
function assertSweep(sweep: SweepSettings): void {
  const errors = validateSweep(sweep);
  if (errors.length) throw new RangeError(errors.join(' '));
}
export function sweepSignature(sweep: SweepSettings): string {
  return `${sweep.startHz}:${sweep.stopHz}:${sweep.points}:${sweep.spacing}`;
}
export function sweepFrequencies(sweep: SweepSettings): number[] {
  assertSweep(sweep);
  return frequencyGrid(sweep);
}
/** Does not validate or call sweepFrequencies: validation uses this same grid. */
function frequencyGrid(sweep: SweepSettings): number[] {
  const startLog = Math.log(sweep.startHz),
    spanLog = Math.log(sweep.stopHz) - startLog;
  return Array.from({ length: sweep.points }, (_, index) => {
    if (index === 0) return sweep.startHz;
    if (index === sweep.points - 1) return sweep.stopHz;
    const fraction = index / (sweep.points - 1);
    return sweep.spacing === 'log'
      ? Math.exp(startLog + fraction * spanLog)
      : sweep.startHz + (sweep.stopHz - sweep.startHz) * fraction;
  });
}

function reciprocalPoint(
  frequencyHz: number,
  reflection: Complex,
  transmission: Complex,
): SweepPoint {
  // Separate values avoid callers accidentally mutating both directions at once.
  return {
    frequencyHz,
    s11: { ...reflection },
    s21: { ...transmission },
    s12: { ...transmission },
    s22: { ...reflection },
  };
}
export function evaluateDut(id: DutId, frequencyHz: number): SweepPoint {
  if (
    !Number.isFinite(frequencyHz) ||
    frequencyHz < MIN_FREQUENCY_HZ ||
    frequencyHz > MAX_FREQUENCY_HZ
  )
    throw new RangeError('The teaching model covers 1 MHz to 6 GHz.');
  if (id === 'open' || id === 'short' || id === 'load') {
    return {
      frequencyHz,
      s11: complex(id === 'open' ? 1 : id === 'short' ? -1 : 0),
      s21: { ...ZERO },
      s12: { ...ZERO },
      s22: { ...ZERO },
    };
  }
  if (id === 'through') {
    const lossDb = 0.08 * Math.sqrt(frequencyHz / 1e9);
    return reciprocalPoint(
      frequencyHz,
      ZERO,
      polar(10 ** (-lossDb / 20), -TAU * frequencyHz * 2e-9),
    );
  }
  if (id === 'attenuator')
    return reciprocalPoint(frequencyHz, ZERO, polar(10 ** (-10 / 20), -TAU * frequencyHz * 0.5e-9));
  if (id === 'lowpass' || id === 'bandpass') {
    const x =
      id === 'lowpass'
        ? frequencyHz / 1e9
        : (frequencyHz / 2.4e9 - 2.4e9 / frequencyHz) / (0.8 / 2.4);
    // Equivalent normalized reactive shunt: t=1/(1+jx), r=-jx/(1+jx).
    // The ideal two-port is unitary; multiplying every S by <=1 adds loss.
    const denominator = complex(1, x);
    const lossDb = id === 'lowpass' ? 0.25 : 0.4;
    const common = polar(10 ** (-lossDb / 20), -TAU * frequencyHz * 0.25e-9);
    return reciprocalPoint(
      frequencyHz,
      multiply(divide(complex(0, -x), denominator), common),
      multiply(divide(ONE, denominator), common),
    );
  }
  if (id === 'mismatch') {
    const theta = TAU * frequencyHz * 3e-9;
    const ratio = 75 / 50;
    const denominator = complex(2 * Math.cos(theta), (ratio + 1 / ratio) * Math.sin(theta));
    return reciprocalPoint(
      frequencyHz,
      divide(complex(0, (ratio - 1 / ratio) * Math.sin(theta)), denominator),
      divide(complex(2), denominator),
    );
  }
  throw new RangeError('Choose a supported teaching DUT.');
}

/** Deliberately small, deterministic teaching errors, not instrument specifications. */
export function errorTermsAt(frequencyHz: number): OnePortErrorTerms {
  return {
    directivity: polar(0.025, 0.4 - TAU * frequencyHz * 0.08e-9),
    tracking: polar(0.94, -TAU * frequencyHz * 0.12e-9),
    sourceMatch: polar(0.07, -0.2 + TAU * frequencyHz * 0.04e-9),
  };
}
/** m = Ed + Er Γ / (1 - Es Γ), a simplified three-term reflection model. */
export function measureOnePort(reflection: Complex, terms: OnePortErrorTerms): Complex {
  return add(
    terms.directivity,
    divide(
      multiply(terms.tracking, reflection),
      subtract(ONE, multiply(terms.sourceMatch, reflection)),
    ),
  );
}
export function solveOnePortCalibration(
  open: Complex,
  short: Complex,
  load: Complex,
): OnePortErrorTerms {
  const a = subtract(open, load),
    b = subtract(short, load);
  const sourceMatch = divide(add(a, b), subtract(a, b));
  return {
    directivity: { ...load },
    sourceMatch,
    tracking: multiply(a, subtract(ONE, sourceMatch)),
  };
}
export function correctOnePort(measured: Complex, terms: OnePortErrorTerms): Complex {
  const residual = subtract(measured, terms.directivity);
  return divide(residual, add(terms.tracking, multiply(terms.sourceMatch, residual)));
}
export function createCalibration(sweep: SweepSettings): CalibrationState {
  assertSweep(sweep);
  return {
    kind: 'one-port-sol',
    sweep: { ...sweep },
    signature: sweepSignature(sweep),
    standards: {},
  };
}
export function recordStandard(
  state: CalibrationState,
  standard: CalibrationStandard,
): CalibrationState {
  if (!STANDARDS.includes(standard)) throw new RangeError('Choose open, short or load.');
  if (state.signature !== sweepSignature(state.sweep))
    throw new RangeError('Calibration sweep settings changed. Start a new calibration.');
  const reflection = complex(standard === 'open' ? 1 : standard === 'short' ? -1 : 0);
  const samples = sweepFrequencies(state.sweep).map((frequencyHz) =>
    measureOnePort(reflection, errorTermsAt(frequencyHz)),
  );
  return { ...state, standards: { ...state.standards, [standard]: samples } };
}
export function calibrationProgress(state: CalibrationState | null | undefined): number {
  return state
    ? STANDARDS.filter((standard) => state.standards[standard]?.length === state.sweep.points)
        .length
    : 0;
}
export function calibrationComplete(
  state: CalibrationState | null | undefined,
  sweep?: SweepSettings,
): boolean {
  if (
    !state ||
    state.kind !== 'one-port-sol' ||
    validateSweep(state.sweep).length ||
    state.signature !== sweepSignature(state.sweep)
  )
    return false;
  if (sweep && state.signature !== sweepSignature(sweep)) return false;
  return STANDARDS.every((standard) => {
    const samples = state.standards[standard];
    return (
      samples?.length === state.sweep.points &&
      samples.every((value) => Number.isFinite(value.re) && Number.isFinite(value.im))
    );
  });
}
export function sampleIdealSweep(sweep: SweepSettings, dut: DutId): SweepPoint[] {
  return sweepFrequencies(sweep).map((frequencyHz) => evaluateDut(dut, frequencyHz));
}
export function sampleSweep(
  sweep: SweepSettings,
  dut: DutId,
  calibration?: CalibrationState | null,
): SweepPoint[] {
  const compatible = calibrationComplete(calibration, sweep);
  return sampleIdealSweep(sweep, dut).map((point, index) => {
    const systematic = errorTermsAt(point.frequencyHz);
    let s11 = measureOnePort(point.s11, systematic);
    const s22 = measureOnePort(point.s22, systematic);
    if (compatible && calibration) {
      const solved = solveOnePortCalibration(
        calibration.standards.open![index],
        calibration.standards.short![index],
        calibration.standards.load![index],
      );
      s11 = correctOnePort(s11, solved);
    }
    return { ...point, s11, s22 };
  });
}

/**
 * Relative complex THRU response normalization, not a full two-port calibration.
 * This compares transmission with a captured trace; it neither corrects source/
 * load match nor changes reflection. A normalized response can exceed 0 dB when
 * its reference has more loss: that ratio is not a claim of DUT power gain.
 */
export function applyTransmissionReference(
  points: readonly SweepPoint[],
  reference: readonly SweepPoint[],
): SweepPoint[] {
  if (points.length < 2 || reference.length !== points.length)
    throw new RangeError(
      'The THRU reference must use the same frequency grid. Capture a new reference.',
    );
  return points.map((point, index) => {
    const captured = reference[index];
    if (!Number.isFinite(point.frequencyHz) || captured.frequencyHz !== point.frequencyHz)
      throw new RangeError(
        'The THRU reference must use the same frequency grid. Capture a new reference.',
      );
    if (
      ![captured.s21, captured.s12, point.s21, point.s12].every(
        (value) => Number.isFinite(value.re) && Number.isFinite(value.im),
      ) ||
      magnitude(captured.s21) < 1e-12 ||
      magnitude(captured.s12) < 1e-12
    )
      throw new RangeError(
        'The THRU reference has an invalid or zero transmission value. Capture a valid through connection.',
      );
    return {
      frequencyHz: point.frequencyHz,
      s11: { ...point.s11 },
      s22: { ...point.s22 },
      s21: divide(point.s21, captured.s21),
      s12: divide(point.s12, captured.s12),
    };
  });
}

/** Cartesian interpolation of the sampled response, clamped to sweep endpoints. */
export function markerAt(points: readonly SweepPoint[], frequencyHz: number): SweepPoint {
  if (!points.length) throw new RangeError('Run a sweep before placing a marker.');
  if (!Number.isFinite(frequencyHz)) throw new RangeError('Marker frequency must be finite.');
  const clone = (point: SweepPoint): SweepPoint => ({
    frequencyHz: point.frequencyHz,
    s11: { ...point.s11 },
    s21: { ...point.s21 },
    s12: { ...point.s12 },
    s22: { ...point.s22 },
  });
  if (frequencyHz <= points[0].frequencyHz) return clone(points[0]);
  if (frequencyHz >= points[points.length - 1].frequencyHz) return clone(points[points.length - 1]);
  let low = 0,
    high = points.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >>> 1;
    if (points[mid].frequencyHz <= frequencyHz) low = mid;
    else high = mid;
  }
  const left = points[low],
    right = points[high];
  const fraction = (frequencyHz - left.frequencyHz) / (right.frequencyHz - left.frequencyHz);
  const interpolate = (a: Complex, b: Complex): Complex => ({
    re: a.re + (b.re - a.re) * fraction,
    im: a.im + (b.im - a.im) * fraction,
  });
  return {
    frequencyHz,
    s11: interpolate(left.s11, right.s11),
    s21: interpolate(left.s21, right.s21),
    s12: interpolate(left.s12, right.s12),
    s22: interpolate(left.s22, right.s22),
  };
}
const phaseStep = (a: Complex, b: Complex): number =>
  Math.atan2(b.im * a.re - b.re * a.im, b.re * a.re + b.im * a.im);
/** Local unwrapped phase slope. Dense enough samples are required to avoid aliasing. */
export function groupDelay(
  points: readonly SweepPoint[],
  index: number,
  parameter: SParameter = 's21',
): number {
  if (points.length < 2 || index < 0 || index >= points.length) return Number.NaN;
  const first = Math.max(0, index - 1),
    last = Math.min(points.length - 1, index + 1);
  if (first === last) return Number.NaN;
  let delta = 0;
  for (let i = first; i < last; i++) {
    const a = points[i][parameter],
      b = points[i + 1][parameter];
    if (magnitude(a) < 1e-9 || magnitude(b) < 1e-9) return Number.NaN;
    delta += phaseStep(a, b);
  }
  const bandwidth = points[last].frequencyHz - points[first].frequencyHz;
  return bandwidth > 0 ? -delta / (TAU * bandwidth) : Number.NaN;
}
export function traceValue(
  points: readonly SweepPoint[],
  index: number,
  parameter: SParameter,
  format: TraceFormat,
): number {
  const point = points[index];
  if (!point) return Number.NaN;
  const value = point[parameter];
  switch (format) {
    case 'logmag':
      return toDB(value);
    case 'phase':
      return magnitude(value) < 1e-9 ? Number.NaN : phaseDeg(value);
    case 'vswr':
      return parameter === 's11' || parameter === 's22' ? vswr(value) : Number.NaN;
    case 'groupdelay':
      return groupDelay(points, index, parameter);
    case 'real':
      return value.re;
    case 'imag':
      return value.im;
  }
}
