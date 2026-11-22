import type { SParameter, SweepPoint } from './simulation';

export interface TouchstoneOptions {
  dutId: string;
  ports: 1 | 2;
  port1Sol: boolean;
  relativeThru: boolean;
}

/**
 * A static Touchstone 1.x RI export of the displayed synthetic data. It does not
 * convert relative transmission ratios into a full calibrated network model.
 */
export function createTouchstone(
  points: readonly SweepPoint[],
  options: TouchstoneOptions,
): { filename: string; text: string } {
  if (options.ports !== 1 && options.ports !== 2)
    throw new RangeError('Touchstone export supports one or two ports.');
  if (
    typeof options.dutId !== 'string' ||
    typeof options.port1Sol !== 'boolean' ||
    typeof options.relativeThru !== 'boolean'
  )
    throw new TypeError('Provide a DUT name and explicit correction settings.');
  if (!points.length) throw new RangeError('Run a sweep before exporting Touchstone data.');
  const allParameters = ['s11', 's21', 's12', 's22'] as const;
  let priorFrequency = 0;
  for (const point of points) {
    if (!Number.isFinite(point.frequencyHz) || point.frequencyHz <= priorFrequency)
      throw new RangeError('The frequency grid must be finite, positive and strictly increasing.');
    priorFrequency = point.frequencyHz;
    if (
      !allParameters.every(
        (parameter) =>
          point[parameter] &&
          Number.isFinite(point[parameter].re) &&
          Number.isFinite(point[parameter].im),
      )
    )
      throw new RangeError('Touchstone coordinates must be finite real and imaginary values.');
  }

  // Keep a caller-provided display label from injecting another Touchstone line
  // or turning the suggested filename into a path. No external assets are used.
  const label =
    options.dutId
      .replace(/[^\x20-\x7e]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'dut';
  const filenameId =
    options.dutId
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'dut';
  const parameters: readonly SParameter[] = options.ports === 1 ? ['s11'] : allParameters;
  const lines = [
    '! VNA Student Lab - generated educational simulation; not hardware measurements.',
    `! DUT: ${label}`,
    '! Reference impedance: 50 ohms at every represented port.',
    `! Port 1 reflection: ${options.port1Sol ? 'simplified virtual SOL correction applied to S11 only.' : 'uncorrected deterministic reflection error model.'}`,
    options.ports === 2
      ? '! Port 2 reflection: S22 remains the uncorrected model; Port 1 SOL does not calibrate Port 2.'
      : '! One-port export: S11 only; Port 2 is not represented.',
    options.ports === 1
      ? '! Transmission: not represented. A stored THRU reference does not alter S11.'
      : options.relativeThru
        ? '! Transmission: S21 and S12 are complex ratios relative to a stored THRU response; not full two-port calibration or absolute DUT S-parameters.'
        : '! Transmission: idealized analytic S21 and S12; not full two-port calibrated data.',
    '! This file records synthetic teaching values, not equipment performance or learner proficiency.',
    `! Columns: frequency_Hz ${parameters.flatMap((parameter) => [`${parameter.toUpperCase()}_real`, `${parameter.toUpperCase()}_imag`]).join(' ')}`,
    '# Hz S RI R 50',
  ];
  for (const point of points) {
    const values = [
      point.frequencyHz,
      ...parameters.flatMap((parameter) => [point[parameter].re, point[parameter].im]),
    ];
    // Seventeen significant digits round-trip a double. Sixteen can collapse
    // adjacent representable frequencies into duplicate serialized rows.
    lines.push(values.map((value) => value.toExponential(16)).join(' '));
  }
  return {
    filename: `VNA-${filenameId}-simulated.s${options.ports}p`,
    text: lines.join('\n') + '\n',
  };
}
