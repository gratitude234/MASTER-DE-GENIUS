import { registerAliasHook } from './alias-hook.mjs';

registerAliasHook();

/**
 * Why a mock attempt will not open, answered from the rows themselves.
 *
 * `app/exam/[attemptId]/error.tsx` renders one calm paragraph for every cause
 * and the exam route — unlike Practice — never got the session-open
 * classification, so a student who "keeps seeing that error" leaves no
 * structured trace of which defect they hit. This replays, in order, every
 * check `loadExamAttemptForUser` performs, against real attempt rows, and names
 * the first one that would throw.
 *
 * It is a diagnostic, not a second implementation: the snapshot verdict comes
 * from the app's own `readStudentSnapshot`, so a snapshot this probe calls
 * readable is one the runner can render, by construction.
 *
 * READ-ONLY. It issues selects and nothing else — no insert, update, delete or
 * rpc — so it is safe against production and safe to re-run.
 *
 * Student identity is masked: the probe prints an attempt id (which is what you
 * need to find the row) and the first eight characters of a user id (enough to
 * see "these six failures are all one student"), never a name or an email, and
 * never option text, which is the visible answer list.
 *
 *   node --experimental-transform-types --env-file=.env.local \
 *     scripts/exam-open-probe.mjs [--limit=100] [--attempt=<uuid>] [--user=<uuid>]
 */

const { createAdminClient } = await import('@/lib/supabase/admin');
const { readStudentSnapshot } = await import('@/features/questions/snapshot');

const arg = (name) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const LIMIT = Number(arg('limit') ?? 100);
const ONE_ATTEMPT = arg('attempt');
const ONE_USER = arg('user');

/** Kept in step with `features/exams/service.ts`. A drift here is itself a finding. */
const EXAM_CODES = new Set(['jamb', 'waec', 'neco', 'post_utme', 'school']);
const OPTION_KEYS = new Set(['A', 'B', 'C', 'D', 'E']);

/**
 * The statuses `app/exam/[attemptId]/page.tsx` actually branches on.
 *
 * `submitted` redirects to results and `in_progress` renders the runner.
 * Everything else falls through to the runner holding a paper that is over,
 * which is a defect whether or not it throws.
 */
const HANDLED_STATUSES = new Set(['submitted', 'in_progress']);

const mask = (id) => (typeof id === 'string' ? `${id.slice(0, 8)}…` : String(id));
const short = (value, max = 160) => String(value ?? '').replace(/\s+/g, ' ').slice(0, max);

const db = createAdminClient();

async function probeAttempt(attempt) {
  /** Every defect found, in the order `loadExamAttemptForUser` would meet it. */
  const failures = [];
  const note = (failure, detail) => failures.push({ failure, detail });

  const attemptId = attempt.id;

  // --- service.ts:273 — the expiry sweep, and the DB's own status invariant ---
  if (!HANDLED_STATUSES.has(attempt.status)) {
    note('STATUS_UNHANDLED', `status=${attempt.status} reaches the runner unbranched (page.tsx only handles submitted/in_progress)`);
  }
  if (attempt.started_at === null || attempt.expires_at === null) {
    // service.ts:333-334 asserts both non-null with `!`.
    note('NULL_TIMESTAMPS', `status=${attempt.status} started_at=${attempt.started_at} expires_at=${attempt.expires_at}; service.ts:333-334 asserts both non-null`);
  }
  if (attempt.status === 'in_progress' && attempt.expires_at && Date.parse(attempt.expires_at) <= Date.now()) {
    note('AUTO_SUBMIT_DUE', `expired ${new Date(attempt.expires_at).toISOString()}; opening calls submitExamAttemptForUser (service.ts:273)`);
  }

  const [exam, blueprint, subjectRows, questionRows, answerRows, revisionRows] = await Promise.all([
    db.from('exam_bodies').select('code, short_name').eq('id', attempt.exam_body_id).maybeSingle(),
    db.from('exam_blueprints').select('name').eq('id', attempt.blueprint_id).maybeSingle(),
    db.from('exam_attempt_subjects').select('*').eq('attempt_id', attemptId).order('display_order'),
    db.from('exam_attempt_questions').select('id, attempt_subject_id, subject_id, overall_position, student_snapshot').eq('attempt_id', attemptId).order('overall_position'),
    db.from('exam_attempt_answers').select('attempt_question_id, selected_option_key').eq('attempt_id', attemptId),
    db.from('response_revisions').select('question_id').eq('user_id', attempt.user_id).eq('kind', 'exam').eq('session_id', attemptId),
  ]);

  // --- service.ts:295-299 — the five parallel reads ---
  if (exam.error) note('DATABASE_ERROR', `exam_bodies — ${exam.error.code}: ${short(exam.error.message)} (service.ts:295)`);
  else if (!exam.data) note('EXAM_BODY_MISSING', `exam_body_id=${attempt.exam_body_id} has no row (service.ts:295 throws via .single())`);
  else if (!EXAM_CODES.has(exam.data.code)) note('UNSUPPORTED_EXAM_BODY', `code=${exam.data.code} is outside the allowlist (service.ts:33)`);

  if (blueprint.error) note('DATABASE_ERROR', `exam_blueprints — ${blueprint.error.code}: ${short(blueprint.error.message)} (service.ts:296)`);
  else if (!blueprint.data) note('BLUEPRINT_MISSING', `blueprint_id=${attempt.blueprint_id} has no row (service.ts:296 throws via .single())`);

  for (const [label, result, line] of [
    ['exam_attempt_subjects', subjectRows, '297'],
    ['exam_attempt_questions', questionRows, '298'],
    ['exam_attempt_answers', answerRows, '299'],
  ]) {
    if (result.error) note('DATABASE_ERROR', `${label} — ${result.error.code}: ${short(result.error.message)} (service.ts:${line})`);
  }

  // --- offline/server.ts:6 — getRevisions, awaited before the view is built ---
  if (revisionRows.error) {
    note('REVISIONS_UNREADABLE', `response_revisions — ${revisionRows.error.code}: ${short(revisionRows.error.message)} (offline/server.ts:6)`);
  }

  const subjects = subjectRows.data ?? [];
  const questions = questionRows.data ?? [];
  const answers = answerRows.data ?? [];

  // --- The half-built attempt Practice checks for and the exam route does not ---
  if (subjects.length === 0) note('SESSION_INCOMPLETE', 'attempt has no exam_attempt_subjects rows');
  if (questions.length === 0) note('SESSION_INCOMPLETE', 'attempt has no exam_attempt_questions rows');
  if (questions.length && questions.length !== attempt.total_questions) {
    note('QUESTION_COUNT_MISMATCH', `total_questions=${attempt.total_questions} but ${questions.length} question rows exist`);
  }

  // --- service.ts:309/339 — subject metadata, one lookup then one map hit ---
  const subjectIds = [...new Set(subjects.map((row) => row.subject_id))];
  if (subjectIds.length) {
    const meta = await db.from('subjects').select('id, slug, name').in('id', subjectIds);
    if (meta.error) {
      note('DATABASE_ERROR', `subjects — ${meta.error.code}: ${short(meta.error.message)} (service.ts:309)`);
    } else {
      const known = new Set((meta.data ?? []).map((row) => row.id));
      for (const row of subjects) {
        if (!known.has(row.subject_id)) {
          note('SUBJECT_METADATA_MISSING', `attempt_subject=${row.id} subject_id=${row.subject_id} has no subjects row (service.ts:339)`);
        }
      }
    }
  }

  // --- service.ts:58 — the app's own snapshot reader, not a copy of it ---
  const orphans = [];
  const subjectRowIds = new Set(subjects.map((row) => row.id));
  for (const row of questions) {
    if (!subjectRowIds.has(row.attempt_subject_id)) orphans.push(row.overall_position);
    const verdict = readStudentSnapshot(row.student_snapshot, `${attemptId}:${row.overall_position}`);
    if (!verdict.question) {
      note(verdict.failure ?? 'QUESTION_DESERIALIZATION_FAILED', `position=${row.overall_position} ${verdict.detail ?? 'no detail'} (service.ts:58)`);
    }
  }
  if (orphans.length) {
    note('QUESTION_ORPHANED', `positions ${orphans.slice(0, 10).join(', ')}${orphans.length > 10 ? '…' : ''} reference a missing attempt_subject row`);
  }

  // --- service.ts:39 — a stored answer outside the option keys ---
  for (const row of answers) {
    const key = row.selected_option_key;
    if (key !== null && !OPTION_KEYS.has(key)) {
      note('STORED_ANSWER_INVALID', `attempt_question=${row.attempt_question_id} selected_option_key=${JSON.stringify(key)} (service.ts:39)`);
    }
  }

  return { attemptId, userId: attempt.user_id, status: attempt.status, createdAt: attempt.created_at, examCode: exam.data?.code ?? '?', questionCount: questions.length, failures };
}

async function main() {
  let query = db
    .from('exam_attempts')
    .select('id, user_id, exam_body_id, blueprint_id, status, total_questions, started_at, expires_at, created_at')
    .order('created_at', { ascending: false })
    .limit(LIMIT);

  if (ONE_ATTEMPT) query = query.eq('id', ONE_ATTEMPT);
  if (ONE_USER) query = query.eq('user_id', ONE_USER);

  const { data, error } = await query;
  if (error) {
    console.error(`Could not list exam attempts — ${error.code}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const attempts = data ?? [];
  console.log(`exam-open probe — ${attempts.length} attempt(s), newest first, READ-ONLY\n`);

  const results = [];
  for (const attempt of attempts) results.push(await probeAttempt(attempt));

  const broken = results.filter((row) => row.failures.length);

  for (const row of broken) {
    console.log(`✗ ${row.attemptId}`);
    console.log(`   user=${mask(row.userId)} status=${row.status} exam=${row.examCode} questions=${row.questionCount} created=${row.createdAt}`);
    for (const { failure, detail } of row.failures) console.log(`   → ${failure}: ${detail}`);
    console.log('');
  }

  const byFailure = new Map();
  const studentsByFailure = new Map();
  for (const row of broken) {
    for (const { failure } of row.failures) {
      byFailure.set(failure, (byFailure.get(failure) ?? 0) + 1);
      if (!studentsByFailure.has(failure)) studentsByFailure.set(failure, new Set());
      studentsByFailure.get(failure).add(row.userId);
    }
  }

  console.log('─'.repeat(72));
  console.log(`${results.length - broken.length}/${results.length} attempts would open cleanly.`);
  if (byFailure.size) {
    console.log('\nfailure                      occurrences   students affected');
    for (const [failure, count] of [...byFailure].sort((a, b) => b[1] - a[1])) {
      console.log(`${failure.padEnd(28)} ${String(count).padStart(11)}   ${studentsByFailure.get(failure).size}`);
    }
    const repeat = [...new Map(broken.map((row) => [row.userId, 0])).keys()]
      .map((user) => ({ user, count: broken.filter((row) => row.userId === user).length }))
      .filter((row) => row.count > 1)
      .sort((a, b) => b.count - a.count);
    if (repeat.length) {
      console.log('\nStudents with more than one unopenable attempt:');
      for (const row of repeat) console.log(`  ${mask(row.user)}  ${row.count} attempts`);
    }
  }
}

await main();
