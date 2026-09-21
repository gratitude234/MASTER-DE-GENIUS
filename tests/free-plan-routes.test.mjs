import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { registerTsxHook } from '../scripts/tsx-hook.mjs';

registerAliasHook();
registerTsxHook();

/**
 * The three practice routes that are *not* session creation — the answer
 * endpoint, revision from results or the mistake bank, and the offline copy.
 *
 * Under the session-counted plan, two of these must cost nothing at all and one
 * of them (revision) must cost exactly the same day as Practice does, because
 * it genuinely creates a new session. Getting that split wrong in either
 * direction is the bug these tests exist to catch: charge for an answer and a
 * student cannot finish what they started; give revision a free pass and the
 * mistake bank becomes an unlimited second allowance.
 *
 * The real quota module runs here. Only the entitlement row, the service calls
 * and the database client are replaced.
 */

const stub = (source) => ({ url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true });
const NEXT_SERVER_URL = new URL('../node_modules/next/server.js', import.meta.url).href;

const FREE_LIMITS = { practice: { sessionsPerDay: 1, maxQuestionsPerSession: 20 }, mockAttempts: 2, mockAttemptWindow: 'month', aiExplanationsPerDay: 2 };
const MASTER_LIMITS = { practice: { sessionsPerDay: 200, maxQuestionsPerSession: 40 }, mockAttempts: 3, mockAttemptWindow: 'day', aiExplanationsPerDay: 20 };

const world = {
  reset(overrides = {}) {
    Object.assign(this, {
      tier: 'free',
      /** What `reserve_product_quota` answers. False = the day is already spent. */
      reserveAllowed: true,
      /** The session the student could resume, if any. */
      activePractice: null,
      revisionFails: false,
      calls: { rpc: [], revisions: [], loads: [], answers: [] },
    }, overrides);
  },
};
world.reset();
globalThis.__routes = world;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/server') return { url: NEXT_SERVER_URL, shortCircuit: true };
    if (specifier === '@/lib/supabase/admin') {
      return stub(`export function createAdminClient(){ return {
        rpc: async (name, args) => {
          const w = globalThis.__routes;
          w.calls.rpc.push({ name, args });
          if (name === 'reserve_product_quota') {
            return { data: [{ allowed: w.reserveAllowed, used: w.reserveAllowed ? 1 : args.p_limit,
              remaining: w.reserveAllowed ? args.p_limit - 1 : 0,
              reservation_id: w.reserveAllowed ? 'reservation-1' : null }], error: null };
          }
          return { data: true, error: null };
        },
        from: () => { throw new Error('unexpected table read'); },
      }; }`);
    }
    if (specifier === '@/features/billing/entitlements') {
      return stub(`export async function getEntitlement(){
        const w = globalThis.__routes;
        return { tier: w.tier, isMaster: w.tier === 'master', plan: null, expiresAt: null,
          limits: w.tier === 'master' ? ${JSON.stringify(MASTER_LIMITS)} : ${JSON.stringify(FREE_LIMITS)} };
      }`);
    }
    if (specifier === '@/features/practice/active-session') {
      return stub(`export async function getActivePracticeSessionForUser(){ return globalThis.__routes.activePractice; }`);
    }
    if (specifier === '@/features/practice/api') {
      return stub(`import { NextResponse } from 'next/server';
        export async function requireApiUser(){ return { id: 'user-1' }; }
        export function practiceErrorResponse(error){ return NextResponse.json({ error: String(error?.message ?? error) }, { status: 400 }); }`);
    }
    if (specifier === '@/features/exams/api') {
      return stub(`import { NextResponse } from 'next/server';
        export async function requireExamApiUser(){ return { id: 'user-1' }; }
        export function examErrorResponse(error){ return NextResponse.json({ error: String(error) }, { status: 503 }); }`);
    }
    if (specifier === '@/features/practice/service') {
      return stub(`export async function savePracticeAnswerForUser(u, s, q, key, rev, mutation){
          globalThis.__routes.calls.answers.push({ q, key, rev, mutation, args: arguments.length });
          return { revision: rev + 1, mutationId: mutation, selectedOptionKey: key, answeredCount: 1, questionCount: 20 };
        }
        export async function loadPracticeSessionForUser(){
          globalThis.__routes.calls.loads.push(arguments.length);
          return { id: 's1', questions: [] };
        }`);
    }
    if (specifier === '@/features/exams/service') return stub('export async function loadExamAttemptForUser(){ return { id: "a" }; }');
    if (specifier === '@/features/results/service') {
      return stub(`export async function startRevision(u, input, maxQuestions){
          const w = globalThis.__routes;
          w.calls.revisions.push({ input, maxQuestions });
          if (w.revisionFails) throw new Error('No active mistakes match this subject and topic.');
          return 'revision-session';
        }`);
    }
    if (specifier === '@/lib/rate-limit') {
      return stub(`export const RATE_LIMITS = { revisionCreate: {} }; export async function enforceRateLimit(){ return null; }`);
    }
    return next(specifier, context);
  },
});

const { PUT: saveAnswer } = await import('../app/api/practice/sessions/[sessionId]/answers/route.ts');
const { POST: startRevision } = await import('../app/api/progress/practice/route.ts');
const { GET: offlineSession } = await import('../app/api/offline/session/[kind]/[id]/route.ts');

const answerRequest = () => new Request('https://app.invalid/api/practice/sessions/s1/answers', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sessionQuestionId: 'q1', selectedOptionKey: 'A', expectedRevision: 0,
    mutationId: '33333333-3333-4333-8333-333333333333',
  }),
});
const params = { params: Promise.resolve({ sessionId: 's1' }) };
const revisionRequest = () => new Request('https://app.invalid/api/progress/practice', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ subjectSlug: 'physics', mistakes: true }),
});
const offlineRequest = () => offlineSession(new Request('https://app.invalid'), {
  params: Promise.resolve({ kind: 'practice', id: 's1' }),
});

// ─────────────────────────────────────────────────────────── answering

test('9. answering costs nothing — no reservation is taken, on either tier', async () => {
  for (const tier of ['free', 'master']) {
    world.reset({ tier });
    const response = await saveAnswer(answerRequest(), params);

    assert.equal(response.status, 200, tier + ' must be able to answer');
    assert.deepEqual(
      world.calls.rpc.filter((call) => call.name === 'reserve_product_quota'),
      [],
      tier + ': an answer reserves nothing',
    );
    assert.equal(world.calls.answers[0].args, 6, 'no meter is passed down');
  }
});

test('9b. a Free student who has used the day can still answer the session they are in', async () => {
  // The allowance is not even consulted on this path, which is the point: a
  // session in progress is unaffected by the day being spent.
  world.reset({ reserveAllowed: false });
  assert.equal((await saveAnswer(answerRequest(), params)).status, 200);
});

// ────────────────────────────────────────────────────────── revision

test('revision creates a real session, so it takes the same day Practice does', async () => {
  world.reset();
  const response = await startRevision(revisionRequest());

  assert.equal(response.status, 201);
  const rpcNames = world.calls.rpc.map((call) => call.name);
  assert.ok(rpcNames.includes('reserve_product_quota'), 'the day is reserved');
  assert.ok(rpcNames.includes('commit_product_quota'), 'and spent, because a session now exists');
  const reserve = world.calls.rpc.find((call) => call.name === 'reserve_product_quota');
  assert.equal(reserve.args.p_capability, 'practice_session', 'the same capability as Practice — one allowance');
  assert.equal(reserve.args.p_limit, 1);
  assert.equal(world.calls.revisions[0].maxQuestions, 20, 'sized by the plan, not by the request');
});

test('51. revision is refused once the day is spent — the mistake bank is not a second allowance', async () => {
  world.reset({ reserveAllowed: false });
  const response = await startRevision(revisionRequest());
  const body = await response.json();

  assert.equal(response.status, 402);
  assert.equal(body.limit.capability, 'practice_session');
  assert.equal(body.limit.upgradeHref, '/pricing?source=practice_exhausted#plans');
  assert.deepEqual(world.calls.revisions, [], 'no revision session is built');
});

test('revision names the session to resume when one is open', async () => {
  world.reset({
    reserveAllowed: false,
    activePractice: { id: 'session-7', subjectName: 'Physics', answeredCount: 0, questionCount: 20 },
  });
  const body = await (await startRevision(revisionRequest())).json();

  assert.equal(body.limit.message, 'Today’s practice session is already in progress.');
  assert.equal(body.limit.resumeSessionId, 'session-7');
});

test('10. a revision that builds nothing hands the day straight back', async () => {
  world.reset({ revisionFails: true });
  const response = await startRevision(revisionRequest());

  assert.equal(response.status, 400);
  assert.ok(
    world.calls.rpc.some((call) => call.name === 'release_product_quota'),
    'a revision with no matching mistakes must not cost a day',
  );
  assert.ok(!world.calls.rpc.some((call) => call.name === 'commit_product_quota'));
});

test('13/24. Master revision is sized by Master limits and is not stopped at one a day', async () => {
  world.reset({ tier: 'master' });
  assert.equal((await startRevision(revisionRequest())).status, 201);
  const reserve = world.calls.rpc.find((call) => call.name === 'reserve_product_quota');
  assert.equal(reserve.args.p_limit, 200, 'Master keeps its own allowance');
  assert.equal(world.calls.revisions[0].maxQuestions, 40);
});

// ─────────────────────────────────────────────────────── offline copy

test('60. the offline copy is never gated — a saved session stays complete', async () => {
  for (const tier of ['free', 'master']) {
    world.reset({ tier, reserveAllowed: false });
    const response = await offlineRequest();

    assert.equal(response.status, 200, tier + ': a saved session still loads');
    assert.equal(world.calls.loads[0], 2, 'userId and id only — no meter, nothing withheld');
    assert.deepEqual(
      world.calls.rpc.filter((call) => call.name === 'reserve_product_quota'),
      [],
      tier + ': reading a saved session reserves nothing',
    );
  }
});
