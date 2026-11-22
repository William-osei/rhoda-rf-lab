/** Deterministic, local guidance. This module never calls a model or a service. */
export const MAX_REVIEW_BYTES = 65_536;
export const MAX_REVIEW_CHARS = 20_000;
const MAX_OBSERVATIONS = 500;

export type ReviewObservation = {
  role: 'user' | 'assistant' | 'tool' | 'system' | 'unknown';
  content: string;
  confirmed: boolean;
};
export type PreparedReview = {
  text: string;
  observations: ReviewObservation[];
  eventCount: number;
  truncated: boolean;
};
export type ReviewStep = { title: string; procedure: string; expected: string; check: string };
export type AuthoredReview = {
  summary: string;
  evidence: string[];
  gaps: string[];
  nextSteps: ReviewStep[];
  instructorChecks: string[];
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const ROLES = ['user', 'assistant', 'tool', 'system'] as const;

export function prepareReview(input: string, format: 'text' | 'json' | 'auto' = 'auto'): PreparedReview {
  if (input.length > MAX_REVIEW_CHARS) throw Error('Use a log of at most 20,000 characters.');
  const text = input.trim();
  if (text.length < 20) throw Error('Provide at least 20 characters of session observations.');
  let observations: ReviewObservation[];
  const timestampedTranscript = /^\[(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/.test(text);
  if (format === 'json' || (format === 'auto' && !timestampedTranscript && (text.startsWith('[') || text.startsWith('{')))) {
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { throw Error('The JSON log is malformed. Use an events/logs array or a plain-text transcript.'); }
    const events = Array.isArray(parsed) ? parsed : record(parsed) ? parsed['events'] ?? parsed['logs'] : undefined;
    if (!Array.isArray(events) || events.length === 0)
      throw Error('The JSON log needs a non-empty events or logs array.');
    observations = events.map((event) => {
      if (!record(event) || typeof event['content'] !== 'string' ||
          !ROLES.includes(event['role'] as typeof ROLES[number]))
        throw Error('Each JSON event needs a user, assistant, tool or system role and text content.');
      let content = event['content'];
      const call = event['role'] === 'tool' && record(event['tool_call']) ? event['tool_call'] : null;
      if (call) {
        const params = record(call['params']) ? call['params'] : {};
        const descriptors = [
          ['tool', call['name']], ['requested setting', params['path']],
          ['requested measurement', params['measurementType']], ['requested source', params['source']],
        ].filter((item): item is [string, string] => typeof item[1] === 'string');
        if (descriptors.length) content += ' [Recorded request: ' + descriptors
          .map(([label, value]) => `${label} ${value.replace(/[._]/g, ' ').slice(0, 80)}`).join('; ') + ']';
      }
      return { role: event['role'] as ReviewObservation['role'], content, confirmed: event['confirmed'] === true };
    });
  } else {
    observations = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
      const match = /\b(USER|ASSISTANT|MODEL|TOOL|SYSTEM)\s*:\s*(.*)$/i.exec(line);
      const role = match?.[1]?.toLowerCase();
      return { role: role === 'model' ? 'assistant' : (role ?? 'unknown') as ReviewObservation['role'],
        content: match?.[2] ?? line, confirmed: false };
    });
  }
  if (!observations.some(event => event.content.trim())) throw Error('The log has no readable observations.');
  return { text, observations: observations.slice(0, MAX_OBSERVATIONS),
    eventCount: observations.length, truncated: observations.length > MAX_OBSERVATIONS };
}

const topics = [
  { name: 'safety and mode', match: /\b(safety|ground|input limit|training mode|simulator mode)\b/i },
  { name: 'probe ratio', match: /\b(probe|attenuation|compensation)\b/i },
  { name: 'timebase and period', match: /\b(timebase|period|horizontal)\b|s\/div/i },
  { name: 'voltage scale', match: /\b(amplitude|vpp|vertical|voltage scale|ch[1-4] scale)\b|v\/div/i },
  { name: 'triggering', match: /\b(trigger|edge|threshold|slope)\b/i },
  { name: 'measurements', match: /\b(frequency|rms|measure|measurement|hz)\b/i },
];
function quote(text: string) {
  return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email omitted]')
    .replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
}
const steps: Record<string, ReviewStep> = {
  safety: { title: 'Record the training context', procedure: 'Confirm RHODA shows training mode. Record the selected exercise, enabled channel and probe ratio before changing a setting.',
    expected: 'The record identifies simulated data and the settings used; no physical instrument is connected by this exercise.', check: 'Ask the learner to locate the training label and explain the difference between a simulated value and a hardware observation.' },
  probe: { title: 'Compare the displayed probe ratio', procedure: 'Use the 2 Vpp sine exercise and CH1. Preview and approve channel ratios 1× and 10×, then compare peak-to-peak measurements. Restore 10×.',
    expected: 'This ideal 10×-probe training model displays 0.2 Vpp at a 1× channel ratio and 2 Vpp at 10×. Real probe loading is not modeled.', check: 'Require both readbacks and the ratio settings; a prediction alone is not evidence of the measurement.' },
  timebase: { title: 'Connect timebase to period', procedure: 'Load the 1 kHz sine exercise. Preview and approve 0.0001 s/div, then compare the ten-division span with a Period measurement on CH1.',
    expected: 'The ideal period is 1 ms; ten divisions at 0.0001 s/div span one period.', check: 'Ask the learner to show the approved setting, measured period and units, then explain their agreement.' },
  scale: { title: 'Explain the voltage display range', procedure: 'Use the 2 Vpp sine exercise with CH1 enabled and a 10× channel ratio. Compare approved scales of 0.5 V/div and 0.1 V/div.',
    expected: 'At 0.5 V/div, 2 Vpp spans four vertical divisions. At 0.1 V/div it exceeds the eight-division display; display clipping does not change the ideal source.', check: 'Ask for the scale readbacks and clipping observation, with a distinction between display range and actual input limits.' },
  trigger: { title: 'Inspect trigger readiness', procedure: 'Use the sine exercise, CH1 trigger source, a rising edge and 0 V threshold. Inspect the training trace and trigger-possible indication.',
    expected: 'A crossing is possible for the ideal sine. This static analytical simulator does not demonstrate a hardware trigger engine or acquisition alignment.', check: 'Ask the learner to explain source, slope and threshold without claiming that the static preview proves hardware triggering.' },
  measure: { title: 'Cross-check frequency and period', procedure: 'With the 1 kHz sine exercise and CH1 enabled, preview and approve Frequency and Period without changing the source. Export the training evidence.',
    expected: 'The ideal values are 1000 Hz and 0.001 s; their product is one. The export retains simulated provenance and settings.', check: 'Compare the two actual logged results, source, units and settings. Do not substitute assistant suggestions for a learner action.' },
  recover: { title: 'Recover a fresh simulator readback', procedure: 'Read the original error context, reconnect or refresh the simulator, verify the selected exercise and enabled channel, then prepare a new preview before approval.',
    expected: 'A fresh readback or a clear unavailable state replaces stale data. Cancelled, expired or rejected previews are not applied.', check: 'Review the error and subsequent readback together; the keyword match does not diagnose the cause.' },
};

export function createAuthoredReview(prepared: PreparedReview): AuthoredReview {
  const observations = prepared.observations;
  const learner = observations.filter(event => event.role === 'user');
  const assistant = observations.filter(event => event.role === 'assistant');
  const tool = observations.filter(event => event.role === 'tool');
  const evidence = [`The supplied record contains ${learner.length} learner statements, ${assistant.length} assistant explanations and ${tool.length} tool entries in the reviewed portion.`];
  const gaps: string[] = [];
  for (const topic of topics) {
    const observation = learner.find(event => topic.match.test(event.content)) ?? tool.find(event => topic.match.test(event.content));
    if (observation) evidence.push(`${topic.name}: ${observation.role === 'tool' ? 'tool entry' : 'learner statement'} says “${quote(observation.content)}”. This is logged text, not independent verification.`);
    else gaps.push(`No learner statement or tool entry addresses ${topic.name} in the reviewed portion.`);
  }
  if (!learner.length) gaps.unshift('No learner explanation is present. Assistant text alone does not demonstrate understanding or completed work.');
  const confirmed = tool.filter(event => event.confirmed).length;
  if (confirmed) evidence.push(`${confirmed} structured tool entries are marked confirmed in the supplied log. Inspect their results and provenance before relying on them.`);
  else gaps.push('No structured confirmed tool action is present. Plain-text claims of confirmation are not independently validated.');
  if (prepared.truncated) gaps.unshift(`Only the first ${MAX_OBSERVATIONS} of ${prepared.eventCount} entries are reviewed. Use a narrower input for a complete checklist.`);
  const hasErrors = observations.some(event => /\b(error|failed|fault|denied|clipped)\b|no_signal|no signal/i.test(event.content));
  if (hasErrors) gaps.push('An error, fault or display-limit term appears. Review its original context; matching a keyword does not establish a diagnosis.');
  const candidates = [hasErrors ? 'recover' : 'safety'];
  for (const [key, topicIndex] of [['probe', 1], ['timebase', 2], ['scale', 3], ['trigger', 4]] as const)
    if (!learner.some(event => topics[topicIndex]!.match.test(event.content)) && !tool.some(event => topics[topicIndex]!.match.test(event.content))) candidates.push(key);
  candidates.push('measure', 'timebase');
  const chosen = [...new Set(candidates)].slice(0, 3).map(key => steps[key]!);
  return {
    summary: `Authored guidance from ${observations.length}${prepared.truncated ? ` of ${prepared.eventCount}` : ''} supplied log entries. These local rules do not grade a learner or establish proficiency. No model was called.`,
    evidence, gaps, nextSteps: chosen,
    instructorChecks: [
      'Confirm the source and ownership of the input. Pasted or uploaded text does not verify a learner identity.',
      'Separate learner actions, assistant advice, predictions and actual tool readbacks. Check the original record and units.',
      'Ask the learner to explain an observation and repeat a simulator task. This checklist is not a grade or a formal assessment.',
      'Use the manufacturer instructions and normal lab supervision for physical equipment; this review only proposes simulator exercises.',
    ],
  };
}
