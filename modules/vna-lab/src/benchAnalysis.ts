import { magnitude, markerAt, toDB, type Complex, type SParameter, type SweepPoint } from './simulation';

/**
 * Power-wave ratios for a real 50-ohm reference with the other port matched and
 * not independently driven. Accepted-at-input power is not synonymous with
 * dissipated power or forward-transmitted power. No passivity test is performed.
 * Definitions: R&S Essentials, "Voltage standing wave ratio (VSWR) and return
 * loss" and "Understanding S-parameters" (linked in REFERENCES.md).
 */
export interface ReflectionMetrics {
  gammaMagnitude: number | null;
  returnLossDb: number | null;
  reflectedPowerPercent: number | null;
  acceptedPowerPercent: number | null;
  mismatchLossDb: number | null;
  /** True means the scalar passive-load formulas have a valid domain, not that a network has been proven passive. */
  passiveInterpretation: boolean;
  /** Only an above-one double-rounding overshoot (<= 16 epsilon) is adjusted. */
  boundaryAdjusted: boolean;
  warning: string | null;
}

export function reflectionMetrics(gamma: Complex): ReflectionMetrics {
  const amplitude = magnitude(gamma);
  if (!Number.isFinite(gamma.re) || !Number.isFinite(gamma.im) || !Number.isFinite(amplitude)) {
    return {
      gammaMagnitude: null, returnLossDb: null, reflectedPowerPercent: null,
      acceptedPowerPercent: null, mismatchLossDb: null, passiveInterpretation: false,
      boundaryAdjusted: false, warning: 'Reflection metrics are undefined for non-finite data.',
    };
  }
  const powerFraction = amplitude * amplitude;
  const ratioPercent = powerFraction * 100;
  const returnLossDb = amplitude === 0 ? Infinity : amplitude === 1 ? 0 : -20 * Math.log10(amplitude);
  // Algebraic inversion of the synthetic SOL can overshoot unity by a few ULPs.
  // This tolerance is floating-point representation only, not error bars or a
  // calibration uncertainty. Larger raw values do not receive passive metrics.
  const boundaryAdjusted = amplitude > 1 && amplitude <= 1 + 16 * Number.EPSILON;
  const passiveInterpretation = amplitude <= 1 || boundaryAdjusted;
  const acceptedFraction = passiveInterpretation ? (boundaryAdjusted ? 0 : 1 - powerFraction) : null;
  return {
    gammaMagnitude: amplitude,
    returnLossDb,
    reflectedPowerPercent: Number.isFinite(ratioPercent) ? ratioPercent : null,
    acceptedPowerPercent: acceptedFraction === null ? null : acceptedFraction * 100,
    mismatchLossDb: acceptedFraction === null ? null : acceptedFraction === 0 ? Infinity
      : acceptedFraction === 1 ? 0 : -10 * Math.log10(acceptedFraction),
    passiveInterpretation,
    boundaryAdjusted,
    warning: passiveInterpretation ? null
      : 'Reflection magnitude exceeds one. Accepted-power and mismatch-loss formulas for a passive load are not applicable to this raw response. This is not evidence of physical gain.',
  };
}

export function analyzeReflection(
  points: readonly SweepPoint[],
  frequencyHz: number,
  parameter: 's11' | 's22' = 's11',
): ReflectionMetrics & { frequencyHz: number; parameter: 's11' | 's22' } {
  if (parameter !== 's11' && parameter !== 's22') throw new RangeError('Reflection metrics require S11 or S22, not a transmission coefficient.');
  const point = markerAt(points, frequencyHz);
  return { ...reflectionMetrics(point[parameter]), frequencyHz: point.frequencyHz, parameter };
}

function checkFrequencyGrid(points: readonly SweepPoint[]): void {
  let previous = 0;
  for (const point of points) {
    if (!Number.isFinite(point.frequencyHz) || point.frequencyHz <= previous)
      throw new RangeError('Marker search requires a positive, strictly increasing frequency grid.');
    previous = point.frequencyHz;
  }
}

/** Return the closest acquired sample; out-of-range inputs clamp, midpoint ties use the lower sample. */
export function nearestSampleIndex(points: readonly SweepPoint[], frequencyHz: number): number | null {
  if (!Number.isFinite(frequencyHz)) throw new RangeError('Marker frequency must be finite.');
  if (!points.length) return null;
  checkFrequencyGrid(points);
  if (frequencyHz <= points[0].frequencyHz) return 0;
  const last = points.length - 1;
  if (frequencyHz >= points[last].frequencyHz) return last;
  let low = 0, high = last;
  while (high - low > 1) {
    const middle = (low + high) >>> 1;
    if (points[middle].frequencyHz <= frequencyHz) low = middle; else high = middle;
  }
  return frequencyHz - points[low].frequencyHz <= points[high].frequencyHz - frequencyHz ? low : high;
}

export interface SampledMagnitudeExtreme {
  index: number;
  frequencyHz: number;
  /** A value at the display floor is only an upper bound; consult belowDisplayFloor. */
  magnitudeDb: number;
  belowDisplayFloor: boolean;
  /** All sampled magnitudes agree within the numerical tie tolerance. */
  flat: boolean;
  tiedSamples: number;
}

/**
 * Search actual sampled magnitude, not phase or the currently selected y-axis.
 * Values within 1e-9 dB count as ties to avoid treating roundoff in a constant
 * attenuator as a resonance. Ties choose the sample closest to the marker;
 * equal distances choose the lower frequency. No interpolated peak is invented.
 * An all-zero trace has no defined finite magnitude extremum and returns null.
 */
export function findSampledMagnitudeExtreme(
  points: readonly SweepPoint[],
  parameter: SParameter,
  kind: 'max' | 'min',
  anchorHz?: number,
): SampledMagnitudeExtreme | null {
  if (kind !== 'max' && kind !== 'min') throw new RangeError('Choose maximum or minimum magnitude search.');
  if (!['s11', 's21', 's12', 's22'].includes(parameter)) throw new RangeError('Choose a supported S-parameter.');
  if (anchorHz !== undefined && !Number.isFinite(anchorHz)) throw new RangeError('Search anchor frequency must be finite.');
  if (!points.length) return null;
  checkFrequencyGrid(points);
  const amplitudes = points.map(point => {
    const value = point[parameter];
    const amplitude = magnitude(value);
    if (!Number.isFinite(value.re) || !Number.isFinite(value.im) || !Number.isFinite(amplitude))
      throw new RangeError('Magnitude search requires finite complex samples.');
    return amplitude;
  });
  if (amplitudes.every(amplitude => amplitude === 0)) return null;
  const values = amplitudes.map(amplitude => amplitude === 0 ? -Infinity : 20 * Math.log10(amplitude));
  const extreme = kind === 'max' ? Math.max(...values) : Math.min(...values);
  const equal = (a: number, b: number) => a === b || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9);
  const candidates = values.flatMap((value, index) => equal(value, extreme) ? [index] : []);
  const anchor = anchorHz ?? points[0].frequencyHz;
  const index = candidates.reduce((best, candidate) =>
    Math.abs(points[candidate].frequencyHz - anchor) < Math.abs(points[best].frequencyHz - anchor) ? candidate : best,
  );
  return {
    index,
    frequencyHz: points[index].frequencyHz,
    magnitudeDb: toDB(amplitudes[index]),
    belowDisplayFloor: amplitudes[index] <= 1e-6,
    flat: values.every(value => equal(value, values[0])),
    tiedSamples: candidates.length,
  };
}
