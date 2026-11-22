import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SWEEP,
  complex,
  groupDelay,
  polar,
  sampleIdealSweep,
  type SweepPoint,
} from '../src/simulation';
import {
  formatDelay,
  formatMagnitude,
  formatPhase,
  formatVSWR,
  markerReadout,
  markerTraceValue,
  phaseSamplingLimitSeconds,
  compareMarkers,
  analyzeTransmissionPassband,
} from '../src/tracePresentation';

const point = (frequencyHz: number, value: ReturnType<typeof complex>): SweepPoint => ({
  frequencyHz,
  s11: value,
  s21: value,
  s12: value,
  s22: value,
});

describe('coherent marker presentation', () => {
  it('uses one interpolated value for numeric and plotted markers, rather than a nearby sample', () => {
    const points = [point(1e6, complex(0.1)), point(3e6, complex(0.9))];
    const readout = markerReadout(points, 2e6, 's11');
    expect(readout.frequencyHz).toBe(2e6);
    expect(readout.magnitudeDb).toBeCloseTo(20 * Math.log10(0.5), 12);
    expect(readout.standingWaveRatio).toBeCloseTo(3, 12);
    expect(markerTraceValue(points, 2e6, 's11', 'logmag')).toBe(readout.magnitudeDb);
    expect(markerTraceValue(points, 2e6, 's11', 'vswr')).toBe(readout.standingWaveRatio);
    expect(readout.magnitudeDb).not.toBeCloseTo(-20, 2);
  });

  it('interpolates through the phase wrap in Cartesian coordinates', () => {
    const points = [
      point(1e6, polar(1, (179 * Math.PI) / 180)),
      point(3e6, polar(1, (-179 * Math.PI) / 180)),
    ];
    expect(Math.abs(markerReadout(points, 2e6, 's21').phaseDegrees!)).toBeCloseTo(180, 10);
    expect(Math.abs(markerTraceValue(points, 2e6, 's21', 'phase'))).toBeCloseTo(180, 10);
  });

  it('does not invent phase or infinite delay for a zero-magnitude response', () => {
    const points = [point(1e6, complex(0)), point(3e6, complex(0))];
    const readout = markerReadout(points, 2e6, 's21');
    expect(readout.phaseDegrees).toBe(null);
    expect(readout.groupDelaySeconds).toBe(null);
    expect(readout.standingWaveRatio).toBe(null);
    expect(Number.isNaN(markerTraceValue(points, 2e6, 's21', 'phase'))).toBe(true);
    expect(Number.isNaN(markerTraceValue(points, 2e6, 's21', 'groupdelay'))).toBe(true);
    expect(formatMagnitude(readout)).toBe('≤ -120.00 dB');
    expect(formatPhase(readout.phaseDegrees)).toBe('Not defined');
    expect(formatDelay(readout.groupDelaySeconds)).toBe('Not defined');
  });

  it('distinguishes an open termination’s infinite VSWR from undefined data', () => {
    const points = sampleIdealSweep({ ...DEFAULT_SWEEP }, 'open');
    const readout = markerReadout(points, 2.4e9, 's11');
    expect(readout.standingWaveRatio).toBe(Infinity);
    expect(formatVSWR(readout.standingWaveRatio)).toBe('∞ : 1');
    expect(formatVSWR(Number.NaN)).toBe('Not defined');
    expect(formatVSWR(null)).toBe('Not defined');
    expect(formatDelay(Number.NaN)).toBe('Not defined');
    expect(formatDelay(Infinity)).toBe('Not defined');
    expect(formatPhase(0)).toBe('0.0°');
    expect(formatDelay(-0.5e-9)).toBe('-0.50 ns');
  });

  it('interpolates the sampled delay estimate and preserves constant cable delay between samples', () => {
    const cable = sampleIdealSweep({ ...DEFAULT_SWEEP }, 'through');
    const marker = markerReadout(cable, 2.401e9, 's21');
    expect(marker.groupDelaySeconds).toBeCloseTo(2e-9, 16);
    expect(formatDelay(marker.groupDelaySeconds)).toBe('2.00 ns');
    const resonator = sampleIdealSweep(
      { ...DEFAULT_SWEEP, startHz: 2e9, stopHz: 3e9, points: 5 },
      'bandpass',
    );
    const expected = (groupDelay(resonator, 1, 's21') + groupDelay(resonator, 2, 's21')) / 2;
    expect(markerReadout(resonator, 2.375e9, 's21').groupDelaySeconds).toBeCloseTo(expected, 17);
  });

  it('reports a clamped marker frequency and handles absent slope information', () => {
    const points = [point(1e6, complex(0.5))];
    const readout = markerReadout(points, 5e6, 's11');
    expect(readout.frequencyHz).toBe(1e6);
    expect(readout.groupDelaySeconds).toBe(null);
    expect(formatVSWR(readout.standingWaveRatio)).toBe('3.00 : 1');
    expect(() => markerReadout([], 1e6, 's11')).toThrow(RangeError);
  });
});

describe('phase sampling disclosure', () => {
  it('shows why the coarsest logarithmic step can alias a 2 ns cable', () => {
    const coarse = sampleIdealSweep({ ...DEFAULT_SWEEP, points: 201, spacing: 'log' }, 'through');
    expect(phaseSamplingLimitSeconds(coarse)!).toBeLessThan(2e-9);
    const linear = sampleIdealSweep({ ...DEFAULT_SWEEP }, 'through');
    expect(phaseSamplingLimitSeconds(linear)!).toBeGreaterThan(30e-9);
    const denseLog = sampleIdealSweep({ ...DEFAULT_SWEEP, points: 801, spacing: 'log' }, 'through');
    expect(phaseSamplingLimitSeconds(denseLog)!).toBeGreaterThan(7e-9);
  });

  it('does not report a resolution limit for absent or invalid frequency intervals', () => {
    expect(phaseSamplingLimitSeconds([])).toBe(null);
    expect(phaseSamplingLimitSeconds([point(1e6, complex(1))])).toBe(null);
    expect(phaseSamplingLimitSeconds([point(2e6, complex(1)), point(1e6, complex(1))])).toBe(null);
  });
});

describe('two-marker comparisons', () => {
  it('reports signed frequency and magnitude differences from actual interpolated readouts', () => {
    const points = [point(1e6, complex(0.2)), point(3e6, complex(0.8))];
    const comparison = compareMarkers(points, 1e6, 2e6, 's21');
    expect(comparison.deltaFrequencyHz).toBe(1e6);
    expect(comparison.deltaMagnitudeDb).toBeCloseTo(20 * Math.log10(0.5 / 0.2), 12);
    expect(comparison.b.magnitudeDb).toBe(markerReadout(points, 2e6, 's21').magnitudeDb);
    const reversed = compareMarkers(points, 2e6, 1e6, 's21');
    expect(reversed.deltaFrequencyHz).toBe(-1e6);
    expect(reversed.deltaMagnitudeDb).toBeCloseTo(-comparison.deltaMagnitudeDb!, 12);
  });
  it('uses clamped endpoint frequencies and does not calculate a difference from below-floor values', () => {
    const points = [point(1e6, complex(0)), point(3e6, complex(0.8))];
    const comparison = compareMarkers(points, 0, 5e6, 's11');
    expect(comparison.a.frequencyHz).toBe(1e6);
    expect(comparison.b.frequencyHz).toBe(3e6);
    expect(comparison.deltaFrequencyHz).toBe(2e6);
    expect(comparison.deltaMagnitudeDb).toBe(null);
  });
  it('keeps independent phase values across a wrap without inventing an unwrapped phase difference', () => {
    const points = [
      point(1e6, polar(0.5, (179 * Math.PI) / 180)),
      point(3e6, polar(0.5, (-179 * Math.PI) / 180)),
    ];
    const comparison = compareMarkers(points, 1e6, 3e6, 's21');
    expect(comparison.a.phaseDegrees).toBeCloseTo(179);
    expect(comparison.b.phaseDegrees).toBeCloseTo(-179);
    expect(comparison.deltaMagnitudeDb).toBeCloseTo(0);
    expect(comparison).not.toHaveProperty('deltaPhaseDegrees');
  });
});

describe('sampled relative -3 dB passband analysis', () => {
  it('finds the main peak and both threshold crossings without extrapolating', () => {
    const points = [0.1, 0.2, 0.8, 1, 0.8, 0.2, 0.1].map((amplitude, index) =>
      point((index + 1) * 1e9, complex(amplitude)),
    );
    const analysis = analyzeTransmissionPassband(points);
    const threshold = 10 ** (-3 / 20);
    const low = 2e9 + ((threshold - 0.2) / (0.8 - 0.2)) * 1e9;
    const high = 5e9 + ((0.8 - threshold) / (0.8 - 0.2)) * 1e9;
    expect(analysis.status).toBe('complete');
    expect(analysis.peakIndex).toBe(3);
    expect(analysis.peakMagnitudeDb).toBeCloseTo(0);
    expect(analysis.thresholdDb).toBe(-3);
    expect(analysis.lowHz).toBeCloseTo(low, 5);
    expect(analysis.highHz).toBeCloseTo(high, 5);
    expect(analysis.bandwidthHz).toBeCloseTo(high - low, 5);
  });
  it('puts complex-interpolated marker readings exactly at the threshold on both edges', () => {
    const points = sampleIdealSweep(
      { ...DEFAULT_SWEEP, startHz: 1.6e9, stopHz: 3.2e9, points: 401 },
      'bandpass',
    );
    const analysis = analyzeTransmissionPassband(points);
    expect(analysis.status).toBe('complete');
    expect(analysis.peakFrequencyHz).toBe(2.4e9);
    expect(markerReadout(points, analysis.lowHz!, 's21').magnitudeDb).toBeCloseTo(
      analysis.thresholdDb!,
      10,
    );
    expect(markerReadout(points, analysis.highHz!, 's21').magnitudeDb).toBeCloseTo(
      analysis.thresholdDb!,
      10,
    );
    // Exactly -3.000 dB differs slightly from the half-power -3.0103 dB width.
    expect(analysis.bandwidthHz).toBeGreaterThan(0.797e9);
    expect(analysis.bandwidthHz).toBeLessThan(0.802e9);
  });
  it('leaves a missing edge and bandwidth undefined when the sweep window cuts the passband', () => {
    const points = sampleIdealSweep(
      { ...DEFAULT_SWEEP, startHz: 2.3e9, stopHz: 3.3e9, points: 201 },
      'bandpass',
    );
    const analysis = analyzeTransmissionPassband(points);
    expect(analysis.status).toBe('incomplete');
    expect(analysis.lowHz).toBe(null);
    expect(analysis.highHz).not.toBe(null);
    expect(analysis.bandwidthHz).toBe(null);
    const flat = analyzeTransmissionPassband(sampleIdealSweep({ ...DEFAULT_SWEEP }, 'attenuator'));
    expect(flat.status).toBe('incomplete');
    expect(flat.lowHz).toBe(null);
    expect(flat.highHz).toBe(null);
  });
  it('supports reverse transmission and handles zero/absent responses honestly', () => {
    const points = sampleIdealSweep({ ...DEFAULT_SWEEP }, 'bandpass');
    expect(analyzeTransmissionPassband(points, 's12')).toEqual(
      analyzeTransmissionPassband(points, 's21'),
    );
    expect(analyzeTransmissionPassband([]).status).toBe('no-data');
    expect(analyzeTransmissionPassband(sampleIdealSweep({ ...DEFAULT_SWEEP }, 'open')).status).toBe(
      'no-signal',
    );
    expect(analyzeTransmissionPassband([point(1e9, complex(0.5))]).bandwidthHz).toBe(null);
  });
  it('rejects a non-increasing grid or nonfinite complex transmission', () => {
    expect(() =>
      analyzeTransmissionPassband([point(2e9, complex(1)), point(1e9, complex(1))]),
    ).toThrow(RangeError);
    expect(() => analyzeTransmissionPassband([point(1e9, complex(Number.NaN))])).toThrow(
      RangeError,
    );
    expect(() => analyzeTransmissionPassband([point(1e9, complex(1))], 's11' as 's21')).toThrow(
      RangeError,
    );
  });
});
