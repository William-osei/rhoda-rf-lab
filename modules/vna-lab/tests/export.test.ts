import { describe, expect, it } from 'vitest';
import { createTouchstone, type TouchstoneOptions } from '../src/export';
import { DEFAULT_SWEEP, complex, sampleSweep, type SweepPoint } from '../src/simulation';

const options: TouchstoneOptions = {
  dutId: 'known-network',
  ports: 2,
  port1Sol: false,
  relativeThru: false,
};
const known: SweepPoint[] = [
  {
    frequencyHz: 1_234_567.891234567,
    s11: complex(0.1234567891234567, -0.0000000123456789123456),
    s21: complex(0.2, -0.3),
    s12: complex(-0.4, 0.5),
    s22: complex(0.6, -0.7),
  },
  {
    frequencyHz: 1_234_568.000000001,
    s11: complex(-0.1, 0.2),
    s21: complex(-0.3, 0.4),
    s12: complex(-0.5, 0.6),
    s22: complex(-0.7, 0.8),
  },
];
const dataRows = (text: string): number[][] =>
  text
    .split('\n')
    .filter((line) => line && !line.startsWith('!') && !line.startsWith('#'))
    .map((line) => line.split(/\s+/).map(Number));

describe('Touchstone exports', () => {
  it('writes Hz/RI/50-ohm two-port rows in the required S11 S21 S12 S22 order', () => {
    const exported = createTouchstone(known, options);
    expect(exported.filename).toBe('VNA-known-network-simulated.s2p');
    expect(exported.text).toContain('# Hz S RI R 50\n');
    expect(exported.text).toContain(
      'frequency_Hz S11_real S11_imag S21_real S21_imag S12_real S12_imag S22_real S22_imag',
    );
    const rows = dataRows(exported.text);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.length === 9)).toBe(true);
    expect(rows[1]).toEqual([known[1].frequencyHz, -0.1, 0.2, -0.3, 0.4, -0.5, 0.6, -0.7, 0.8]);
    expect(exported.text.endsWith('\n')).toBe(true);
  });

  it('uses a genuine one-port .s1p with only S11 rather than inventing a second port', () => {
    const exported = createTouchstone(known, {
      ...options,
      dutId: 'open',
      ports: 1,
      port1Sol: true,
      relativeThru: true,
    });
    expect(exported.filename).toBe('VNA-open-simulated.s1p');
    const rows = dataRows(exported.text);
    expect(rows.every((row) => row.length === 3)).toBe(true);
    expect(rows[1]).toEqual([known[1].frequencyHz, -0.1, 0.2]);
    expect(exported.text).toContain('S11 only; Port 2 is not represented');
    expect(exported.text).toContain('THRU reference does not alter S11');
    expect(exported.text).not.toContain('S21_real');
  });

  it('preserves high-precision frequencies and small complex components', () => {
    const row = dataRows(createTouchstone(known, options).text)[0];
    const expected = [
      known[0].frequencyHz,
      known[0].s11.re,
      known[0].s11.im,
      0.2,
      -0.3,
      -0.4,
      0.5,
      0.6,
      -0.7,
    ];
    expected.forEach((value, index) =>
      expect(Math.abs((row[index] - value) / value)).toBeLessThan(1e-13),
    );
    const sweep = sampleSweep({ ...DEFAULT_SWEEP, points: 1601, spacing: 'log' }, 'bandpass');
    const exportedRows = dataRows(createTouchstone(sweep, options).text);
    expect(exportedRows).toHaveLength(1601);
    exportedRows.forEach((values, index) => {
      expect(Math.abs(values[0] / sweep[index].frequencyHz - 1)).toBeLessThan(1e-13);
      if (index) expect(values[0]).toBeGreaterThan(exportedRows[index - 1][0]);
    });
  });

  it('does not collapse adjacent representable frequencies after serialization', () => {
    const near = [
      { ...known[0], frequencyHz: 1_000_000 },
      { ...known[1], frequencyHz: 1_000_000.0000000001 },
    ];
    expect(near[1].frequencyHz).toBeGreaterThan(near[0].frequencyHz);
    const rows = dataRows(createTouchstone(near, options).text);
    expect(rows[0][0]).toBe(near[0].frequencyHz);
    expect(rows[1][0]).toBe(near[1].frequencyHz);
    expect(rows[1][0]).toBeGreaterThan(rows[0][0]);
  });

  it('labels the exact limited correction state without suggesting full calibration', () => {
    const raw = createTouchstone(known, options).text;
    expect(raw).toContain('not hardware measurements');
    expect(raw).toContain('uncorrected deterministic reflection error model');
    expect(raw).toContain('S22 remains the uncorrected model');
    expect(raw).toContain('idealized analytic S21 and S12');
    const corrected = createTouchstone(known, {
      ...options,
      port1Sol: true,
      relativeThru: true,
    }).text;
    expect(corrected).toContain('SOL correction applied to S11 only');
    expect(corrected).toContain('S22 remains the uncorrected model');
    expect(corrected).toContain('complex ratios relative to a stored THRU response');
    expect(corrected).toContain('not full two-port calibration or absolute DUT S-parameters');
  });

  it.each([
    [],
    [{ ...known[0], frequencyHz: 0 }],
    [{ ...known[0], frequencyHz: -1 }],
    [{ ...known[0], frequencyHz: Infinity }],
    [{ ...known[0], frequencyHz: Number.NaN }],
    [known[1], known[0]],
    [known[0], known[0]],
    [{ ...known[0], s11: complex(Number.NaN, 0) }],
    [{ ...known[0], s12: complex(0, Infinity) }],
  ])('rejects invalid or empty input instead of producing a corrupt file %#', (...points) => {
    // it.each spreads each supplied row; each row represents one sweep fixture.
    expect(() => createTouchstone(points as SweepPoint[], options)).toThrow(RangeError);
  });

  it('does not mutate traces and sanitizes suggested filenames and comment labels', () => {
    const snapshot = structuredClone(known);
    const exported = createTouchstone(known, {
      ...options,
      dutId: '../../network\n# MHz S DB R 75',
    });
    expect(exported.filename).not.toMatch(/[\\/\r\n]/);
    expect(exported.filename).not.toContain('..');
    expect(exported.text.split('\n').filter((line) => line.startsWith('#'))).toEqual([
      '# Hz S RI R 50',
    ]);
    expect(known).toEqual(snapshot);
    expect(() =>
      createTouchstone(known, { ...options, ports: 3 } as unknown as TouchstoneOptions),
    ).toThrow(RangeError);
  });
});
