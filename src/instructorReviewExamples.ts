/** Public, authored training examples. No learner records or personal identifiers. */
export const REVIEW_EXAMPLES = [
  {
    id: 'period-from-divisions',
    title: 'Find a period from screen divisions',
    log: `PUBLIC SYNTHETIC TRAINING EXAMPLE — PERIOD
This is an authored fictional simulator exercise, not a learner session or hardware measurement.
Signal: ideal 1 kHz sine wave. Horizontal scale: 200 microseconds per division.
Observation: successive rising peaks are five horizontal divisions apart.
Worked calculation: period = 5 divisions × 200 microseconds/division = 1,000 microseconds = 1 millisecond. Frequency = 1 / 0.001 seconds = 1 kHz.
Discussion prompt: explain why measuring across several complete cycles can reduce reading error. Identify what uncertainty and acquisition limitations the ideal example leaves out.
Boundary: this example makes no claim about a real instrument, connection, person, or assessed proficiency.`,
  },
  {
    id: 'probe-scale-mismatch',
    title: 'Understand a probe attenuation mismatch',
    log: `PUBLIC SYNTHETIC TRAINING EXAMPLE — PROBE SCALE
This is an authored fictional simulator exercise, not a learner session or hardware measurement.
Signal: ideal low-voltage 2 V peak-to-peak sine wave in a safe simulator.
Setup: the simulated probe attenuates by 10:1, but the channel probe setting is 1:1.
Observation: the channel reports 0.2 V peak-to-peak because its displayed scaling does not compensate for the probe.
Worked correction: match the channel probe setting to 10:1; the expected scaled reading is 2 V peak-to-peak. This setting changes interpretation, not the signal itself.
Discussion prompt: explain why attenuation settings must match and why bandwidth, input loading, compensation, and ratings still matter on real equipment.
Boundary: do not infer that a real circuit is safe from this fictional example; consult the instrument and probe documentation.`,
  },
  {
    id: 'clipped-waveform',
    title: 'Distinguish display clipping from source clipping',
    log: `PUBLIC SYNTHETIC TRAINING EXAMPLE — CLIPPING
This is an authored fictional simulator exercise, not a learner session or hardware measurement.
Signal: ideal 4 V peak-to-peak sine wave centered at zero volts. Display: eight vertical divisions at 0.2 V/division.
Observation: the visible vertical span is 1.6 V, so the waveform extends beyond the display. Its visible top and bottom are cut off.
Worked adjustment: choose 1 V/division and center the trace. A 4 V peak-to-peak sine wave now occupies four divisions if the source and acquisition remain linear.
Discussion prompt: explain why a flattened waveform alone does not prove the source is clipped. Compare insufficient display span, front-end overload, and actual source saturation, and describe the limits of this ideal simulator.
Boundary: no real acquisition, voltage rating, person, or learning outcome is represented.`,
  },
] as const;

export type ReviewExampleId = typeof REVIEW_EXAMPLES[number]['id'];
