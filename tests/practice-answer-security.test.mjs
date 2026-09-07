import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

/*
 * These tests defend one property: during a session where per-question feedback
 * is deliberately withheld, the payload the server sends the browser must not
 * let anyone work out whether an answer was right.
 *
 * A running `correctCount` is enough on its own. Answer one question, reload,
 * read the number: that is the whole answer key, one question at a time. So the
 * assertions here are about the SERVER PAYLOAD, never about what the UI chooses
 * to render — a component that simply ignores a leaked field is not a fix.
 */

const stub = (source) => ({ url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true });

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@/lib/supabase/admin') {
      return stub(`export function createAdminClient(){ return globalThis.__admin; }`);
    }
    return next(specifier, context);
  },
});

/** Minimal stand-in for the query shapes loadPracticeSessionForUser actually uses. */
function makeAdminClient(tables) {
  const from = (name) => {
    let rows = [...(tables[name] ?? [])];
    const api = {
      select: () => api,
      eq: (column, value) => { rows = rows.filter((r) => r[column] === value); return api; },
      in: (column, values) => { rows = rows.filter((r) => values.includes(r[column])); return api; },
      order: (column) => { rows = [...rows].sort((a, b) => (a[column] > b[column] ? 1 : a[column] < b[column] ? -1 : 0)); return api; },
      limit: (n) => { rows = rows.slice(0, n); return api; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      single: async () => ({ data: rows[0] ?? null, error: rows.length ? null : { message: 'no rows' } }),
      then: (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
    };
    return api;
  };
  return { from, rpc: async () => ({ data: null, error: null }) };
}

const USER = 'user-1';
const SESSION = 'session-1';

function buildTables({ mode, status, correctCount, answers }) {
  return {
    practice_sessions: [{
      id: SESSION, user_id: USER, mode, status,
      subject_id: 'subject-1', topic_id: null, difficulty: null, year_filter: null,
      requested_count: 3, question_count: 3,
      answered_count: answers.length, correct_count: correctCount,
      source_provider: 'aloc',
      started_at: '2026-09-07T10:00:00Z',
      expires_at: mode === 'timed' ? '2026-09-07T10:30:00Z' : null,
      completed_at: status === 'completed' ? '2026-09-07T10:20:00Z' : null,
    }],
    subjects: [{ id: 'subject-1', slug: 'physics', name: 'Physics' }],
    topics: [],
    practice_session_questions: [1, 2, 3].map((position) => ({
      id: `q${position}`, session_id: SESSION, position,
      student_snapshot: { id: `snap-${position}`, prompt: `Question ${position}`, options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }] },
      correct_option_key: 'A',
      explanation: `Because ${position}.`,
    })),
    practice_answers: answers.map((a) => ({
      session_id: SESSION, session_question_id: a.questionId, user_id: USER,
      selected_option_key: a.selected, is_correct: a.selected === 'A',
    })),
    response_revisions: [],
  };
}

async function loadView(config) {
  globalThis.__admin = makeAdminClient(buildTables(config));
  const { loadPracticeSessionForUser } = await import('../features/practice/service.ts');
  return loadPracticeSessionForUser(USER, SESSION);
}

// ─────────────────────────────────────────────────────────────────────── A
test('A. normal practice still receives its intended feedback', async () => {
  const view = await loadView({
    mode: 'practice', status: 'in_progress', correctCount: 1,
    answers: [{ questionId: 'q1', selected: 'A' }],
  });

  assert.equal(view.mode, 'practice');
  assert.equal(view.correctCount, 1, 'practice mode reveals correctness, so the count stays visible');

  const answered = view.questions.find((q) => q.id === 'q1');
  assert.ok(answered.feedback, 'an answered practice question carries feedback');
  assert.equal(answered.feedback.isCorrect, true);
  assert.equal(answered.feedback.correctOptionKey, 'A');
  assert.equal(answered.feedback.explanation, 'Because 1.');

  const untouched = view.questions.find((q) => q.id === 'q2');
  assert.equal(untouched.feedback, null, 'an unanswered question never carries feedback');
  assert.equal(untouched.question.correctOptionKey, undefined, 'the snapshot never carries the key');
});

// ─────────────────────────────────────────────────────────────────────── B
test('B. in-progress timed practice cannot reveal correctness through correctCount', async () => {
  const oneRight = await loadView({
    mode: 'timed', status: 'in_progress', correctCount: 1,
    answers: [{ questionId: 'q1', selected: 'A' }],
  });
  const oneWrong = await loadView({
    mode: 'timed', status: 'in_progress', correctCount: 0,
    answers: [{ questionId: 'q1', selected: 'B' }],
  });

  assert.equal(oneRight.correctCount, null, 'a correct answer must not be observable mid-session');
  assert.equal(oneWrong.correctCount, null, 'nor must an incorrect one');
  assert.deepEqual(
    oneRight.correctCount, oneWrong.correctCount,
    'the two payloads must be indistinguishable — that is what removes the oracle',
  );

  assert.equal(oneRight.answeredCount, 1, 'progress is still reported; only correctness is hidden');
  assert.equal(oneRight.questions[0].feedback, null, 'and per-question feedback stays withheld');
});

// ─────────────────────────────────────────────────────────────────────── C
test('C. reloading an in-progress timed session still reveals nothing', async () => {
  // A reload is just another load of the same session, so the oracle would work
  // by answering, reloading, and reading the number. Walk the whole sequence.
  const sequence = [];
  for (const [answers, correct] of [
    [[], 0],
    [[{ questionId: 'q1', selected: 'A' }], 1],
    [[{ questionId: 'q1', selected: 'A' }, { questionId: 'q2', selected: 'B' }], 1],
    [[{ questionId: 'q1', selected: 'A' }, { questionId: 'q2', selected: 'B' }, { questionId: 'q3', selected: 'A' }], 2],
  ]) {
    const view = await loadView({ mode: 'timed', status: 'in_progress', correctCount: correct, answers });
    sequence.push(view.correctCount);
  }

  assert.deepEqual(sequence, [null, null, null, null],
    'across every reload the count stays null, so no step of the sequence is informative');
});

// ─────────────────────────────────────────────────────────────────────── D
test('D. a completed timed session exposes the real final count', async () => {
  const view = await loadView({
    mode: 'timed', status: 'completed', correctCount: 2,
    answers: [{ questionId: 'q1', selected: 'A' }, { questionId: 'q2', selected: 'B' }, { questionId: 'q3', selected: 'A' }],
  });

  assert.equal(view.correctCount, 2, 'once the session is over the score is the point');
  assert.notEqual(view.correctCount, null);

  const reviewed = view.questions.find((q) => q.id === 'q1');
  assert.ok(reviewed.feedback, 'and review feedback is released with it');
  assert.equal(reviewed.feedback.correctOptionKey, 'A');
});

test('D2. a completed session scoring zero is distinguishable from a withheld count', async () => {
  const view = await loadView({
    mode: 'timed', status: 'completed', correctCount: 0,
    answers: [{ questionId: 'q1', selected: 'B' }],
  });

  assert.equal(view.correctCount, 0, 'a real zero must be reported as zero');
  assert.notEqual(view.correctCount, null, 'null means "withheld", never "you scored nothing"');
});

// ─────────────────────────────────────────────────────────────────────── E
test('E. the exam attempt view carries no correctness field at all', async () => {
  // Mocks were never affected, and must stay that way: the fix must not have
  // introduced a correctness field on the exam side by symmetry.
  const source = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../features/exams/types.ts', import.meta.url), 'utf8'));

  const viewBlock = source.slice(source.indexOf('interface ExamAttemptView'));
  const body = viewBlock.slice(0, viewBlock.indexOf('}'));

  assert.doesNotMatch(body, /correctCount/, 'ExamAttemptView must expose no correct count');
  assert.match(body, /answeredCount/, 'progress counters are still expected');
  assert.match(body, /flaggedCount/);

  const serviceSource = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../features/exams/service.ts', import.meta.url), 'utf8'));
  assert.doesNotMatch(serviceSource, /correctCount:/, 'the exam service must never map correct_count into a view');
});

test('the student snapshot never carries an answer key in any mode', async () => {
  for (const mode of ['practice', 'timed']) {
    for (const status of ['in_progress', 'completed']) {
      const view = await loadView({ mode, status, correctCount: 1, answers: [{ questionId: 'q1', selected: 'A' }] });
      for (const item of view.questions) {
        assert.equal(item.question.correctOptionKey, undefined, `${mode}/${status}: snapshot leaked a key`);
        assert.equal(item.question.explanation, undefined, `${mode}/${status}: snapshot leaked an explanation`);
      }
    }
  }
});
