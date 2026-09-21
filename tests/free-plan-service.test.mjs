import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

/**
 * Free plan v2, at the service layer: the code between a route and the
 * database functions.
 *
 * The database decides every charge (tests/free-plan-quota-database.test.mjs).
 * What these tests pin down is that the application always asks the right
 * function with the right arguments and never charges on the paths that must be
 * free — which, since practice is counted in sessions at creation, is every
 * path except creating one.
 */

const stub = (source) => ({ url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true });

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@/lib/supabase/admin') {
      return stub('export function createAdminClient(){ return globalThis.__admin; }');
    }
    if (specifier === '@/features/billing/entitlements') {
      return stub(`export async function getEntitlement(){ return globalThis.__entitlement; }`);
    }
    if (specifier === '@/lib/rate-limit') {
      return stub(`export const RATE_LIMITS = { aiExplanation: {} };
        export async function consumeRateLimit(){ return { allowed: true, remaining: 1, retryAfterSeconds: 0 }; }`);
    }
    if (specifier === '@/features/ai/config') {
      return stub(`export const AI_PROMPT_VERSION='v1'; export const AI_PROVIDER='gemini'; export const AI_CACHE_TTL_SECONDS=172800;
        export function aiExplanationsEnabled(){ return true; } export function geminiModel(){ return 'test-model'; }`);
    }
    if (specifier === '@/features/ai/usage') return stub('export async function recordAiUsage(){}');
    if (specifier === '@/features/ai/prompts/question-explanation') {
      return stub('export function buildQuestionExplanationPrompt(){ return "prompt"; }');
    }
    if (specifier === '@/features/ai/providers/gemini') {
      return stub(`
        export class GeminiExplanationError extends Error { constructor(category){ super(category); this.category = category; } }
        export function parseGeminiExplanation(value){ return value; }
        export async function generateGeminiExplanation(){
          globalThis.__generations = (globalThis.__generations ?? 0) + 1;
          if (globalThis.__providerFails) throw new GeminiExplanationError('unavailable');
          return { model: 'test-model', inputTokens: 1, outputTokens: 1,
            explanation: { summary: 'Because A.', reasoning: 'Reasoning.', whyStudentAnswerIsWrong: 'B is not.', memoryTip: null } };
        }`);
    }
    return next(specifier, context);
  },
});

const FREE = { tier: 'free', isMaster: false, plan: null, expiresAt: null, limits: { practice: { sessionsPerDay: 1, maxQuestionsPerSession: 20 }, mockAttempts: 2, mockAttemptWindow: 'month', aiExplanationsPerDay: 2 } };
const MASTER = { tier: 'master', isMaster: true, plan: null, expiresAt: '2099-01-01T00:00:00Z', limits: { practice: { sessionsPerDay: 200, maxQuestionsPerSession: 40 }, mockAttempts: 3, mockAttemptWindow: 'day', aiExplanationsPerDay: 20 } };

/**
 * A scripted stand-in for the service-role client: table reads come from
 * `tables`, every RPC and write is recorded, and RPC answers come from `rpcs`.
 */
function fakeAdmin({ tables = {}, rpcs = {} } = {}) {
  const calls = [];
  const writes = [];
  const from = (name) => {
    let rows = [...(tables[name] ?? [])];
    const api = {
      select: () => api,
      eq: (column, value) => { rows = rows.filter((row) => row[column] === value); return api; },
      in: (column, values) => { rows = rows.filter((row) => values.includes(row[column])); return api; },
      order: (column) => { rows = [...rows].sort((a, b) => (a[column] > b[column] ? 1 : a[column] < b[column] ? -1 : 0)); return api; },
      limit: (n) => { rows = rows.slice(0, n); return api; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      single: async () => ({ data: rows[0] ?? null, error: rows.length ? null : { message: 'no rows' } }),
      upsert: async (value) => { writes.push({ table: name, value }); (tables[name] ??= []).push(value); return { error: null }; },
      then: (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
    };
    return api;
  };
  const rpc = async (name, args) => {
    calls.push({ name, args });
    const answer = rpcs[name];
    return typeof answer === 'function' ? answer(args) : (answer ?? { data: null, error: null });
  };
  return { from, rpc, calls, writes, tables };
}

// ─────────────────────────────────────────────────────────── MASTER AI

const USER = 'user-1';
const SESSION = 'session-1';
const QUESTION = 'q1';

function aiTables({ receipts = [] } = {}) {
  return {
    practice_sessions: [{ id: SESSION, user_id: USER, mode: 'practice', status: 'completed' }],
    practice_session_questions: [{
      id: QUESTION, session_id: SESSION, correct_option_key: 'A', explanation: 'Standard.',
      student_snapshot: { id: 'snap', prompt: 'Question', options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }], assets: [] },
    }],
    practice_answers: [{ session_id: SESSION, session_question_id: QUESTION, user_id: USER, selected_option_key: 'B', is_correct: false }],
    ai_explanation_receipts: receipts,
  };
}

function aiWorld({ claim = 'claimed', allowed = true, remaining = 1, receipts = [], entitlement = FREE, providerFails = false } = {}) {
  globalThis.__entitlement = entitlement;
  globalThis.__providerFails = providerFails;
  globalThis.__generations = 0;
  const admin = fakeAdmin({
    tables: aiTables({ receipts }),
    rpcs: {
      claim_ai_explanation: { data: [claim === 'completed'
        ? { outcome: 'completed', content: { summary: 'Cached.', reasoning: 'R.', whyStudentAnswerIsWrong: null, memoryTip: null } }
        : { outcome: claim, content: null }], error: null },
      consume_ai_daily_quota: { data: [{ allowed, remaining }], error: null },
      settle_ai_explanation: { data: null, error: null },
      release_ai_explanation_claim: { data: null, error: null },
      refund_ai_daily_quota: { data: 1, error: null },
    },
  });
  globalThis.__admin = admin;
  return admin;
}

const { explainQuestionForUser, AiExplanationError } = await import('../features/ai/service.ts');
const request = { targetKind: 'practice', sessionId: SESSION, questionId: QUESTION, explanationType: 'explain_better' };
const named = (admin, name) => admin.calls.filter((call) => call.name === name);

test('31. a cached explanation costs nothing — no allowance is consulted', async () => {
  const admin = aiWorld({ claim: 'completed' });
  const result = await explainQuestionForUser(USER, request);

  assert.equal(result.cached, true);
  assert.equal(named(admin, 'consume_ai_daily_quota').length, 0);
  assert.equal(globalThis.__generations, 0);
  assert.equal(admin.writes.filter((w) => w.table === 'ai_explanation_receipts').length, 1, 'the student now owns a receipt for it');
});

test('28. a new Free explanation spends one of two, and reports what is left', async () => {
  const admin = aiWorld({ remaining: 1 });
  const result = await explainQuestionForUser(USER, request);

  const [consume] = named(admin, 'consume_ai_daily_quota');
  assert.equal(consume.args.p_limit, 2, 'the Free allowance is two a day');
  assert.equal(result.cached, false);
  assert.equal(result.remainingToday, 1);
  assert.equal(admin.writes.filter((w) => w.table === 'ai_explanation_receipts').length, 1);
});

test('reopening an explanation already received is regenerated free, even at zero', async () => {
  // The receipt is keyed by the real cache key, so capture the one a first
  // generation records — then let the shared cache "expire" (a fresh claim).
  const probe = aiWorld({ remaining: 1 });
  await explainQuestionForUser(USER, request);
  const key = probe.writes.find((w) => w.table === 'ai_explanation_receipts').value.cache_key;

  const reopened = aiWorld({ allowed: false, remaining: 0, receipts: [{ user_id: USER, cache_key: key }] });
  const result = await explainQuestionForUser(USER, request);

  assert.equal(named(reopened, 'consume_ai_daily_quota').length, 0, 'never charged twice');
  assert.equal(globalThis.__generations, 1, 'the student gets the explanation back');
  assert.equal(result.remainingToday, null, 'nothing was spent, so no count is reported');
});

test('30. the third Free explanation is refused with the exact copy and an upgrade path', async () => {
  const admin = aiWorld({ allowed: false, remaining: 0 });
  await assert.rejects(explainQuestionForUser(USER, request), (error) => {
    assert.ok(error instanceof AiExplanationError);
    assert.equal(error.status, 402);
    assert.equal(error.code, 'PLAN_LIMIT');
    assert.equal(error.limit.message, 'You’ve used today’s 2 free MASTER AI explanations.');
    assert.equal(error.limit.upgradeMessage, 'Upgrade to Master for more explanations.');
    assert.equal(error.limit.upgradeHref, '/pricing?source=ai_exhausted#plans');
    return true;
  });
  assert.equal(globalThis.__generations, 0, 'the provider is never called');
  assert.equal(named(admin, 'release_ai_explanation_claim').length, 1, 'the claim is handed back');
});

test('33. a failed generation returns the explanation it reserved — and only when it reserved one', async () => {
  const charged = aiWorld({ providerFails: true });
  await assert.rejects(explainQuestionForUser(USER, request), /couldn’t generate/);
  assert.equal(named(charged, 'refund_ai_daily_quota').length, 1);

  const probe = aiWorld({ remaining: 1 });
  await explainQuestionForUser(USER, request);
  const key = probe.writes.find((w) => w.table === 'ai_explanation_receipts').value.cache_key;
  const reopened = aiWorld({ providerFails: true, receipts: [{ user_id: USER, cache_key: key }] });
  await assert.rejects(explainQuestionForUser(USER, request));
  assert.equal(named(reopened, 'refund_ai_daily_quota').length, 0, 'nothing was charged, so nothing is refunded');
});

test('32. a timed-out retry of a successful generation is served from the cache, not charged again', async () => {
  const first = aiWorld({ remaining: 1 });
  await explainQuestionForUser(USER, request);
  assert.equal(named(first, 'consume_ai_daily_quota').length, 1);

  const retry = aiWorld({ claim: 'completed' });
  await explainQuestionForUser(USER, request);
  assert.equal(named(retry, 'consume_ai_daily_quota').length, 0);
});

test('a retry while the first generation is still running is told to wait, and charged nothing', async () => {
  const admin = aiWorld({ claim: 'in_progress' });
  await assert.rejects(explainQuestionForUser(USER, request), (error) => error.code === 'GENERATION_IN_PROGRESS');
  assert.equal(named(admin, 'consume_ai_daily_quota').length, 0);
});

test('36. Master keeps twenty a day, and is never offered an upgrade', async () => {
  const admin = aiWorld({ entitlement: MASTER, allowed: false, remaining: 0 });
  await assert.rejects(explainQuestionForUser(USER, request), (error) => {
    assert.equal(error.limit.upgradeMessage, null);
    return true;
  });
  assert.equal(named(admin, 'consume_ai_daily_quota')[0].args.p_limit, 20);
});

// ──────────────────────────────────────────────── practice: the answer path

const practice = await import('../features/practice/service.ts');
const RECEIPT = {
  selected_option_key: 'A', is_correct: true, correct_option_key: 'A', explanation: 'x',
  answered_count: 1, question_count: 20, mode: 'practice', revision: 1, mutation_id: 'm1',
};

test('9/15. answering is never metered — the plan counted the session, not the answer', async () => {
  const admin = fakeAdmin({ rpcs: { save_response_v2: { data: RECEIPT, error: null } } });
  globalThis.__admin = admin;
  const result = await practice.savePracticeAnswerForUser(USER, SESSION, QUESTION, 'A', 0, 'm1');

  assert.equal(admin.calls[0].name, 'save_response_v2', 'the unchanged answer function, on every tier');
  assert.equal(admin.calls[0].args.p_kind, 'practice');
  assert.deepEqual(named(admin, 'save_metered_practice_response'), [], 'no ledger is consulted');
  assert.equal(result.allowance, undefined, 'an answer carries no allowance back');
  assert.equal(result.selectedOptionKey, 'A');
});

test('9b. a Free student answers through exactly the same function as Master', async () => {
  // There is no Free answer path any more, so there is nothing for a tier to
  // branch on: the signature has no meter to pass.
  assert.equal(practice.savePracticeAnswerForUser.length, 6, 'userId, session, question, option, revision, mutation');
});

test('2. creating a session does not consult a question ledger', async () => {
  assert.equal(practice.createPracticeSessionForUser.length, 2, 'userId and input — no meter argument');
  assert.equal(practice.loadPracticeSessionForUser.length, 2, 'userId and sessionId — opening is never gated');
});

// ─────────────────────────────────────── practice: what the browser receives

function sessionTables({ status = 'in_progress', mode = 'practice', count = 6, answered = [] } = {}) {
  return {
    practice_sessions: [{
      id: SESSION, user_id: USER, mode, status, subject_id: 'subject-1', topic_id: null, difficulty: null, year_filter: null,
      requested_count: count, question_count: count, answered_count: answered.length, correct_count: 0, source_provider: 'internal',
      started_at: '2026-09-21T10:00:00Z', expires_at: null, completed_at: status === 'completed' ? '2026-09-21T11:00:00Z' : null,
    }],
    subjects: [{ id: 'subject-1', slug: 'physics', name: 'Physics' }],
    topics: [],
    practice_session_questions: Array.from({ length: count }, (_, i) => ({
      id: 'q' + (i + 1), session_id: SESSION, position: i + 1, correct_option_key: 'A', explanation: 'Because A.',
      student_snapshot: {
        id: 'snap-' + (i + 1), examBody: 'jamb', subject: { id: 'subject-1', slug: 'physics', name: 'Physics' },
        prompt: 'Question ' + (i + 1), passage: { id: 'p', body: 'Passage' }, instruction: 'Instruction',
        options: [{ id: 'o1', key: 'A', text: 'Option' }], assets: [{ url: 'https://img.invalid/a.png' }],
        source: { provider: 'internal', providerQuestionId: 'provider-' + (i + 1) },
      },
    })),
    practice_answers: answered.map((id) => ({ session_id: SESSION, session_question_id: id, user_id: USER, selected_option_key: 'A', is_correct: true })),
    response_revisions: [],
  };
}

async function loadSession(options) {
  globalThis.__admin = fakeAdmin({ tables: sessionTables(options) });
  return practice.loadPracticeSessionForUser(USER, SESSION);
}

test('8/9/14. an in-progress session opens whole — nothing is withheld on resume', async () => {
  /*
   * The delivery gate is gone with the question meter. A session that exists was
   * paid for out of the day's allowance when it was created, so every question
   * in it is delivered whenever the student comes back to it.
   */
  const view = await loadSession({ count: 6, answered: ['q1'] });

  assert.equal(view.questions.length, 6);
  assert.ok(view.questions.every((q) => q.locked === undefined), 'no question is withheld');
  assert.ok(view.questions.every((q) => q.held === undefined), 'nothing is "held" any more');
  assert.ok(view.questions.every((q) => q.question.prompt.startsWith('Question')), 'every stem is delivered');
  assert.equal('practiceAllowance' in view, false, 'a session view carries no allowance');
});

test('14. a legacy session built under the old per-question plan still opens whole', async () => {
  // Its rows may still carry ledger history; the loader no longer reads any, so
  // a paper frozen under the old plan resumes intact rather than half-locked.
  const view = await loadSession({ count: 40, answered: ['q1', 'q2'] });
  assert.equal(view.questions.length, 40);
  assert.ok(view.questions.every((q) => !q.locked));
  assert.equal(view.questionCount, 40, 'the frozen paper keeps its size; nothing is rewritten');
});

test('a completed session is never gated — review is not a plan feature', async () => {
  const view = await loadSession({ status: 'completed', count: 5 });
  assert.ok(view.questions.every((q) => !q.locked));
});

// ──────────────────────────────────────────────────── the offline queue

const { DurableQueue, SyncFailure } = await import('../features/offline/queue.ts');

/**
 * Nothing refuses a practice answer with PLAN_LIMIT any more — the plan counts
 * sessions at creation. The queue keeps the defensive path regardless: a 402 a
 * retry cannot fix must drop, revert and stop, or the queue would spin for ever
 * and "Finish" would never be reachable.
 */
test('a PLAN_LIMIT refusal is final for that answer: dropped, reverted, and never retried', async () => {
  const record = {
    key: 'u:practice:s', userId: 'u', kind: 'practice', id: 's', version: 1, view: {},
    answers: { held: { selectedOptionKey: null, isFlagged: false, revision: 0 }, locked: { selectedOptionKey: null, isFlagged: false, revision: 3 } },
    pending: {}, cursor: { subject: 0, question: 0 }, serverTime: 0, wallTime: 0, final: false,
  };
  let sends = 0;
  const queue = new DurableQueue(record, async () => {}, async (id, pending) => {
    sends += 1;
    if (id === 'locked') throw new SyncFailure('You’ve used today’s free practice session.', 'PLAN_LIMIT');
    return { ...pending, revision: 1 };
  });

  await queue.select('locked', { selectedOptionKey: 'B', isFlagged: false });
  await queue.select('held', { selectedOptionKey: 'A', isFlagged: false });
  assert.equal(await queue.flush(), true, 'the queue drains — "Finish" is not blocked');

  assert.deepEqual(Object.keys(queue.record.pending), []);
  assert.equal(queue.record.answers.locked.selectedOptionKey, null, 'the refused answer is not shown as saved');
  assert.equal(queue.record.answers.locked.revision, 3, 'at its unchanged server revision');
  assert.equal(queue.record.answers.held.selectedOptionKey, 'A', 'other answers still sync');
  assert.equal(queue.limited, true);

  await queue.flush();
  assert.equal(sends, 2, 'nothing is retried');
});
