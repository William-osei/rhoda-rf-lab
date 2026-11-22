import type { Workflow } from './workflows';

// These guided checklists make no instrument calls and work without an AI key.
const guides: [string, string, string[]][] = [
  ['connection-readiness', 'Connect an instrument: readiness checklist', [
    'Identify the exact model and firmware|Record the model, firmware and interface from the front panel. A selected chat topic is not a verified connection.',
    'Choose the connection|Use the model manual to distinguish USB TMC, file-transfer USB and LAN control. Record the exact VISA resource or LAN address.',
    'Inspect software readiness|Open the practice bench connection diagnostics. Installed Python packages do not establish that VISA or the hardware works.',
    'Identify before changing settings|Plan a bounded identity query without reset. Stop if the returned model does not match the intended adapter.',
    'Record acceptance evidence|Record resource, identity, timestamp and errors. Validate one approved operation against the physical panel before broader automation.',
  ]],
  ['scope-ac-dc', 'Compare AC and DC coupling', [
    'Choose training or physical equipment|For RHODA practice, open the bench and load the sine +1 V DC offset exercise. For hardware, first establish an approved low-voltage setup and exact model.',
    'Observe with DC coupling|Record waveform center, mean and RMS. In the ideal practice exercise the mean is +1 V; this is a prediction, not a hardware observation.',
    'Change to AC coupling|Preview and approve AC coupling in the bench. Compare the mean and waveform center with the earlier record.',
    'Explain the difference|The training model removes DC ideally. A physical AC input has frequency-dependent behavior and settling; consult its manual.',
    'Save the comparison|Export the training evidence and label it simulated. Record what changed, what stayed constant and the limitations.',
  ]],
  ['spectrum-plan', 'Plan a spectrum measurement', [
    'Define the measurement question|State whether you need frequency, relative level, harmonics, noise or interference evidence.',
    'Identify the setup|Record analyzer model, signal source, estimated power, frequency range, attenuation and accessory ratings before connection.',
    'Plan acquisition settings|Identify center/span, reference level, attenuation, RBW, VBW, detector and sweep parameters from the exact manual.',
    'Plan a controlled comparison|Change one parameter at a time to distinguish signal behavior from overload or resolution artifacts.',
    'Document the result|Save trace, settings, units and uncertainty limitations. RHODA has no analyzer control adapter yet; this checklist does not execute commands.',
  ]],
  ['vna-plan', 'Plan a two-port network measurement', [
    'Define the DUT and band|Record DUT type, ports, reference impedance and frequency range.',
    'Check the measurement chain|Identify VNA, connectors, cables, adapters, calibration kit and allowed power.',
    'Place the reference planes|Choose a supported calibration method and reference planes; record cable arrangement and verification standard.',
    'Plan repeat measurements|Record S11/S21 with consistent units and sign convention; repeat connections to assess variability.',
    'Review evidence|Save raw data, calibration details and limitations. No VNA commands are executed by this guide.',
  ]],
  ['generator-plan', 'Plan a signal-generator experiment', [
    'Define the requested signal|Specify waveform, frequency, amplitude convention, offset and modulation.',
    'Establish the load|Record load impedance and the generator amplitude setting convention. Do not assume displayed voltage equals loaded voltage.',
    'Check compatibility|Use exact device and DUT ratings to review connections, output limits and any synchronization lines.',
    'Plan independent verification|Choose a scope or analyzer and define what would confirm frequency, level and modulation.',
    'Write the test record|Record intended settings and observed values separately. This planning guide does not enable a generator output.',
  ]],
  ['automation-adapter', 'Develop a new instrument adapter', [
    'Declare the capability boundary|List model variants, firmware, supported operations and missing features. Start with identity and read-only state.',
    'Map verified commands|For each operation, record the exact manual reference, units, ranges, query response and required options.',
    'Implement typed validation|Use explicit operations rather than arbitrary SCPI strings. Require approval for configuration changes and output enabling.',
    'Exercise failures|Test invalid input, timeout, disconnect, stale approval, partial operations and readback mismatch using controlled fakes.',
    'Perform hardware acceptance|With an approved lab setup, compare each operation against the front panel. Passing a mock test does not establish model support.',
  ]],
  ['experiment-record', 'Build an experiment and evidence record', [
    'State the research question|Write a testable objective, hypothesis and acceptance criterion before collecting data.',
    'Describe the method|Record equipment identity, configuration, variables, controls and repeat count.',
    'Prepare the raw-data table|Include timestamp, units, settings, observations and evidence filenames. Leave unmeasured entries blank.',
    'Analyze with limitations|Separate calculations and interpretation from observations. Explain repeatability and relevant uncertainty sources.',
    'Draft the report|Write an evidence-based outline with missing items clearly marked. Ask the supervisor for the required reporting format.',
  ]],
  ['research-log', 'Prepare a research-assistant daily log', [
    'Record the assignment|Write the date, assigned task and supervisor guidance; leave unknown responsibilities unconfirmed.',
    'Record work actually performed|List activities and decisions with links to code, notes or files. Distinguish planned work from completed work.',
    'Capture evidence|Attach settings, raw measurements or test logs and identify whether they came from hardware or simulation.',
    'Record problems and questions|Include blockers, attempted fixes and what evidence would resolve each question.',
    'Plan the next session|Choose the next tasks and information needed. Do not invent an official reporting schedule.',
  ]],
];
export const RESEARCH_WORKFLOWS: Workflow[] = guides.map(([id, title, lines]) => ({
  id, title, description: 'Guided planning checklist; no automatic device operations.', category: 'simple',
  steps: lines.map((line,i) => { const [instruction, detail] = line.split('|'); return {id:i+1,instruction,detail}; }),
}));
