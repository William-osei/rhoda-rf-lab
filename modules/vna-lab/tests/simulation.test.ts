import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SWEEP,
  DUTS,
  MAX_SWEEP_POINTS,
  add,
  applyTransmissionReference,
  calibrationComplete,
  calibrationProgress,
  complex,
  correctOnePort,
  createCalibration,
  divide,
  errorTermsAt,
  evaluateDut,
  groupDelay,
  magnitude,
  markerAt,
  measureOnePort,
  multiply,
  phaseDeg,
  recordStandard,
  sampleIdealSweep,
  sampleSweep,
  solveOnePortCalibration,
  sweepFrequencies,
  toDB,
  traceValue,
  validateSweep,
  vswr,
  type CalibrationState,
  type Complex,
  type SweepSettings,
} from '../src/simulation';

const expectComplex = (actual: Complex, expected: Complex, digits = 10) => {
  expect(actual.re).toBeCloseTo(expected.re, digits);
  expect(actual.im).toBeCloseTo(expected.im, digits);
};
const fullCalibration = (sweep: SweepSettings = { ...DEFAULT_SWEEP }): CalibrationState => {
  let state = createCalibration(sweep);
  for (const standard of ['open', 'short', 'load'] as const)
    state = recordStandard(state, standard);
  return state;
};

describe('complex arithmetic and readouts', () => {
  it('preserves a complex value through multiplication/division and rejects a zero divisor', () => {
    const a = complex(0.3, -0.7),
      b = complex(-0.4, 0.9);
    expectComplex(divide(multiply(a, b), b), a);
    expectComplex(add(a, complex(0.7, 0.7)), complex(1));
    expect(() => divide(a, complex(0))).toThrow(RangeError);
  });
  it('uses voltage-wave dB, phase and reflection-only VSWR conventions', () => {
    expect(toDB(0.1)).toBeCloseTo(-20);
    expect(toDB(complex(0))).toBe(-120);
    expect(phaseDeg(complex(0, 1))).toBeCloseTo(90);
    expect(vswr(complex(0))).toBe(1);
    expect(vswr(0.5)).toBe(3);
    expect(vswr(complex(1))).toBe(Infinity);
    expect(vswr(1.01)).toBe(Infinity);
  });
});

describe('valid bounded frequency sweeps', () => {
  it('contains exact endpoints with uniform linear or geometric logarithmic spacing', () => {
    const linear = sweepFrequencies({ startHz: 1e6, stopHz: 5e6, points: 5, spacing: 'linear' });
    expect(linear).toEqual([1e6, 2e6, 3e6, 4e6, 5e6]);
    const log = sweepFrequencies({ startHz: 1e6, stopHz: 1e9, points: 4, spacing: 'log' });
    [1e6, 1e7, 1e8, 1e9].forEach((value, i) => expect(log[i] / value).toBeCloseTo(1, 12));
  });
  it.each([
    { startHz: 0 },
    { stopHz: 6.1e9 },
    { startHz: 6e9, stopHz: 1e6 },
    { points: 1 },
    { points: MAX_SWEEP_POINTS + 1 },
    { points: 20.5 },
    { startHz: Infinity },
    { stopHz: Number.NaN },
    { spacing: 'unknown' },
  ])('rejects invalid user-controlled settings %j before allocating points', (change) => {
    const sweep = { ...DEFAULT_SWEEP, ...change } as SweepSettings;
    expect(validateSweep(sweep).length).toBeGreaterThan(0);
    expect(() => sampleSweep(sweep, 'through')).toThrow(RangeError);
  });
  it.each(['linear', 'log'] as const)(
    'rejects a %s span whose samples collapse at floating-point precision',
    (spacing) => {
      const sweep = { startHz: 1e9, stopHz: 1e9 + 1e-7, points: 401, spacing };
      expect(sweep.stopHz).toBeGreaterThan(sweep.startHz);
      expect(validateSweep(sweep).join(' ')).toContain('numeric precision');
      expect(() => sweepFrequencies(sweep)).toThrow(/numeric precision/);
      expect(() => createCalibration(sweep)).toThrow(/numeric precision/);
    },
  );
  it.each(['linear', 'log'] as const)(
    'preserves a narrow %s sweep when its two endpoints remain distinct',
    (spacing) => {
      const sweep = { startHz: 1e9, stopHz: 1e9 + 1e-7, points: 2, spacing };
      expect(validateSweep(sweep)).toEqual([]);
      expect(sweepFrequencies(sweep)).toEqual([sweep.startHz, sweep.stopHz]);
    },
  );
});

describe('analytic DUT behavior', () => {
  it('distinguishes ideal open, short and matched-load reflection', () => {
    expectComplex(evaluateDut('open', 1e9).s11, complex(1));
    expectComplex(evaluateDut('short', 1e9).s11, complex(-1));
    expectComplex(evaluateDut('load', 1e9).s11, complex(0));
    expect(evaluateDut('open', 1e9).s21).toEqual(complex(0));
  });
  it('has the intended attenuation and filter landmarks', () => {
    expect(toDB(evaluateDut('attenuator', 1e9).s21)).toBeCloseTo(-10, 10);
    expect(toDB(evaluateDut('lowpass', 1e9).s21)).toBeCloseTo(-3.01029995664 - 0.25, 9);
    expect(toDB(evaluateDut('bandpass', 2.4e9).s21)).toBeCloseTo(-0.4, 10);
    expect(magnitude(evaluateDut('bandpass', 2.4e9).s11)).toBeCloseTo(0, 10);
    expect(magnitude(evaluateDut('bandpass', 1e9).s21)).toBeLessThan(0.2);
    // The modeled resonator has exactly 0.8 GHz between its ideal -3dB points.
    const q = 0.8 / 2.4;
    const upper = (2.4e9 * (Math.sqrt(q * q + 4) + q)) / 2;
    const lower = (2.4e9 * (Math.sqrt(q * q + 4) - q)) / 2;
    expect(upper - lower).toBeCloseTo(0.8e9, 4);
    expect(toDB(evaluateDut('bandpass', upper).s21)).toBeCloseTo(-3.41029995664, 9);
    expect(toDB(evaluateDut('bandpass', lower).s21)).toBeCloseTo(-3.41029995664, 9);
  });
  it('keeps every ideal two-port reciprocal and passive for arbitrary simultaneous incident waves', () => {
    for (const dut of DUTS.filter((value) => value.ports === 2)) {
      for (const point of sampleIdealSweep({ ...DEFAULT_SWEEP, points: 151 }, dut.id)) {
        expectComplex(point.s12, point.s21);
        expectComplex(point.s22, point.s11);
        // A symmetric reciprocal matrix diagonalizes in the +/- eigenvectors.
        // Bounding both eigenvalue magnitudes tests the full operator, not only
        // independent column powers (which alone would miss coherent gain).
        expect(magnitude(add(point.s11, point.s21))).toBeLessThanOrEqual(1 + 1e-12);
        expect(
          magnitude(complex(point.s11.re - point.s21.re, point.s11.im - point.s21.im)),
        ).toBeLessThanOrEqual(1 + 1e-12);
      }
    }
  });
  it('returns a 2 ns cable group delay through wrapped phase and at endpoints', () => {
    const points = sampleIdealSweep({ ...DEFAULT_SWEEP }, 'through');
    [0, 1, 145, 399, 400].forEach((index) =>
      expect(groupDelay(points, index, 's21')).toBeCloseTo(2e-9, 16),
    );
    expect(traceValue(points, 100, 's21', 'groupdelay')).toBeCloseTo(2e-9, 16);
    expect(Number.isNaN(traceValue(points, 100, 's21', 'vswr'))).toBe(true);
    expect(Number.isNaN(traceValue(points, 100, 's11', 'phase'))).toBe(true);
  });
});

describe('simplified one-port SOL correction', () => {
  it('solves all three complex terms and restores arbitrary passive reflection', () => {
    for (const frequency of [1e6, 1e9, 2.4e9, 6e9]) {
      const terms = errorTermsAt(frequency);
      const solved = solveOnePortCalibration(
        measureOnePort(complex(1), terms),
        measureOnePort(complex(-1), terms),
        measureOnePort(complex(0), terms),
      );
      expectComplex(solved.directivity, terms.directivity);
      expectComplex(solved.tracking, terms.tracking);
      expectComplex(solved.sourceMatch, terms.sourceMatch);
      const actual = complex(0.2, -0.6);
      expectComplex(correctOnePort(measureOnePort(actual, terms), solved), actual);
    }
  });
  it('requires each standard, uses immutable snapshots and invalidates any changed sweep', () => {
    const initial = createCalibration({ ...DEFAULT_SWEEP });
    const one = recordStandard(initial, 'open');
    expect(calibrationProgress(initial)).toBe(0);
    expect(calibrationProgress(one)).toBe(1);
    expect(calibrationComplete(one)).toBe(false);
    const complete = fullCalibration();
    expect(calibrationProgress(complete)).toBe(3);
    expect(calibrationComplete(complete, { ...DEFAULT_SWEEP })).toBe(true);
    for (const change of [
      { startHz: 2e6 },
      { stopHz: 5e9 },
      { points: 301 },
      { spacing: 'log' as const },
    ])
      expect(calibrationComplete(complete, { ...DEFAULT_SWEEP, ...change })).toBe(false);
    expect(calibrationComplete(null)).toBe(false);
  });
  it('removes deterministic reflection errors but does not alter idealized transmission', () => {
    const sweep = { ...DEFAULT_SWEEP, points: 41 };
    const ideal = sampleIdealSweep(sweep, 'lowpass');
    const raw = sampleSweep(sweep, 'lowpass');
    const corrected = sampleSweep(sweep, 'lowpass', fullCalibration(sweep));
    expect(
      magnitude(complex(raw[10].s11.re - ideal[10].s11.re, raw[10].s11.im - ideal[10].s11.im)),
    ).toBeGreaterThan(0.01);
    corrected.forEach((point, index) => {
      expectComplex(point.s11, ideal[index].s11);
      expectComplex(point.s22, raw[index].s22);
      expectComplex(point.s21, raw[index].s21);
    });
  });
  it('leaves incompatible or incomplete calibration visibly uncorrected and rejects singular standards', () => {
    const sweep = { ...DEFAULT_SWEEP, points: 11 };
    expect(sampleSweep(sweep, 'load', fullCalibration())).toEqual(sampleSweep(sweep, 'load'));
    expect(sampleSweep(sweep, 'load', recordStandard(createCalibration(sweep), 'load'))).toEqual(
      sampleSweep(sweep, 'load'),
    );
    expect(() => solveOnePortCalibration(complex(0), complex(0), complex(0))).toThrow(RangeError);
  });
});

describe('relative THRU response normalization', () => {
  it('removes the captured complex reference from transmission and preserves reflection', () => {
    const sweep = { ...DEFAULT_SWEEP, points: 41 };
    const reference = sampleSweep(sweep, 'through');
    const normalizedThrough = applyTransmissionReference(reference, reference);
    normalizedThrough.forEach((point, index) => {
      expectComplex(point.s21, complex(1));
      expectComplex(point.s12, complex(1));
      expectComplex(point.s11, reference[index].s11);
      expectComplex(point.s22, reference[index].s22);
    });
    const response = sampleSweep(sweep, 'attenuator');
    const normalized = applyTransmissionReference(response, reference);
    normalized.forEach((point, index) => {
      expectComplex(multiply(point.s21, reference[index].s21), response[index].s21);
      expectComplex(point.s11, response[index].s11);
    });
    normalized[0].s11.re = 99;
    expect(response[0].s11.re).not.toBe(99);
  });
  it('rejects changed frequency grids, absent/zero references and nonfinite data', () => {
    const sweep = { ...DEFAULT_SWEEP, points: 4 };
    const points = sampleSweep(sweep, 'through');
    expect(() => applyTransmissionReference(points, [])).toThrow(/same frequency grid/);
    expect(() =>
      applyTransmissionReference(points, sampleSweep({ ...sweep, startHz: 2e6 }, 'through')),
    ).toThrow(/same frequency grid/);
    expect(() => applyTransmissionReference(points, sampleSweep(sweep, 'open'))).toThrow(
      /zero transmission/,
    );
    const broken = structuredClone(points);
    broken[2].s21.re = Infinity;
    expect(() => applyTransmissionReference(points, broken)).toThrow(/invalid or zero/);
  });
});

describe('marker inspection', () => {
  it('interpolates in frequency and Cartesian complex coordinates, with bounded endpoints', () => {
    const point = (frequencyHz: number, value: Complex) => ({
      frequencyHz,
      s11: value,
      s21: value,
      s12: value,
      s22: value,
    });
    const points = [point(1e6, complex(0, -1)), point(3e6, complex(1, 1))];
    const mid = markerAt(points, 2e6);
    expect(mid.frequencyHz).toBe(2e6);
    expectComplex(mid.s21, complex(0.5, 0));
    expect(markerAt(points, 0).frequencyHz).toBe(1e6);
    expect(markerAt(points, 4e6).frequencyHz).toBe(3e6);
    expect(() => markerAt([], 2e6)).toThrow(RangeError);
    expect(() => markerAt(points, Number.NaN)).toThrow(RangeError);
    mid.s11.re = 90;
    expect(points[0].s11.re).toBe(0);
  });
});
