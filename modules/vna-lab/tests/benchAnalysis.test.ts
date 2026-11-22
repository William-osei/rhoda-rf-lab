import { describe, expect, it } from 'vitest';
import { analyzeReflection, findSampledMagnitudeExtreme, nearestSampleIndex, reflectionMetrics } from '../src/benchAnalysis';
import { complex, DEFAULT_SWEEP, sampleIdealSweep, sampleSweep, type SweepPoint } from '../src/simulation';

const point = (frequencyHz: number, value: ReturnType<typeof complex>): SweepPoint => ({ frequencyHz, s11: value, s21: value, s12: value, s22: value });

describe('reflection power-wave analysis', () => {
  it('distinguishes reflection amplitude from reflected power, return loss and mismatch loss', () => {
    const result = reflectionMetrics(complex(0.06, 0.08));
    expect(result.gammaMagnitude).toBeCloseTo(0.1, 14);
    expect(result.returnLossDb).toBeCloseTo(20, 12);
    expect(result.reflectedPowerPercent).toBeCloseTo(1, 12);
    expect(result.acceptedPowerPercent).toBeCloseTo(99, 12);
    expect(result.mismatchLossDb).toBeCloseTo(-10 * Math.log10(0.99), 14);
    expect(result.passiveInterpretation).toBe(true);
    expect(result.warning).toBe(null);
  });

  it('gives the matched-load limit without inventing finite return loss', () => {
    const result = reflectionMetrics(complex(0));
    expect(result.returnLossDb).toBe(Infinity);
    expect(result.reflectedPowerPercent).toBe(0);
    expect(result.acceptedPowerPercent).toBe(100);
    expect(result.mismatchLossDb).toBe(0);
    expect(result.passiveInterpretation).toBe(true);
  });

  it.each([complex(1), complex(-1), complex(0.6, 0.8)])('gives full-reflection limits for %j', gamma => {
    const result = reflectionMetrics(gamma);
    expect(result.returnLossDb).toBe(0);
    expect(result.reflectedPowerPercent).toBe(100);
    expect(result.acceptedPowerPercent).toBe(0);
    expect(result.mismatchLossDb).toBe(Infinity);
  });

  it('keeps a ratio above unity visible without producing negative accepted power or claiming gain', () => {
    const result = reflectionMetrics(complex(1.1));
    expect(result.returnLossDb).toBeCloseTo(-20 * Math.log10(1.1), 12);
    expect(result.reflectedPowerPercent).toBeCloseTo(121, 10);
    expect(result.acceptedPowerPercent).toBe(null);
    expect(result.mismatchLossDb).toBe(null);
    expect(result.passiveInterpretation).toBe(false);
    expect(result.warning).toContain('not evidence of physical gain');
  });

  it('adjusts only representational overshoot and does not hide larger raw errors', () => {
    const rounded = reflectionMetrics(complex(1 + Number.EPSILON));
    expect(rounded.boundaryAdjusted).toBe(true);
    expect(rounded.acceptedPowerPercent).toBe(0);
    expect(rounded.mismatchLossDb).toBe(Infinity);
    const raw = reflectionMetrics(complex(1 + 1e-10));
    expect(raw.boundaryAdjusted).toBe(false);
    expect(raw.passiveInterpretation).toBe(false);
    expect(raw.acceptedPowerPercent).toBe(null);
  });

  it.each([complex(Number.NaN), complex(0, Infinity), complex(Number.MAX_VALUE, Number.MAX_VALUE)])('marks nonfinite data undefined: %j', gamma => {
    const result = reflectionMetrics(gamma);
    expect(result.gammaMagnitude).toBe(null);
    expect(result.returnLossDb).toBe(null);
    expect(result.reflectedPowerPercent).toBe(null);
    expect(result.acceptedPowerPercent).toBe(null);
    expect(result.mismatchLossDb).toBe(null);
    expect(result.passiveInterpretation).toBe(false);
  });

  it('analyzes the same Cartesian marker interpolation and clamps its actual frequency', () => {
    const points = [point(1e6, complex(0)), point(3e6, complex(0.2))];
    const result = analyzeReflection(points, 2e6, 's11');
    expect(result.frequencyHz).toBe(2e6);
    expect(result.parameter).toBe('s11');
    expect(result.returnLossDb).toBeCloseTo(20);
    expect(analyzeReflection(points, 9e6, 's22').frequencyHz).toBe(3e6);
    expect(() => analyzeReflection(points, 2e6, 's21' as 's11')).toThrow(/not a transmission/);
  });
});

describe('sample-aligned marker lookup', () => {
  it('finds the nearest point on a nonlinear grid, with deterministic bounds and ties', () => {
    const points = [point(1e6, complex(1)), point(10e6, complex(1)), point(100e6, complex(1))];
    expect(nearestSampleIndex(points, 12e6)).toBe(1);
    expect(nearestSampleIndex(points, 55e6)).toBe(1);
    expect(nearestSampleIndex(points, 56e6)).toBe(2);
    expect(nearestSampleIndex(points, -1)).toBe(0);
    expect(nearestSampleIndex(points, 1e9)).toBe(2);
    expect(nearestSampleIndex([], 1e6)).toBe(null);
  });

  it('rejects a nonfinite target or invalid sample grid', () => {
    expect(() => nearestSampleIndex([point(1e6, complex(1))], Number.NaN)).toThrow(RangeError);
    expect(() => nearestSampleIndex([point(2e6, complex(1)), point(1e6, complex(1))], 1e6)).toThrow(/increasing/);
  });
});

describe('honest sampled magnitude extrema', () => {
  it('finds an actual sampled passband peak without inventing an interpolated resonance', () => {
    const points = sampleIdealSweep({ ...DEFAULT_SWEEP, startHz: 1.6e9, stopHz: 3.2e9, points: 401 }, 'bandpass');
    const peak = findSampledMagnitudeExtreme(points, 's21', 'max', 2.5e9)!;
    expect(peak.frequencyHz).toBe(2.4e9);
    expect(peak.index).toBe(200);
    expect(peak.magnitudeDb).toBeCloseTo(-0.4, 12);
    expect(peak.flat).toBe(false);
    expect(peak.belowDisplayFloor).toBe(false);
  });

  it('treats constant-attenuator roundoff as a tie and chooses the closest acquired sample', () => {
    const points = sampleSweep({ ...DEFAULT_SWEEP }, 'attenuator');
    const closest = nearestSampleIndex(points, 2.4e9);
    for (const kind of ['max', 'min'] as const) {
      const result = findSampledMagnitudeExtreme(points, 's21', kind, 2.4e9)!;
      expect(result.index).toBe(closest);
      expect(result.flat).toBe(true);
      expect(result.tiedSamples).toBe(points.length);
      expect(result.magnitudeDb).toBeCloseTo(-10, 12);
    }
  });

  it('uses the lower frequency for equidistant tied peaks and supports reverse coefficients', () => {
    const points = [point(1e6, complex(0.8)), point(2e6, complex(0.3)), point(3e6, complex(0.8))];
    const result = findSampledMagnitudeExtreme(points, 's12', 'max', 2e6)!;
    expect(result.frequencyHz).toBe(1e6);
    expect(result.tiedSamples).toBe(2);
    expect(findSampledMagnitudeExtreme(points, 's11', 'min')!.frequencyHz).toBe(2e6);
  });

  it('distinguishes an all-zero trace from a finite-grid zero notch and a below-floor result', () => {
    const zero = sampleIdealSweep({ ...DEFAULT_SWEEP }, 'open');
    expect(findSampledMagnitudeExtreme(zero, 's21', 'max')).toBe(null);
    const notch = [point(1e6, complex(0.1)), point(2e6, complex(0)), point(3e6, complex(0.1))];
    const result = findSampledMagnitudeExtreme(notch, 's21', 'min')!;
    expect(result.frequencyHz).toBe(2e6);
    expect(result.magnitudeDb).toBe(-120);
    expect(result.belowDisplayFloor).toBe(true);
    expect(result.flat).toBe(false);
    expect(findSampledMagnitudeExtreme([], 's11', 'min')).toBe(null);
  });

  it('rejects nonfinite data, invalid grids, directions and anchors', () => {
    const points = [point(1e6, complex(0.5)), point(2e6, complex(0.9))];
    expect(() => findSampledMagnitudeExtreme([point(1e6, complex(Infinity))], 's11', 'max')).toThrow(/finite complex/);
    expect(() => findSampledMagnitudeExtreme([...points].reverse(), 's11', 'min')).toThrow(/increasing/);
    expect(() => findSampledMagnitudeExtreme(points, 's11', 'next' as 'min')).toThrow(RangeError);
    expect(() => findSampledMagnitudeExtreme(points, 's11', 'min', Number.NaN)).toThrow(RangeError);
  });
});
