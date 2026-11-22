import { describe, expect, it } from 'vitest';
import { complex, DEFAULT_SWEEP, MAX_SWEEP_POINTS, sampleIdealSweep, type SweepPoint } from '../src/simulation';
import { compareTraceMemory, getMemoryCompatibility, storeTrace, type TraceMemory, type TraceMemoryMetadata } from '../src/traceMemory';

const metadata: TraceMemoryMetadata = { dutTitle: 'Through cable', parameter: 's21', correctionLabel: 'Ideal transmission · relative reference off' };
const point = (frequencyHz: number, amplitude: number): SweepPoint => ({
  frequencyHz, s11: complex(amplitude), s21: complex(amplitude), s12: complex(amplitude), s22: complex(amplitude),
});
const samples = () => [point(1e6, 0.2), point(3e6, 0.8)];

describe('detached in-page trace memory', () => {
  it('copies every point and complex value without freezing or modifying the live source', () => {
    const live = samples();
    const memory = storeTrace(live, metadata);
    expect(memory.points).not.toBe(live);
    for (let index = 0; index < live.length; index++) {
      expect(memory.points[index]).not.toBe(live[index]);
      for (const parameter of ['s11', 's21', 's12', 's22'] as const)
        expect(memory.points[index][parameter]).not.toBe(live[index][parameter]);
    }
    live[0].s21.re = 9; live[1].frequencyHz = 4e6; live.push(point(5e6, 0.1));
    expect(memory.points).toHaveLength(2); expect(memory.points[0].s21.re).toBe(0.2); expect(memory.points[1].frequencyHz).toBe(3e6);
    expect(Object.isFrozen(live)).toBe(false); expect(Object.isFrozen(live[0].s21)).toBe(false);
  });
  it('freezes the snapshot and all nested sample values at runtime', () => {
    const memory = storeTrace(samples(), metadata);
    expect(Object.isFrozen(memory)).toBe(true); expect(Object.isFrozen(memory.points)).toBe(true);
    expect(Object.isFrozen(memory.points[0])).toBe(true); expect(Object.isFrozen(memory.points[0].s11)).toBe(true);
    expect(() => { memory.points[0].s21.re = 9; }).toThrow(TypeError);
  });
  it('retains independent, bounded labels instead of treating correction changes as incompatibility', () => {
    const liveMeta = { ...metadata };
    const memory = storeTrace(samples(), liveMeta); liveMeta.dutTitle = 'Changed title'; liveMeta.correctionLabel = 'Changed correction';
    expect(memory.dutTitle).toBe(metadata.dutTitle); expect(memory.correctionLabel).toBe(metadata.correctionLabel);
    expect(storeTrace(samples(), { ...metadata, dutTitle: ' Cable ', correctionLabel: ' SOL off ' }).dutTitle).toBe('Cable');
  });
  it('rejects absent, oversized, unordered or nonfinite trace samples', () => {
    const invalid = [[], [point(1e6, 1)], [point(0, 1), point(1e6, 1)], [point(1e6, 1), point(1e6, 1)], [point(3e6, 1), point(1e6, 1)], [point(1e6, 1), point(Infinity, 1)], [point(1e6, 1), point(3e6, NaN)], Array.from({ length: MAX_SWEEP_POINTS + 1 }, (_, index) => point(index + 1, 1))];
    for (const data of invalid) expect(() => storeTrace(data, metadata)).toThrow(RangeError);
    const otherParameterBad = samples(); otherParameterBad[0].s22.im = Infinity;
    expect(() => storeTrace(otherParameterBad, metadata)).toThrow(RangeError);
  });
  it('rejects missing and overlong provenance labels or unsupported parameters', () => {
    for (const meta of [{ ...metadata, dutTitle: '' }, { ...metadata, dutTitle: ' ' }, { ...metadata, dutTitle: 'x'.repeat(161) }, { ...metadata, correctionLabel: '' }, { ...metadata, correctionLabel: 'x'.repeat(241) }, { ...metadata, parameter: 's33' as TraceMemoryMetadata['parameter'] }]) expect(() => storeTrace(samples(), meta)).toThrow(RangeError);
  });
});

describe('comparison compatibility', () => {
  it('allows deliberate DUT changes on the same grid', () => {
    const cable = sampleIdealSweep({ ...DEFAULT_SWEEP }, 'through');
    const memory = storeTrace(cable, metadata);
    const attenuator = sampleIdealSweep({ ...DEFAULT_SWEEP }, 'attenuator');
    expect(getMemoryCompatibility(memory, attenuator, 's21')).toMatchObject({ usable: true, status: 'ready' });
  });
  it('refuses a different parameter even though all four values are present in each point', () => {
    const memory = storeTrace(samples(), metadata);
    expect(getMemoryCompatibility(memory, samples(), 's11')).toMatchObject({ usable: false, status: 'parameter-mismatch' });
    expect(getMemoryCompatibility(memory, samples(), 's11').reason).toContain('S21');
  });
  it('requires every frequency to match, not only endpoints or sample count', () => {
    const original = [point(1e6, 1), point(2e6, 1), point(3e6, 1)];
    const memory = storeTrace(original, metadata);
    expect(getMemoryCompatibility(memory, [point(1e6, 1), point(2e6 + 1, 1), point(3e6, 1)], 's21').status).toBe('grid-mismatch');
    expect(getMemoryCompatibility(memory, [point(1e6, 1), point(3e6, 1)], 's21').status).toBe('grid-mismatch');
    expect(getMemoryCompatibility(memory, original, 's21').usable).toBe(true);
  });
  it('returns a useful unavailable result for no memory or invalid current/stored data', () => {
    expect(getMemoryCompatibility(null, samples(), 's21').status).toBe('no-memory');
    expect(getMemoryCompatibility(storeTrace(samples(), metadata), [], 's21').status).toBe('invalid-current');
    const invalid = { ...storeTrace(samples(), metadata), points: [] } as TraceMemory;
    expect(getMemoryCompatibility(invalid, samples(), 's21').status).toBe('invalid-memory');
  });
});

describe('coherent memory marker comparison', () => {
  it('uses the shared interpolated readouts and signed current-minus-stored delta', () => {
    const stored = [point(1e6, 0.1), point(3e6, 0.4)];
    const current = [point(1e6, 0.2), point(3e6, 0.8)];
    const comparison = compareTraceMemory(current, storeTrace(stored, metadata), 2e6);
    expect(comparison.current.frequencyHz).toBe(2e6); expect(comparison.stored.frequencyHz).toBe(2e6);
    expect(comparison.current.magnitudeDb).toBeCloseTo(20 * Math.log10(0.5), 12);
    expect(comparison.stored.magnitudeDb).toBeCloseTo(20 * Math.log10(0.25), 12);
    expect(comparison.deltaMagnitudeDb).toBeCloseTo(20 * Math.log10(2), 12);
  });
  it('does not fabricate a precise delta from a below-floor bound, including identical zeros', () => {
    const finite = [point(1e6, 0.1), point(3e6, 0.1)];
    for (const amplitude of [0, 1e-9, 1e-6]) {
      const floored = [point(1e6, amplitude), point(3e6, amplitude)];
      expect(compareTraceMemory(finite, storeTrace(floored, metadata), 2e6).deltaMagnitudeDb).toBe(null);
      expect(compareTraceMemory(floored, storeTrace(finite, metadata), 2e6).deltaMagnitudeDb).toBe(null);
      expect(compareTraceMemory(floored, storeTrace(floored, metadata), 2e6).deltaMagnitudeDb).toBe(null);
    }
  });
  it('retains the marker endpoint-clamping behaviour on both traces', () => {
    const memory = storeTrace(samples(), metadata);
    const low = compareTraceMemory(samples(), memory, -1);
    expect(low.current.frequencyHz).toBe(1e6); expect(low.stored.frequencyHz).toBe(1e6);
    const high = compareTraceMemory(samples(), memory, 9e9);
    expect(high.current.frequencyHz).toBe(3e6); expect(high.stored.frequencyHz).toBe(3e6);
  });
  it('throws before comparing incompatible grids or nonfinite marker frequencies', () => {
    const memory = storeTrace(samples(), metadata);
    expect(() => compareTraceMemory([point(1e6, 1), point(4e6, 1)], memory, 2e6)).toThrow(/frequency grid/i);
    expect(() => compareTraceMemory(samples(), memory, NaN)).toThrow(/finite marker/i);
    expect(() => compareTraceMemory(samples(), memory, Infinity)).toThrow(/finite marker/i);
  });
  it('permits finite relative responses above unity without claiming physical gain', () => {
    const stored = [point(1e6, 0.5), point(3e6, 0.5)], current = [point(1e6, 2), point(3e6, 2)];
    const comparison = compareTraceMemory(current, storeTrace(stored, metadata), 2e6);
    expect(comparison.current.magnitudeDb).toBeGreaterThan(0); expect(comparison.deltaMagnitudeDb).toBeCloseTo(20 * Math.log10(4), 12);
  });
});
