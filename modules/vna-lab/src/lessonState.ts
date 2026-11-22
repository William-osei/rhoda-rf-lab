import { lessons, lessonQuizzes } from './content';

export interface LabSnapshot {
  dut: string;
  parameter: 's11' | 's21' | 's12' | 's22';
  format: string;
  sweep: { startHz: number; stopHz: number; points: number; spacing: 'linear' | 'log' };
  markerHz: number;
  solStandards: ('open' | 'short' | 'load')[];
  solActive: boolean;
  thruActive: boolean;
  markerDb: number | null;
  phaseDeg: number | null;
  groupDelaySeconds: number | null;
  calibrationInvalidated?: boolean;
  exportCount?: number;
  visitedParts?: string[];
}
export interface LessonProgress {
  version: 2;
  lessonId: string;
  stepIndex: number;
  reviewed: string[];
  answers: Record<string, number>;
  notes: Record<string, string>;
}
export interface PracticeCheck {
  label: string;
  met: boolean | null;
  detail: string;
}
export const LESSON_STORAGE_KEY = 'vna-lab-studio-v2';
export const MAX_NOTE_LENGTH = 1200;
export const stepKey = (lessonId: string, stepIndex: number) => `${lessonId}:${stepIndex}`;
const allKeys = new Set(
  lessons.flatMap((lesson) => lesson.steps.map((_, index) => stepKey(lesson.id, index))),
);
export const totalLessonSteps = allKeys.size;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function emptyProgress(): LessonProgress {
  return {
    version: 2,
    lessonId: lessons[0].id,
    stepIndex: 0,
    reviewed: [],
    answers: {},
    notes: {},
  };
}
/** Only known step keys and bounded primitive values can return from untrusted browser storage. */
export function parseLessonProgress(raw: string | null): LessonProgress {
  const clean = emptyProgress();
  if (!raw || raw.length > 80_000) return clean;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return clean;
  }
  if (!isRecord(data) || data.version !== 2) return clean;
  const lesson = lessons.find((item) => item.id === data.lessonId);
  if (lesson) {
    clean.lessonId = lesson.id;
    if (
      Number.isInteger(data.stepIndex) &&
      (data.stepIndex as number) >= 0 &&
      (data.stepIndex as number) < lesson.steps.length
    )
      clean.stepIndex = data.stepIndex as number;
  }
  if (Array.isArray(data.reviewed))
    clean.reviewed = [
      ...new Set(
        data.reviewed.filter((key): key is string => typeof key === 'string' && allKeys.has(key)),
      ),
    ];
  if (isRecord(data.answers))
    for (const [key, answer] of Object.entries(data.answers)) {
      const quiz = Object.hasOwn(lessonQuizzes, key) ? lessonQuizzes[key] : undefined;
      if (
        allKeys.has(key) &&
        quiz &&
        Number.isInteger(answer) &&
        (answer as number) >= 0 &&
        (answer as number) < quiz.options.length
      )
        clean.answers[key] = answer as number;
    }
  if (isRecord(data.notes))
    for (const [key, note] of Object.entries(data.notes))
      if (allKeys.has(key) && typeof note === 'string')
        clean.notes[key] = note.slice(0, MAX_NOTE_LENGTH);
  return clean;
}
/** Migrate only self-reported boolean review marks when no version-2 record exists. */
export function restoreLessonProgress(raw: string | null, legacy: string | null): LessonProgress {
  if (raw !== null && raw !== '') return parseLessonProgress(raw);
  const clean = emptyProgress();
  if (!legacy || legacy.length > 20_000) return clean;
  let data: unknown;
  try {
    data = JSON.parse(legacy);
  } catch {
    return clean;
  }
  if (!isRecord(data)) return clean;
  clean.reviewed = Object.entries(data)
    .filter(([key, value]) => allKeys.has(key) && value === true)
    .map(([key]) => key);
  return clean;
}
export function jumpToStep(state: LessonProgress, lessonId: string, index: number): LessonProgress {
  const lesson = lessons.find((item) => item.id === lessonId);
  if (!lesson || !Number.isInteger(index)) return state;
  return { ...state, lessonId, stepIndex: Math.max(0, Math.min(lesson.steps.length - 1, index)) };
}
export function moveStep(state: LessonProgress, direction: -1 | 1): LessonProgress {
  const positions = lessons.flatMap((lesson) =>
    lesson.steps.map((_, index) => ({ lessonId: lesson.id, index })),
  );
  const current = positions.findIndex(
    (position) => position.lessonId === state.lessonId && position.index === state.stepIndex,
  );
  const target = positions[Math.max(0, Math.min(positions.length - 1, current + direction))];
  return jumpToStep(state, target.lessonId, target.index);
}
export function toggleReviewed(state: LessonProgress): LessonProgress {
  const key = stepKey(state.lessonId, state.stepIndex);
  return {
    ...state,
    reviewed: state.reviewed.includes(key)
      ? state.reviewed.filter((item) => item !== key)
      : [...state.reviewed, key],
  };
}
export function quizFeedback(
  key: string,
  answer: number,
): { correct: boolean; explanation: string } | null {
  const quiz = Object.hasOwn(lessonQuizzes, key) ? lessonQuizzes[key] : undefined;
  if (!quiz || !Number.isInteger(answer) || answer < 0 || answer >= quiz.options.length)
    return null;
  return { correct: answer === quiz.correctIndex, explanation: quiz.explanation };
}

/** These checks describe the current bench snapshot, not the sequence of actions or proficiency. */
export function evaluatePractice(
  lessonId: string,
  index: number,
  snapshot: LabSnapshot | null,
): PracticeCheck[] {
  if (!snapshot)
    return [
      {
        label: 'Read the current bench',
        met: null,
        detail: 'Bench state is unavailable. You can still read, answer and take notes.',
      },
    ];
  const s = snapshot;
  const finite = (n: number | null | undefined): n is number =>
    typeof n === 'number' && Number.isFinite(n);
  const check = (label: string, met: boolean | null, detail: string): PracticeCheck => ({
    label,
    met,
    detail,
  });
  const parameter = (name: string) =>
    check(
      `${name.toUpperCase()} selected`,
      s.parameter === name,
      `Current response: ${s.parameter.toUpperCase()}.`,
    );
  const dut = (id: string, label: string) =>
    check(label, s.dut === id, `Current device: ${s.dut}.`);
  const key = stepKey(lessonId, index);
  switch (key) {
    case 'getting-started:0':
      return [
        dut('through', 'Through cable loaded'),
        check(
          'Inspect a test port',
          s.visitedParts
            ? s.visitedParts.some((part) => part === 'port1' || part === 'port2')
            : null,
          s.visitedParts
            ? 'Uses parts actually selected in this app session.'
            : 'Part visits are not recorded in this session.',
        ),
      ];
    case 'getting-started:1':
      return [
        check(
          '100 MHz to 3 GHz sweep',
          s.sweep.startHz === 100e6 && s.sweep.stopHz === 3e9,
          `Current window: ${(s.sweep.startHz / 1e6).toFixed(2)}–${(s.sweep.stopHz / 1e6).toFixed(2)} MHz.`,
        ),
        check(
          '401 linear samples',
          s.sweep.points === 401 && s.sweep.spacing === 'linear',
          `${s.sweep.points} points · ${s.sweep.spacing} spacing.`,
        ),
      ];
    case 'getting-started:2':
      return [
        dut('through', 'Through cable loaded'),
        parameter('s21'),
        check(
          'Phase view selected',
          s.format === 'phase',
          `Current format: ${s.format}. This checks the current view, not whether you compared both parameters.`,
        ),
      ];
    case 'getting-started:3':
      return [
        check(
          'Marker inside the sweep',
          finite(s.markerHz) && s.markerHz >= s.sweep.startHz && s.markerHz <= s.sweep.stopHz,
          `Marker: ${(s.markerHz / 1e6).toFixed(3)} MHz.`,
        ),
        check(
          'Finite marker magnitude',
          finite(s.markerDb),
          finite(s.markerDb)
            ? `${s.parameter.toUpperCase()} magnitude: ${s.markerDb.toFixed(2)} dB.`
            : 'The selected response has no finite magnitude readout.',
        ),
      ];
    case 'reflection-calibration:0':
      return [
        parameter('s11'),
        check(
          'Current sweep grid',
          null,
          `${s.sweep.points} points over ${(s.sweep.startHz / 1e6).toFixed(1)}–${(s.sweep.stopHz / 1e6).toFixed(1)} MHz. Standards must use this same grid.`,
        ),
      ];
    case 'reflection-calibration:1':
      return [
        check(
          'Open, short and load captured',
          ['open', 'short', 'load'].every((standard) =>
            s.solStandards.includes(standard as 'open' | 'short' | 'load'),
          ),
          `${new Set(s.solStandards).size} of 3 standards captured.`,
        ),
        check(
          'S11 correction active',
          s.solActive,
          s.solActive
            ? 'The three-term Port 1 correction is active.'
            : 'Capture all three standards on the current grid.',
        ),
      ];
    case 'reflection-calibration:2':
      return [
        dut('load', 'Matched load connected'),
        parameter('s11'),
        check('SOL active', s.solActive, 'Correction applies to Port 1 S11 only.'),
        check(
          'Corrected load close to the display floor',
          s.solActive && finite(s.markerDb) && s.markerDb < -80,
          finite(s.markerDb)
            ? `Current magnitude: ${s.markerDb.toFixed(2)} dB. A finite display floor is used.`
            : 'No finite marker magnitude is available.',
        ),
      ];
    case 'reflection-calibration:3':
      return [
        check(
          'Calibration invalidated after a sweep change',
          s.calibrationInvalidated ?? null,
          s.calibrationInvalidated === undefined
            ? 'This action history is not recorded. Inspect the status after you change and run the sweep.'
            : s.calibrationInvalidated
              ? 'A prior capture set was cleared by a grid change in this session.'
              : 'Capture standards first, then change the sweep and run it.',
        ),
      ];
    case 'transmission-normalization:0':
      return [
        dut('through', 'Through cable connected'),
        parameter('s21'),
        check(
          'Relative normalization off',
          !s.thruActive,
          'Read the unnormalized cable before capturing a comparison reference.',
        ),
      ];
    case 'transmission-normalization:1':
      return [
        dut('through', 'Same through path connected'),
        parameter('s21'),
        check(
          'THRU reference active',
          s.thruActive,
          'Transmission is divided by the captured reference; reflection is unchanged.',
        ),
        check(
          'Approximately unity relative transmission',
          s.thruActive &&
            finite(s.markerDb) &&
            Math.abs(s.markerDb) < 0.05 &&
            finite(s.phaseDeg) &&
            Math.abs(s.phaseDeg) < 0.1,
          finite(s.markerDb) && finite(s.phaseDeg)
            ? `${s.markerDb.toFixed(3)} dB · ${s.phaseDeg.toFixed(2)}°. A relative comparison, not a gain certification.`
            : 'No usable magnitude/phase marker is available.',
        ),
      ];
    case 'transmission-normalization:2':
      return [
        dut('attenuator', '10 dB attenuator selected'),
        parameter('s21'),
        check(
          'THRU reference cleared',
          !s.thruActive,
          'Clear the relative reference before expecting the absolute analytic attenuation.',
        ),
        check(
          'Approximately −10 dB',
          !s.thruActive && finite(s.markerDb) && Math.abs(s.markerDb + 10) < 0.1,
          finite(s.markerDb)
            ? `Current magnitude: ${s.markerDb.toFixed(2)} dB.`
            : 'No usable magnitude is available.',
        ),
      ];
    case 'filter-investigation:0':
      return [
        dut('bandpass', '2.4 GHz band-pass selected'),
        parameter('s21'),
        check(
          'Peak lies inside sweep',
          s.sweep.startHz < 2.4e9 && s.sweep.stopHz > 2.4e9,
          'The analytic resonance is at 2.4 GHz; keep frequencies on both sides.',
        ),
        check('Magnitude view selected', s.format === 'logmag', `Current format: ${s.format}.`),
      ];
    case 'filter-investigation:1':
      return [
        dut('bandpass', 'Band-pass selected'),
        parameter('s21'),
        check(
          'Marker close to the sampled peak',
          finite(s.markerHz) &&
            Math.abs(s.markerHz - 2.4e9) <
              Math.max(15e6, (s.sweep.stopHz - s.sweep.startHz) / (s.sweep.points - 1)),
          'This checks the marker position, not which search control you used.',
        ),
      ];
    case 'filter-investigation:3':
      return [
        parameter('s11'),
        check(
          'Reflection Smith chart selected',
          s.format === 'smith',
          `Current format: ${s.format}. Explain the relationship with the transmission response in your note.`,
        ),
      ];
    case 'evidence-report:0':
      return [
        check(
          'A defined sweep is present',
          finite(s.sweep.startHz) && finite(s.sweep.stopHz) && s.sweep.startHz < s.sweep.stopHz,
          `${s.dut} · ${s.parameter.toUpperCase()} · ${s.format} · 50 Ω reference.`,
        ),
      ];
    case 'evidence-report:1':
      return [
        check(
          'An export was requested in this session',
          s.exportCount === undefined ? null : s.exportCount > 0,
          s.exportCount === undefined
            ? 'Export actions are not recorded. Save the data with the bench export controls.'
            : `${s.exportCount} export request(s). This cannot verify that your browser saved a file.`,
        ),
      ];
    default:
      return [];
  }
}
