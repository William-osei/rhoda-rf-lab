/** Pure marker/readout rules shared by the plotted marker and numeric display. */
import {
  groupDelay,
  magnitude,
  markerAt,
  phaseDeg,
  toDB,
  vswr,
  type SParameter,
  type SweepPoint,
  type TraceFormat,
} from './simulation';

export interface MarkerReadout {
  frequencyHz: number;
  magnitudeDb: number;
  belowDisplayFloor: boolean;
  phaseDegrees: number | null;
  standingWaveRatio: number | null;
  groupDelaySeconds: number | null;
}

function bracket(
  points: readonly SweepPoint[],
  frequencyHz: number,
): { left: number; right: number; fraction: number } {
  if (frequencyHz <= points[0].frequencyHz) return { left: 0, right: 0, fraction: 0 };
  const last = points.length - 1;
  if (frequencyHz >= points[last].frequencyHz) return { left: last, right: last, fraction: 0 };
  let left = 0,
    right = last;
  while (right - left > 1) {
    const middle = (left + right) >>> 1;
    if (points[middle].frequencyHz <= frequencyHz) left = middle;
    else right = middle;
  }
  return {
    left,
    right,
    fraction:
      (frequencyHz - points[left].frequencyHz) /
      (points[right].frequencyHz - points[left].frequencyHz),
  };
}

/**
 * Magnitude/phase/VSWR use the same Cartesian-interpolated complex marker as the
 * chart. Group delay is an estimate from sampled local phase slopes, interpolated
 * between the bracketing samples; it is not a higher-resolution acquisition.
 */
export function markerReadout(
  points: readonly SweepPoint[],
  frequencyHz: number,
  parameter: SParameter,
): MarkerReadout {
  const point = markerAt(points, frequencyHz);
  const value = point[parameter];
  const amplitude = magnitude(value);
  const phaseDefined = Number.isFinite(amplitude) && amplitude >= 1e-9;
  const location = bracket(points, point.frequencyHz);
  const leftDelay = groupDelay(points, location.left, parameter);
  const rightDelay =
    location.right === location.left ? leftDelay : groupDelay(points, location.right, parameter);
  const delay =
    phaseDefined && Number.isFinite(leftDelay) && Number.isFinite(rightDelay)
      ? leftDelay + location.fraction * (rightDelay - leftDelay)
      : null;
  return {
    frequencyHz: point.frequencyHz,
    magnitudeDb: toDB(value),
    belowDisplayFloor: Number.isFinite(amplitude) && amplitude <= 1e-6,
    phaseDegrees: phaseDefined ? phaseDeg(value) : null,
    standingWaveRatio: parameter === 's11' || parameter === 's22' ? vswr(value) : null,
    groupDelaySeconds: delay,
  };
}

/** Use this for the plotted marker so it cannot disagree with the text readout. */
export function markerTraceValue(
  points: readonly SweepPoint[],
  frequencyHz: number,
  parameter: SParameter,
  format: TraceFormat,
): number {
  const readout = markerReadout(points, frequencyHz, parameter);
  switch (format) {
    case 'logmag':
      return readout.magnitudeDb;
    case 'phase':
      return readout.phaseDegrees ?? Number.NaN;
    case 'vswr':
      return readout.standingWaveRatio ?? Number.NaN;
    case 'groupdelay':
      return readout.groupDelaySeconds ?? Number.NaN;
    case 'real':
      return markerAt(points, frequencyHz)[parameter].re;
    case 'imag':
      return markerAt(points, frequencyHz)[parameter].im;
  }
}

export function formatMagnitude(
  readout: Pick<MarkerReadout, 'magnitudeDb' | 'belowDisplayFloor'>,
): string {
  if (!Number.isFinite(readout.magnitudeDb)) return 'Not defined';
  return `${readout.belowDisplayFloor ? '≤ ' : ''}${readout.magnitudeDb.toFixed(2)} dB`;
}
export function formatPhase(value: number | null): string {
  return value !== null && Number.isFinite(value) ? `${value.toFixed(1)}°` : 'Not defined';
}
export function formatDelay(value: number | null): string {
  return value !== null && Number.isFinite(value)
    ? `${(value * 1e9).toFixed(2)} ns`
    : 'Not defined';
}
export function formatVSWR(value: number | null): string {
  if (value === Infinity) return '∞ : 1';
  return value !== null && Number.isFinite(value) && value >= 1
    ? `${value.toFixed(2)} : 1`
    : 'Not defined';
}

/**
 * Adjacent phase samples cannot unambiguously resolve delays above 1/(2 Δf).
 * Report the most restrictive interval. This is a sampling limit, not a claim
 * that an unknown device's actual delay can be inferred from aliased samples.
 */
export function phaseSamplingLimitSeconds(points: readonly SweepPoint[]): number | null {
  if (points.length < 2) return null;
  let maximumStep = 0;
  for (let index = 1; index < points.length; index++) {
    const step = points[index].frequencyHz - points[index - 1].frequencyHz;
    if (!Number.isFinite(step) || step <= 0) return null;
    maximumStep = Math.max(maximumStep, step);
  }
  return maximumStep > 0 ? 1 / (2 * maximumStep) : null;
}

export interface MarkerComparison {
  a: MarkerReadout;
  b: MarkerReadout;
  /** Signed M2-minus-M1 difference, using the actual bounded marker frequencies. */
  deltaFrequencyHz: number;
  /** Null if either displayed magnitude is only a below-floor bound. */
  deltaMagnitudeDb: number | null;
}

export function compareMarkers(
  points: readonly SweepPoint[],
  aHz: number,
  bHz: number,
  parameter: SParameter,
): MarkerComparison {
  const a = markerReadout(points, aHz, parameter);
  const b = markerReadout(points, bHz, parameter);
  return {
    a,
    b,
    deltaFrequencyHz: b.frequencyHz - a.frequencyHz,
    deltaMagnitudeDb:
      !a.belowDisplayFloor &&
      !b.belowDisplayFloor &&
      Number.isFinite(a.magnitudeDb) &&
      Number.isFinite(b.magnitudeDb)
        ? b.magnitudeDb - a.magnitudeDb
        : null,
  };
}

export interface PassbandAnalysis {
  status: 'complete' | 'incomplete' | 'no-signal' | 'no-data';
  peakIndex: number | null;
  peakFrequencyHz: number | null;
  peakMagnitudeDb: number | null;
  thresholdDb: number | null;
  lowHz: number | null;
  highHz: number | null;
  bandwidthHz: number | null;
}

/**
 * Find the contiguous sampled main-peak region within 3 dB of its maximum.
 * Crossings use the same Cartesian complex interpolation as markerAt(), so a
 * marker placed at an edge reads the threshold. Nothing outside the captured
 * range is extrapolated. Unresolved sub-sample notches or other lobes are not
 * certified by this estimate; this is a teaching aid, not a hardware result.
 */
export function analyzeTransmissionPassband(
  points: readonly SweepPoint[],
  parameter: 's21' | 's12' = 's21',
): PassbandAnalysis {
  const empty: PassbandAnalysis = {
    status: 'no-data',
    peakIndex: null,
    peakFrequencyHz: null,
    peakMagnitudeDb: null,
    thresholdDb: null,
    lowHz: null,
    highHz: null,
    bandwidthHz: null,
  };
  if (parameter !== 's21' && parameter !== 's12')
    throw new RangeError('Passband analysis requires a transmission parameter.');
  if (!points.length) return empty;
  let previousFrequency = 0;
  const amplitudes = points.map((point) => {
    const value = point[parameter];
    if (
      !Number.isFinite(point.frequencyHz) ||
      point.frequencyHz <= previousFrequency ||
      !Number.isFinite(value.re) ||
      !Number.isFinite(value.im)
    )
      throw new RangeError(
        'Passband analysis requires finite data on an increasing positive frequency grid.',
      );
    previousFrequency = point.frequencyHz;
    return magnitude(value);
  });
  const peakIndex = amplitudes.reduce(
    (best, amplitude, index) => (amplitude > amplitudes[best] ? index : best),
    0,
  );
  const peakAmplitude = amplitudes[peakIndex];
  if (peakAmplitude === 0) return { ...empty, status: 'no-signal' };
  const peakMagnitudeDb = 20 * Math.log10(peakAmplitude);
  const thresholdAmplitude = peakAmplitude * 10 ** (-3 / 20);
  const crossing = (left: number, right: number): number => {
    const a = points[left][parameter],
      b = points[right][parameter];
    let start = 0,
      end = 1;
    const startIsAbove = amplitudes[left] > thresholdAmplitude;
    // An above/below endpoint bracket is continuous. Bisection avoids dB of
    // zero and keeps the estimated edge consistent with complex marker values.
    for (let iteration = 0; iteration < 52; iteration++) {
      const fraction = (start + end) / 2;
      const amplitude = Math.hypot(
        a.re + (b.re - a.re) * fraction,
        a.im + (b.im - a.im) * fraction,
      );
      if (amplitude > thresholdAmplitude === startIsAbove) start = fraction;
      else end = fraction;
    }
    return (
      points[left].frequencyHz +
      ((points[right].frequencyHz - points[left].frequencyHz) * (start + end)) / 2
    );
  };
  let lowHz: number | null = null,
    highHz: number | null = null;
  for (let index = peakIndex - 1; index >= 0; index--) {
    if (amplitudes[index] <= thresholdAmplitude) {
      lowHz =
        amplitudes[index] === thresholdAmplitude
          ? points[index].frequencyHz
          : crossing(index, index + 1);
      break;
    }
  }
  for (let index = peakIndex + 1; index < points.length; index++) {
    if (amplitudes[index] <= thresholdAmplitude) {
      highHz =
        amplitudes[index] === thresholdAmplitude
          ? points[index].frequencyHz
          : crossing(index - 1, index);
      break;
    }
  }
  const bandwidthHz = lowHz !== null && highHz !== null ? highHz - lowHz : null;
  return {
    status: bandwidthHz !== null ? 'complete' : 'incomplete',
    peakIndex,
    peakFrequencyHz: points[peakIndex].frequencyHz,
    peakMagnitudeDb,
    thresholdDb: peakMagnitudeDb - 3,
    lowHz,
    highHz,
    bandwidthHz,
  };
}
