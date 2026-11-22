import { describe, expect, it } from 'vitest';
import { rangeCenteredOnMarker, rangeFromMarkers } from '../src/benchSetup';
import { DEFAULT_SWEEP } from '../src/simulation';

describe('marker range drafts', () => {
  it('accepts reversed markers and preserves the sweep point count and spacing', () => {
    expect(rangeFromMarkers({ ...DEFAULT_SWEEP, spacing: 'log' }, 3e9, 2e9)).toEqual({
      startHz: 2e9, stopHz: 3e9, points: 401, spacing: 'log',
    });
  });
  it('rejects equal, out-of-range and nonfinite marker ranges', () => {
    for (const [a, b] of [[2e9, 2e9], [0, 2e9], [1e6, 7e9], [NaN, 2e9]])
      expect(() => rangeFromMarkers({ ...DEFAULT_SWEEP }, a, b)).toThrow(RangeError);
  });
  it('centers without mutating the applied sweep', () => {
    const applied = { ...DEFAULT_SWEEP, startHz: 1e9, stopHz: 2e9 };
    expect(rangeCenteredOnMarker(applied, 3e9)).toEqual({ ...applied, startHz: 2.5e9, stopHz: 3.5e9 });
    expect(applied.startHz).toBe(1e9);
  });
  it('preserves span at both instrument boundaries', () => {
    const applied = { ...DEFAULT_SWEEP, startHz: 1e9, stopHz: 2e9 };
    expect(rangeCenteredOnMarker(applied, 1e6)).toMatchObject({ startHz: 1e6, stopHz: 1.001e9 });
    expect(rangeCenteredOnMarker(applied, 6e9)).toMatchObject({ startHz: 5e9, stopHz: 6e9 });
    expect(rangeCenteredOnMarker({ ...DEFAULT_SWEEP }, 3e9)).toEqual(DEFAULT_SWEEP);
  });
});
