/**
 * "We could not open this session" must never again be the whole story.
 *
 * The route's error boundary shows one calm paragraph, which is right for a
 * student and useless for an investigation: a missing session, someone else's
 * session, a half-built session, a snapshot from a newer build and a database
 * outage all produced exactly that paragraph and nothing else, anywhere.
 *
 * These tests pin two things. First, that a frozen session stays readable when
 * the question model grows — an old snapshot with no `assets`, no `instruction`
 * and a passage with no `kind` must still open, because a student mid-paper
 * cannot be told to start again over a field that did not exist when they
 * began. Second, that everything which does legitimately refuse is classified
 * and logged under its own name, while the student still sees the same calm
 * paragraph.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

const stub = (source) => ({ url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true });
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/headers') return stub('export async function cookies(){return {get(){return null}}}');
    if (specifier === '@/lib/supabase/admin') return stub('export const createAdminClient=()=>globalThis.__db');
    return next(specifier, context);
  },
});

const { readStudentSnapshot, STUDENT_SNAPSHOT_SCHEMA } = await import('../features/questions/snapshot.ts');
const { SessionOpenError, SESSION_OPEN_STUDENT_MESSAGE, classifyDatabaseError } =
  await import('../features/sessions/diagnostics.ts');
const { loadPracticeSessionForUser } = await import('../features/practice/service.ts');
const { isProseContext, contextHeading } = await import('../features/questions/context.ts');

/** Captures the structured server log without letting it reach the test output. */
function captureLogs(run) {
  const lines = [];
  const realError = console.error;
  const realInfo = console.info;
  console.error = (line) => lines.push(String(line));
  console.info = (line) => lines.push(String(line));
  return Promise.resolve()
    .then(run)
    .then(
      (value) => ({ value, lines, error: null }),
      (error) => ({ value: null, lines, error }),
    )
    .finally(() => { console.error = realError; console.info = realInfo; });
}

/**
 * The snapshot a session frozen today holds — every field the current question
 * model writes.
 */
const modernSnapshot = () => ({
  id: 'aloc-station:jamb:use-of-english:9001',
  source: { provider: 'aloc_station', providerQuestionId: '9001', internalQuestionId: null },
  examBody: 'jamb',
  subject: { id: 'use-of-english', slug: 'use-of-english', name: 'Use of English' },
  topic: null, year: 2019,
  instruction: 'Choose the option nearest in meaning to the word.',
  prompt: 'Candid',
  passage: null, discardedContext: null, assets: [],
  options: [
    { id: 'o-a', key: 'A', text: 'Frank' }, { id: 'o-b', key: 'B', text: 'Rude' },
    { id: 'o-c', key: 'C', text: 'Quiet' }, { id: 'o-d', key: 'D', text: 'Hasty' },
  ],
});

/**
 * The snapshot a session frozen before this year's question work holds: no
 * `assets`, no `instruction`, no `discardedContext`, and a passage that
 * pre-dates `kind`.
 */
const legacySnapshot = () => ({
  id: 'aloc:jamb:use-of-english:41',
  source: { provider: 'aloc', providerQuestionId: '41' },
  examBody: 'jamb',
  subject: { id: 'use-of-english', slug: 'use-of-english', name: 'Use of English' },
  topic: null, year: 2016,
  prompt: 'According to the passage, the narrator felt',
  passage: { id: 'p-41', body: 'The evening had worn on and the lamps were lit one by one along the street.' },
  options: [
    { id: 'l-a', key: 'A', text: 'relieved' }, { id: 'l-b', key: 'B', text: 'anxious' },
    { id: 'l-c', key: 'C', text: 'bored' }, { id: 'l-d', key: 'D', text: 'angry' },
  ],
});

// ------------------------------------- 7, 8, 9. legacy snapshots still open

test('a snapshot frozen before assets, instruction and discardedContext existed still opens', () => {
  const result = readStudentSnapshot(legacySnapshot(), 'row-1');

  assert.equal(result.failure, undefined, 'a missing optional field is not a failure');
  assert.ok(result.legacy, 'it should be recognisable as an old snapshot');
  assert.deepEqual(result.question.assets, [], 'absent assets read as no visual, never as undefined');
  assert.equal(result.question.instruction, null);
  assert.equal(result.question.discardedContext, null);
  assert.equal(result.question.prompt, 'According to the passage, the narrator felt');
  assert.equal(result.question.options.length, 4);
});

test('a passage frozen before `kind` existed keeps reading as prose', () => {
  const { question } = readStudentSnapshot(legacySnapshot(), 'row-1');

  assert.equal(question.passage.kind, undefined, 'an absent kind must not be invented');
  assert.ok(isProseContext(question.passage), 'an old passage is prose, as it always rendered');
  assert.equal(contextHeading(question.passage), 'Passage');
  assert.match(question.passage.body, /^The evening had worn on/);
});

test('a question with no assets opens when nothing on screen asks for a visual', () => {
  const withoutAssets = legacySnapshot();
  delete withoutAssets.assets;
  const { question, failure } = readStudentSnapshot(withoutAssets, 'row-1');

  assert.equal(failure, undefined);
  assert.equal(question.assets.length, 0);
  // The shape that used to throw `Cannot read properties of undefined (reading 'length')`
  // inside the runner and reach the student as "We could not open this session".
  assert.doesNotThrow(() => question.assets.length > 0);
});

test('reading a snapshot never rewrites the stored row', () => {
  const stored = legacySnapshot();
  const before = JSON.stringify(stored);
  readStudentSnapshot(stored, 'row-1');

  assert.equal(JSON.stringify(stored), before, 'the frozen row must come back untouched');
});

test('a modern snapshot is not mistaken for a legacy one', () => {
  const result = readStudentSnapshot(modernSnapshot(), 'row-1');
  assert.equal(result.failure, undefined);
  assert.equal(result.legacy, false);
});

// ------------------------------- 10. a malformed snapshot is classified

test('a malformed snapshot is classified rather than swallowed', () => {
  assert.equal(readStudentSnapshot(null, 'row-1').failure, 'SNAPSHOT_INVALID');
  assert.equal(readStudentSnapshot('a string', 'row-1').failure, 'SNAPSHOT_INVALID');
  assert.equal(readStudentSnapshot([1, 2, 3], 'row-1').failure, 'SNAPSHOT_INVALID');

  const noOptions = legacySnapshot();
  delete noOptions.options;
  assert.equal(readStudentSnapshot(noOptions, 'row-1').failure, 'QUESTION_DESERIALIZATION_FAILED');

  const noUsableOptions = { ...legacySnapshot(), options: [{ id: 'x', key: 'Z', text: 'not a key' }] };
  assert.equal(readStudentSnapshot(noUsableOptions, 'row-1').failure, 'QUESTION_DESERIALIZATION_FAILED');
  assert.equal(readStudentSnapshot({ ...legacySnapshot(), options: [] }, 'row-1').failure, 'QUESTION_DESERIALIZATION_FAILED');

  const future = { ...legacySnapshot(), schemaVersion: STUDENT_SNAPSHOT_SCHEMA + 1 };
  assert.equal(readStudentSnapshot(future, 'row-1').failure, 'SNAPSHOT_SCHEMA_UNSUPPORTED');
});

test('a degenerate but renderable question is never refused on the way out', () => {
  // The adapters refuse `too_few_options` when a session is frozen. Re-judging
  // it on read would let a later rule retroactively close an open session.
  const single = { ...legacySnapshot(), options: [{ id: 'x', key: 'A', text: 'only choice' }] };
  const { question, failure } = readStudentSnapshot(single, 'row-1');

  assert.equal(failure, undefined);
  assert.equal(question.options.length, 1);
});

test('every classified failure carries a detail that leaks no examination content', () => {
  for (const value of [null, 'x', [], { options: [] }]) {
    const { detail } = readStudentSnapshot(value, 'row-1');
    assert.ok(detail && detail.length > 0, 'a classified failure must say what was wrong');
    assert.ok(!/correctOptionKey|answer/i.test(detail), 'a diagnostic must never carry the key');
  }
});

test('an option missing its id is kept with a synthesised one rather than dropped', () => {
  const snapshot = legacySnapshot();
  delete snapshot.options[2].id;
  const { question } = readStudentSnapshot(snapshot, 'row-1');

  assert.equal(question.options.length, 4, 'losing a choice would change the paper');
  assert.equal(question.options[2].id, `${question.id}:C`);
});

// --------------------------------- database-error classification

test('a session id that is not a uuid is a dead link, not a database incident', () => {
  assert.equal(classifyDatabaseError({ code: '22P02', message: 'invalid input syntax for type uuid' }).failure,
    'SESSION_NOT_FOUND');
  assert.equal(classifyDatabaseError({ code: '08006', message: 'connection failure' }).failure, 'DATABASE_ERROR');
  assert.equal(classifyDatabaseError({ code: 'P0001', message: 'raise' }, { rpc: true }).failure, 'RPC_FAILED');
});

/* ---------------------------------------------------------------------------
 * The service, driven against a stubbed database.
 * ------------------------------------------------------------------------ */

const SESSION_ROW = {
  id: 'session-1', user_id: 'student', exam_body_id: 'jamb-id', subject_id: 'eng', topic_id: null,
  mode: 'practice', status: 'in_progress', difficulty: null, year_filter: null,
  requested_count: 1, question_count: 1, answered_count: 0, correct_count: 0,
  source_provider: 'aloc_station', started_at: '2026-09-01T10:00:00Z',
  expires_at: null, completed_at: null,
};

/**
 * A database holding one practice session. `overrides` reshapes exactly the
 * part a test is about, so each case differs from the working one by one thing.
 */
function database({ session = SESSION_ROW, questionRows, sessionError = null, answers = [] } = {}) {
  const rows = questionRows ?? [{
    id: 'row-1', session_id: 'session-1', position: 1,
    student_snapshot: legacySnapshot(), correct_option_key: 'B', explanation: null,
  }];

  globalThis.__db = {
    from(table) {
      const value = () => {
        if (table === 'practice_sessions') return session;
        if (table === 'subjects') return { slug: 'use-of-english', name: 'Use of English' };
        if (table === 'topics') return null;
        if (table === 'practice_session_questions') return rows;
        if (table === 'practice_answers') return answers;
        if (table === 'response_revisions') return [];
        throw new Error(`Unexpected table ${table}`);
      };
      const error = () => (table === 'practice_sessions' ? sessionError : null);
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain, order: () => chain, limit: () => chain,
        maybeSingle: async () => ({ data: error() ? null : value(), error: error() }),
        single: async () => ({ data: error() ? null : value(), error: error() }),
        then: (resolve) => Promise.resolve({ data: error() ? null : value(), error: error() }).then(resolve),
      };
      return chain;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

// ---------------------------------------- 14. a valid frozen session opens

test('a valid frozen session opens, resumes and keeps the answers already saved', async () => {
  database({
    answers: [{
      session_question_id: 'row-1', selected_option_key: 'B', is_correct: true,
    }],
  });

  const { value: session, error } = await captureLogs(() => loadPracticeSessionForUser('student', 'session-1'));

  assert.equal(error, null);
  assert.equal(session.id, 'session-1');
  assert.equal(session.questions.length, 1);
  assert.equal(session.questions[0].selectedOptionKey, 'B', 'a saved answer survives the reload');
  assert.equal(session.questions[0].feedback.correctOptionKey, 'B');
  assert.deepEqual(session.questions[0].question.assets, []);
});

test('reloading the same session twice returns the same paper', async () => {
  database();
  const first = await captureLogs(() => loadPracticeSessionForUser('student', 'session-1'));
  database();
  const second = await captureLogs(() => loadPracticeSessionForUser('student', 'session-1'));

  assert.deepEqual(
    first.value.questions.map((q) => q.question.id),
    second.value.questions.map((q) => q.question.id),
    'a refresh must not reshuffle or re-fetch a frozen paper',
  );
});

// ------------------------------------------------ 11. ownership is enforced

test("another student's session is refused, and the log says it was theirs", async () => {
  database({ session: { ...SESSION_ROW, user_id: 'someone-else' } });

  const { value, lines } = await captureLogs(() => loadPracticeSessionForUser('student', 'session-1'));

  assert.equal(value, null, 'it must be refused exactly as a missing session is');
  assert.ok(
    lines.some((line) => line.includes('failure=SESSION_FORBIDDEN')),
    `the refusal must be classified, got: ${lines.join(' | ')}`,
  );
  assert.ok(
    !lines.some((line) => line.includes('someone-else')),
    'the log must not carry the owning student',
  );
});

// --------------------------------------------- 12. a missing session

test('a session that does not exist is classified as not found', async () => {
  database({ session: null });

  const { value, lines } = await captureLogs(() => loadPracticeSessionForUser('student', 'session-1'));

  assert.equal(value, null);
  assert.ok(lines.some((line) => line.includes('failure=SESSION_NOT_FOUND')));
});

test('a session id that is not a uuid is refused as not found, not as a crash', async () => {
  database({ sessionError: { code: '22P02', message: 'invalid input syntax for type uuid: "not-a-uuid"' } });

  const { value, error, lines } = await captureLogs(() => loadPracticeSessionForUser('student', 'not-a-uuid'));

  assert.equal(error, null, 'a dead link must not reach the error boundary');
  assert.equal(value, null);
  assert.ok(lines.some((line) => line.includes('failure=SESSION_NOT_FOUND')));
});

test('a database outage is classified as a database error, not as a missing session', async () => {
  database({ sessionError: { code: '08006', message: 'connection failure' } });

  const { error, lines } = await captureLogs(() => loadPracticeSessionForUser('student', 'session-1'));

  assert.ok(error instanceof SessionOpenError);
  assert.equal(error.diagnostic.failure, 'DATABASE_ERROR');
  assert.equal(error.studentMessage, SESSION_OPEN_STUDENT_MESSAGE, 'the student still gets the calm sentence');
  assert.ok(lines.some((line) => line.includes('failure=DATABASE_ERROR')));
});

// ------------------------- 13. a half-built session is never navigated into

test('a session row with no questions behind it is refused as incomplete', async () => {
  database({ questionRows: [] });

  const { error, lines } = await captureLogs(() => loadPracticeSessionForUser('student', 'session-1'));

  assert.ok(error instanceof SessionOpenError);
  assert.equal(error.diagnostic.failure, 'SESSION_INCOMPLETE');
  assert.ok(lines.some((line) => line.includes('failure=SESSION_INCOMPLETE')));
});

test('a stored snapshot that cannot be read names the question position', async () => {
  database({
    questionRows: [{
      id: 'row-1', session_id: 'session-1', position: 7,
      student_snapshot: 'this is not an object', correct_option_key: 'B', explanation: null,
    }],
  });

  const { error, lines } = await captureLogs(() => loadPracticeSessionForUser('student', 'session-1'));

  assert.ok(error instanceof SessionOpenError);
  assert.equal(error.diagnostic.failure, 'SNAPSHOT_INVALID');
  assert.equal(error.diagnostic.position, 7);
  assert.ok(lines.some((line) => line.includes('position=7')));
});

// ------------------ 15. a deployment must not make a frozen session unreadable

test('an app update that adds optional fields does not make a frozen session unreadable', async () => {
  /*
   * The live regression shape: a session frozen by the previous build, opened
   * by a client that has just been updated. Nothing about the stored row
   * changed; only the code reading it did.
   */
  database();

  const { value, error } = await captureLogs(() => loadPracticeSessionForUser('student', 'session-1'));

  assert.equal(error, null, 'a valid frozen session must survive every later release');
  assert.equal(value.questions.length, 1);
  assert.equal(value.questions[0].question.prompt, 'According to the passage, the narrator felt');
});

test('a snapshot from a newer build is named, so a rollback is diagnosable', async () => {
  database({
    questionRows: [{
      id: 'row-1', session_id: 'session-1', position: 1,
      student_snapshot: { ...legacySnapshot(), schemaVersion: STUDENT_SNAPSHOT_SCHEMA + 1 },
      correct_option_key: 'B', explanation: null,
    }],
  });

  const { error, lines } = await captureLogs(() => loadPracticeSessionForUser('student', 'session-1'));

  assert.ok(error instanceof SessionOpenError);
  assert.equal(error.diagnostic.failure, 'SNAPSHOT_SCHEMA_UNSUPPORTED');
  assert.ok(lines.some((line) => line.includes('failure=SNAPSHOT_SCHEMA_UNSUPPORTED')));
});

test('opening a session built from legacy snapshots is counted', async () => {
  database();

  const { lines } = await captureLogs(() => loadPracticeSessionForUser('student', 'session-1'));

  assert.ok(
    lines.some((line) => line.includes('legacySnapshot') && line.includes('session=session-1')),
    `old snapshots in circulation must be countable, got: ${lines.join(' | ')}`,
  );
});

// ------------------------------------------- what a student is allowed to see

test('no failure class ever reaches the student as text', async () => {
  for (const setup of [
    { sessionError: { code: '08006', message: 'connection failure to db-prod-1.internal' } },
    { questionRows: [] },
    { questionRows: [{ id: 'row-1', session_id: 'session-1', position: 1, student_snapshot: null, correct_option_key: 'B', explanation: null }] },
  ]) {
    database(setup);
    const { error } = await captureLogs(() => loadPracticeSessionForUser('student', 'session-1'));
    assert.ok(error instanceof SessionOpenError);
    assert.equal(error.studentMessage, SESSION_OPEN_STUDENT_MESSAGE);
    assert.ok(!/db-prod-1|connection failure|snapshot/i.test(error.studentMessage));
  }
});
