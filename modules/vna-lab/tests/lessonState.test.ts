import { describe, expect, it } from 'vitest';
import { lessons, lessonQuizzes } from '../src/content';
import {
  emptyProgress,
  evaluatePractice,
  jumpToStep,
  MAX_NOTE_LENGTH,
  moveStep,
  parseLessonProgress,
  quizFeedback,
  restoreLessonProgress,
  toggleReviewed,
  totalLessonSteps,
  type LabSnapshot,
} from '../src/lessonState';

const snapshot = (values: Partial<LabSnapshot> = {}): LabSnapshot => ({
  dut: 'through',
  parameter: 's21',
  format: 'logmag',
  sweep: { startHz: 100e6, stopHz: 3e9, points: 401, spacing: 'linear' },
  markerHz: 2.4e9,
  solStandards: [],
  solActive: false,
  thruActive: false,
  markerDb: -0.4,
  phaseDeg: 0,
  groupDelaySeconds: 2e-9,
  ...values,
});

describe('lesson resume data boundary', () => {
  it('uses a fresh bounded state for malformed, oversized or unsupported data', () => {
    for (const raw of [
      null,
      '',
      '{bad',
      JSON.stringify([]),
      JSON.stringify({ version: 1, reviewed: ['getting-started:0'] }),
      ' '.repeat(80_001),
    ])
      expect(parseLessonProgress(raw)).toEqual(emptyProgress());
  });
  it('retains only authored lesson steps, real option indexes and bounded text', () => {
    const result = parseLessonProgress(
      JSON.stringify({
        version: 2,
        lessonId: 'reflection-calibration',
        stepIndex: 2,
        reviewed: ['getting-started:0', 'getting-started:0', 'fake:99', true],
        answers: {
          'getting-started:0': 1,
          'getting-started:1': '1',
          'getting-started:2': -1,
          'getting-started:3': 99,
          'fake:1': 0,
        },
        notes: {
          'getting-started:0': 'a'.repeat(5000),
          'getting-started:1': { html: '<script>' },
          'fake:1': 'ignored',
        },
      }),
    );
    expect(result.lessonId).toBe('reflection-calibration');
    expect(result.stepIndex).toBe(2);
    expect(result.reviewed).toEqual(['getting-started:0']);
    expect(result.answers).toEqual({ 'getting-started:0': 1 });
    expect(result.notes).toEqual({ 'getting-started:0': 'a'.repeat(MAX_NOTE_LENGTH) });
  });
  it('cannot restore unknown or out-of-range navigation', () => {
    expect(
      parseLessonProgress(JSON.stringify({ version: 2, lessonId: 'fake', stepIndex: 2 })).lessonId,
    ).toBe(lessons[0].id);
    expect(
      parseLessonProgress(JSON.stringify({ version: 2, lessonId: 'getting-started', stepIndex: 4 }))
        .stepIndex,
    ).toBe(0);
    expect(
      parseLessonProgress(
        JSON.stringify({ version: 2, lessonId: 'getting-started', stepIndex: 1.5 }),
      ).stepIndex,
    ).toBe(0);
  });
  it('ignores prototype-shaped keys instead of treating them as quiz definitions', () => {
    const result = parseLessonProgress(
      '{"version":2,"answers":{"__proto__":0,"constructor":1},"notes":{"__proto__":"x"}}',
    );
    expect(result.answers).toEqual({});
    expect(result.notes).toEqual({});
    expect(quizFeedback('__proto__', 0)).toBeNull();
    expect(quizFeedback('constructor', 1)).toBeNull();
  });
  it('migrates only real boolean legacy review marks and never overwrites existing version-2 choices', () => {
    const legacy = JSON.stringify({
      'getting-started:0': true,
      'getting-started:1': 'true',
      'getting-started:2': false,
      'fake:1': true,
    });
    expect(restoreLessonProgress(null, legacy).reviewed).toEqual(['getting-started:0']);
    expect(restoreLessonProgress(JSON.stringify(emptyProgress()), legacy).reviewed).toEqual([]);
    expect(restoreLessonProgress('{bad', legacy).reviewed).toEqual([]);
    expect(restoreLessonProgress(null, JSON.stringify([true]))).toEqual(emptyProgress());
  });
});

describe('lesson navigation and feedback', () => {
  it('crosses lesson boundaries and clamps the beginning and end of the course', () => {
    expect(moveStep(emptyProgress(), -1)).toEqual(emptyProgress());
    const next = moveStep(jumpToStep(emptyProgress(), 'getting-started', 3), 1);
    expect([next.lessonId, next.stepIndex]).toEqual(['reflection-calibration', 0]);
    const previous = moveStep(next, -1);
    expect([previous.lessonId, previous.stepIndex]).toEqual(['getting-started', 3]);
    const end = jumpToStep(emptyProgress(), 'evidence-report', 99);
    expect(moveStep(end, 1)).toEqual(end);
  });
  it('review marks are explicit and reversible; navigation alone never marks a step reviewed', () => {
    const start = emptyProgress();
    expect(moveStep(start, 1).reviewed).toEqual([]);
    const marked = toggleReviewed(start);
    expect(marked.reviewed).toEqual(['getting-started:0']);
    expect(start.reviewed).toEqual([]);
    expect(toggleReviewed(marked).reviewed).toEqual([]);
  });
  it('every step has a coherent low-stakes question with explanatory feedback', () => {
    expect(totalLessonSteps).toBe(19);
    for (const lesson of lessons)
      lesson.steps.forEach((_, index) => {
        const key = `${lesson.id}:${index}`,
          quiz = lessonQuizzes[key];
        expect(quiz.options.length).toBeGreaterThanOrEqual(3);
        expect(quiz.correctIndex).toBeLessThan(quiz.options.length);
        expect(quizFeedback(key, quiz.correctIndex)).toEqual({
          correct: true,
          explanation: quiz.explanation,
        });
        expect(quizFeedback(key, (quiz.correctIndex + 1) % quiz.options.length)?.correct).toBe(
          false,
        );
        expect(quizFeedback(key, 99)).toBeNull();
        expect(quizFeedback(key, 1.5)).toBeNull();
      });
  });
});

describe('current bench evidence', () => {
  it('does not infer a completed calibration from three captures if correction is inactive', () => {
    const checks = evaluatePractice(
      'reflection-calibration',
      1,
      snapshot({ solStandards: ['open', 'short', 'load'], solActive: false }),
    );
    expect(checks.map((check) => check.met)).toEqual([true, false]);
  });
  it('requires S11, a load and active correction before identifying a corrected load check', () => {
    const good = snapshot({ dut: 'load', parameter: 's11', solActive: true, markerDb: -120 });
    expect(evaluatePractice('reflection-calibration', 2, good).every((check) => check.met)).toBe(
      true,
    );
    expect(
      evaluatePractice('reflection-calibration', 2, { ...good, solActive: false }).at(-1)?.met,
    ).toBe(false);
  });
  it('does not treat an attenuator ratio as an absolute −10 dB observation while THRU is active', () => {
    const active = snapshot({ dut: 'attenuator', markerDb: -10, thruActive: true });
    expect(evaluatePractice('transmission-normalization', 2, active).at(-1)?.met).toBe(false);
    expect(
      evaluatePractice('transmission-normalization', 2, { ...active, thruActive: false }).every(
        (check) => check.met,
      ),
    ).toBe(true);
  });
  it('requires both magnitude and phase for the self-normalized through observation', () => {
    expect(
      evaluatePractice(
        'transmission-normalization',
        1,
        snapshot({ thruActive: true, markerDb: 0, phaseDeg: 0 }),
      ).at(-1)?.met,
    ).toBe(true);
    expect(
      evaluatePractice(
        'transmission-normalization',
        1,
        snapshot({ thruActive: true, markerDb: 0, phaseDeg: 20 }),
      ).at(-1)?.met,
    ).toBe(false);
  });
  it('leaves unavailable action history unverified rather than passing fresh default settings', () => {
    expect(evaluatePractice('reflection-calibration', 3, snapshot())[0].met).toBeNull();
    expect(evaluatePractice('evidence-report', 1, snapshot())[0].met).toBeNull();
    expect(evaluatePractice('getting-started', 0, snapshot())[1].met).toBeNull();
  });
  it('never accepts nonfinite readouts as marker evidence and supports unavailable bench state', () => {
    expect(
      evaluatePractice('getting-started', 3, snapshot({ markerHz: Infinity, markerDb: NaN })).every(
        (check) => check.met === false,
      ),
    ).toBe(true);
    expect(evaluatePractice('getting-started', 0, null)[0].met).toBeNull();
    expect(evaluatePractice('evidence-report', 2, snapshot())).toEqual([]);
  });
});
