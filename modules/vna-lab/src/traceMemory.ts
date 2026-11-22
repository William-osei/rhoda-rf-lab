/** In-page trace comparison. This module never persists data or changes a sweep. */
import { MAX_SWEEP_POINTS, type SParameter, type SweepPoint } from './simulation';
import { markerReadout, type MarkerReadout } from './tracePresentation';

export interface TraceMemoryMetadata {
  dutTitle: string;
  parameter: SParameter;
  correctionLabel: string;
}

export interface TraceMemory {
  readonly points: readonly SweepPoint[];
  readonly dutTitle: string;
  readonly parameter: SParameter;
  readonly correctionLabel: string;
}

export interface MemoryCompatibility {
  usable: boolean;
  status:
    | 'ready'
    | 'no-memory'
    | 'invalid-memory'
    | 'invalid-current'
    | 'parameter-mismatch'
    | 'grid-mismatch';
  reason: string;
}

export interface TraceMemoryComparison {
  current: MarkerReadout;
  stored: MarkerReadout;
  /** Signed current-minus-stored dB difference. Null if either magnitude is only a floor bound. */
  deltaMagnitudeDb: number | null;
}

const PARAMETERS: readonly SParameter[] = ['s11', 's21', 's12', 's22'];
const isParameter = (value: unknown): value is SParameter =>
  typeof value === 'string' && PARAMETERS.includes(value as SParameter);

function dataProblem(points: readonly SweepPoint[]): string | null {
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_SWEEP_POINTS)
    return `A complete trace needs 2–${MAX_SWEEP_POINTS} samples.`;
  let previousFrequency = 0;
  for (const point of points) {
    if (
      !point ||
      !Number.isFinite(point.frequencyHz) ||
      point.frequencyHz <= previousFrequency
    )
      return 'Trace frequencies must be finite, positive and strictly increasing.';
    previousFrequency = point.frequencyHz;
    for (const parameter of PARAMETERS) {
      const value = point[parameter];
      if (!value || !Number.isFinite(value.re) || !Number.isFinite(value.im))
        return 'A trace must contain finite complex values for all four S-parameters.';
    }
  }
  return null;
}

function metadataProblem(metadata: TraceMemoryMetadata): string | null {
  if (!metadata || !isParameter(metadata.parameter)) return 'Choose a supported S-parameter.';
  if (
    typeof metadata.dutTitle !== 'string' ||
    !metadata.dutTitle.trim() ||
    metadata.dutTitle.length > 160 ||
    typeof metadata.correctionLabel !== 'string' ||
    !metadata.correctionLabel.trim() ||
    metadata.correctionLabel.length > 240
  )
    return 'Trace memory needs a device title and correction label of bounded length.';
  return null;
}

/**
 * Copy and freeze every point and complex value. Later mutations of the current
 * sweep, including correction or DUT changes, cannot rewrite the stored trace.
 */
export function storeTrace(
  points: readonly SweepPoint[],
  metadata: TraceMemoryMetadata,
): TraceMemory {
  const problem = dataProblem(points) ?? metadataProblem(metadata);
  if (problem) throw new RangeError(problem);
  const copied = points.map((point) =>
    Object.freeze({
      frequencyHz: point.frequencyHz,
      s11: Object.freeze({ re: point.s11.re, im: point.s11.im }),
      s21: Object.freeze({ re: point.s21.re, im: point.s21.im }),
      s12: Object.freeze({ re: point.s12.re, im: point.s12.im }),
      s22: Object.freeze({ re: point.s22.re, im: point.s22.im }),
    }),
  );
  return Object.freeze({
    points: Object.freeze(copied),
    dutTitle: metadata.dutTitle.trim(),
    parameter: metadata.parameter,
    correctionLabel: metadata.correctionLabel.trim(),
  });
}

/**
 * Exact grid and selected-parameter agreement are required. Device and
 * correction labels may differ deliberately: those are useful comparisons.
 * A changed grid is never silently interpolated or resampled into agreement.
 */
export function getMemoryCompatibility(
  memory: TraceMemory | null | undefined,
  currentPoints: readonly SweepPoint[],
  currentParameter: SParameter,
): MemoryCompatibility {
  if (!memory)
    return { usable: false, status: 'no-memory', reason: 'Store a trace to start a comparison.' };
  const memoryProblem = metadataProblem(memory) ?? dataProblem(memory.points);
  if (memoryProblem)
    return { usable: false, status: 'invalid-memory', reason: `Stored trace unavailable. ${memoryProblem}` };
  const currentProblem = dataProblem(currentPoints);
  if (currentProblem)
    return { usable: false, status: 'invalid-current', reason: `Current trace unavailable. ${currentProblem}` };
  if (!isParameter(currentParameter) || memory.parameter !== currentParameter)
    return {
      usable: false,
      status: 'parameter-mismatch',
      reason: `Memory contains ${memory.parameter.toUpperCase()}. Select that parameter or store a new trace.`,
    };
  if (
    memory.points.length !== currentPoints.length ||
    memory.points.some((point, index) => point.frequencyHz !== currentPoints[index].frequencyHz)
  )
    return {
      usable: false,
      status: 'grid-mismatch',
      reason: 'The frequency grid changed. Restore the same sweep grid or store a new trace.',
    };
  return {
    usable: true,
    status: 'ready',
    reason: `Comparing current ${currentParameter.toUpperCase()} with the stored trace on the same frequency grid.`,
  };
}

/**
 * Compare the stored parameter using the shared Cartesian marker interpolation.
 * The UI must first check compatibility with its currently selected parameter.
 * Out-of-range finite marker frequencies clamp consistently to the same endpoint.
 */
export function compareTraceMemory(
  currentPoints: readonly SweepPoint[],
  memory: TraceMemory,
  markerHz: number,
): TraceMemoryComparison {
  const compatibility = getMemoryCompatibility(memory, currentPoints, memory?.parameter);
  if (!compatibility.usable) throw new RangeError(compatibility.reason);
  if (!Number.isFinite(markerHz)) throw new RangeError('Choose a finite marker frequency.');
  const current = markerReadout(currentPoints, markerHz, memory.parameter);
  const stored = markerReadout(memory.points, markerHz, memory.parameter);
  return {
    current,
    stored,
    deltaMagnitudeDb:
      !current.belowDisplayFloor &&
      !stored.belowDisplayFloor &&
      Number.isFinite(current.magnitudeDb) &&
      Number.isFinite(stored.magnitudeDb)
        ? current.magnitudeDb - stored.magnitudeDb
        : null,
  };
}
