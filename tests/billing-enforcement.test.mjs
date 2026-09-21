import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { registerTsxHook } from '../scripts/tsx-hook.mjs';

registerAliasHook();
registerTsxHook();

/**
 * Where the plan actually stops a student: the two creation routes and the AI
 * explanation service.
 *
 * These run the real route handlers with the database, the provider and the
 * session engine replaced. That is the point — the thing under test is the
 * *ordering*: that the allowance is reserved before the provider is contacted,
 * committed only when something was created, and handed back when it was not.
 * A test that only checked the SQL could not observe any of that.
 */

const stub = (source) => ({ url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true });

const NEXT_SERVER_URL = new URL('../node_modules/next/server.js', import.meta.url).href;

const FREE_LIMITS = { practice: { sessionsPerDay: 1, maxQuestionsPerSession: 20 }, mockAttempts: 2, mockAttemptWindow: 'month', aiExplanationsPerDay: 2 };
const MASTER_LIMITS = { practice: { sessionsPerDay: 200, maxQuestionsPerSession: 40 }, mockAttempts: 3, mockAttemptWindow: 'day', aiExplanationsPerDay: 20 };

/** Everything the routes reach for, recorded rather than performed. */
const world = {
  reset(overrides = {}) {
    Object.assign(this, {
      tier: 'free',
      limits: FREE_LIMITS,
      reserveAllowed: true,
      rateLimited: false,
      claimOutcome: { status: 'claimed' },
      unauthenticated: false,
      providerFails: false,
      mockResumed: false,
      /*
       * The practice session the student has open, account-wide. Null means
       * there is nothing to resume — which is what turns "already in progress"
       * into "today's session has been used".
       */
      activePractice: null,
      activeAttempt: null,
      calls: { reserved: [], committed: [], released: [], created: [], createdInputs: [] },
    }, overrides);
  },
};
world.reset();
globalThis.__world = world;

registerHooks({
  resolve(specifier, context, next) {
    /*
     * The routes import "next/server" the way the bundler resolves it. Node
     * needs the extension, and the stubs below are data: URLs, which cannot
     * resolve a bare specifier at all — so this is pinned to an absolute file
     * URL. The real NextResponse is used rather than a stand-in, so the status
     * codes and JSON bodies these tests assert on are the genuine article.
     */
    if (specifier === '@/lib/supabase/admin') return stub('export function createAdminClient(){ return {}; }');
    if (specifier === '@/features/exam-context/service') return stub('export async function resolveActiveExamContext(db, user, code){ return { exam: { code: code ?? "jamb" }, exam_body_id: "jamb-id" }; }');
    if (specifier === 'next/server') {
      return { url: NEXT_SERVER_URL, shortCircuit: true };
    }

    if (specifier === '@/features/billing/entitlements') {
      return stub(`
        export async function getEntitlement() {
          const world = globalThis.__world;
          return { tier: world.tier, isMaster: world.tier === 'master', plan: null, expiresAt: null, limits: world.limits };
        }
      `);
    }

    if (specifier === '@/features/billing/quota') {
      return stub(`
        const w = () => globalThis.__world;
        export function quotaWindow(kind, now = new Date()) {
          return { key: 'window', kind, resetAt: new Date(Date.now() + 3600_000) };
        }
        export function capabilityLimit(capability, limits) {
          return capability === 'practice_session'
            ? { limit: limits.practice.sessionsPerDay, windowKind: 'day' }
            : { limit: limits.mockAttempts, windowKind: limits.mockAttemptWindow };
        }
        export async function reserveCapability(userId, capability) {
          const world = w();
          const { limit, windowKind } = capabilityLimit(capability, world.limits);
          world.calls.reserved.push(capability);
          return {
            allowed: world.reserveAllowed,
            reservationId: world.reserveAllowed ? 'reservation-1' : null,
            limit, used: limit, remaining: 0,
            tier: world.tier,
            window: { key: 'window', kind: windowKind, resetAt: new Date(Date.now() + 3600_000) },
          };
        }
        export async function commitCapability(id) { if (id) w().calls.committed.push(id); }
        export async function releaseCapability(id) { if (id) w().calls.released.push(id); }
      `);
    }

    if (specifier === '@/lib/rate-limit') {
      return stub(`
        import { NextResponse } from 'next/server';
        export const RATE_LIMITS = {
          practiceCreate: {}, mockCreate: {}, revisionCreate: {},
          aiExplanation: {}, billingCheckout: {}, billingVerify: {},
        };
        export async function enforceRateLimit() {
          return globalThis.__world.rateLimited
            ? NextResponse.json({ error: 'slow down', code: 'RATE_LIMITED' }, { status: 429 })
            : null;
        }
        export async function consumeRateLimit() {
          return { allowed: !globalThis.__world.rateLimited, remaining: 1, retryAfterSeconds: 0 };
        }
      `);
    }

    if (specifier === '@/lib/creation-claim') {
      return stub(`
        export function creationFingerprint() { return 'fingerprint'; }
        export async function claimCreation() { return globalThis.__world.claimOutcome; }
        export async function settleCreation() {}
      `);
    }

    if (specifier === '@/features/practice/api') {
      return stub(`
        import { NextResponse } from 'next/server';
        export async function requireApiUser() { return globalThis.__world.unauthenticated ? null : { id: 'user-1' }; }
        export function practiceErrorResponse(error) {
          return NextResponse.json({ error: String(error?.message ?? error) }, { status: 503 });
        }
      `);
    }

    if (specifier === '@/features/exams/api') {
      return stub(`
        import { NextResponse } from 'next/server';
        export async function requireExamApiUser() { return globalThis.__world.unauthenticated ? null : { id: 'user-1' }; }
        export function examErrorResponse(error) {
          return NextResponse.json({ error: String(error?.message ?? error) }, { status: 503 });
        }
      `);
    }

    if (specifier === '@/features/practice/service') {
      return stub(`
        export async function createPracticeSessionForUser(userId, input) {
          const world = globalThis.__world;
          if (world.providerFails) throw new Error('The question provider is unavailable.');
          world.calls.created.push('practice');
          world.calls.createdInputs.push(input);
          return { sessionId: 'session-1', questionCount: input.count, requestedCount: input.count };
        }
      `);
    }

    if (specifier === '@/features/exams/service') {
      return stub(`
        export async function createMockExamAttemptForUser() {
          const world = globalThis.__world;
          if (world.providerFails) throw new Error('MOCK_INVENTORY_SHORTAGE|Physics|60|10');
          world.calls.created.push('mock');
          return { attemptId: 'attempt-1', resumed: world.mockResumed, totalQuestions: 180 };
        }
        export async function getActiveExamAttemptSummaryForUser() {
          return globalThis.__world.activeAttempt;
        }
      `);
    }

    if (specifier === '@/features/practice/active-session') {
      return stub(`
        export async function getActivePracticeSessionForUser() {
          return globalThis.__world.activePractice;
        }
      `);
    }

    if (specifier === '@/features/practice/validation') {
      return stub(`
        export function parseCreatePracticeSessionInput(value) {
          const count = value?.count ?? 10;
          if (!Number.isInteger(count) || count < 1 || count > 40) {
            throw new Error('Practice sessions can contain between 1 and 40 questions.');
          }
          return {
            subjectSlug: value?.subjectSlug ?? 'mathematics',
            topicSlug: null, count,
            mode: 'practice', difficulty: null, year: null,
          };
        }
      `);
    }

    return next(specifier, context);
  },
});

const { POST: createPractice } = await import('../app/api/practice/sessions/route.ts');
const { POST: createMock } = await import('../app/api/exam/attempts/route.ts');

const practiceRequest = (body = {}) => new Request('https://app.invalid/api/practice/sessions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ subjectSlug: 'mathematics', count: 10, ...body }),
});

// ───────────────────────────────────────────────── practice session quota

// Master keeps the session-counted allowance, on exactly the mechanism it had.
const MASTER = { tier: 'master', limits: MASTER_LIMITS };

test('a Master student within their allowance starts a session and spends one slot', async () => {
  world.reset(MASTER);
  const response = await createPractice(practiceRequest());

  assert.equal(response.status, 201);
  assert.deepEqual(world.calls.reserved, ['practice_session']);
  assert.deepEqual(world.calls.committed, ['reservation-1'], 'the allowance is spent only once a session exists');
  assert.deepEqual(world.calls.released, []);
  assert.equal(world.calls.createdInputs[0].count, 10, 'Master is given exactly what it asked for');
});

test('a Master student gets the larger practice allowance from the same mechanism', async () => {
  world.reset({ ...MASTER, reserveAllowed: false });
  const body = await (await createPractice(practiceRequest())).json();

  assert.equal(body.limit.limit, 200, 'Master is stopped at 200 sessions, exactly as before');
  assert.equal(body.limit.tier, 'master');
  assert.equal(body.limit.upgradeMessage, null, 'there is nothing further to sell');
});

test('a provider failure gives the practice allowance straight back', async () => {
  world.reset({ ...MASTER, providerFails: true });
  const response = await createPractice(practiceRequest());

  assert.equal(response.status, 503);
  assert.deepEqual(world.calls.released, ['reservation-1'], 'a failed upstream call must not cost a slot');
  assert.deepEqual(world.calls.committed, [], 'nothing was created, so nothing is spent');
});

test('a suppressed duplicate submit returns the first session without spending twice', async () => {
  world.reset({ ...MASTER, claimOutcome: { status: 'duplicate', sessionId: 'session-1' } });
  const response = await createPractice(practiceRequest());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.deduplicated, true);
  assert.deepEqual(world.calls.released, ['reservation-1'], 'the second tap created nothing and pays nothing');
  assert.deepEqual(world.calls.committed, []);
});

// ──────────────────────────── Free: one new practice session a day, up to 20

/**
 * The Free plan allows **one new practice session a day**, account-wide, of up
 * to 20 questions. These assert the server, not the screen: what the route
 * reserves, when it commits, what it hands back, and what it refuses.
 */

test('1-3. a Free student starts the day able to build one 20-question session', async () => {
  world.reset();
  const response = await createPractice(practiceRequest({ count: 20 }));
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(world.calls.reserved, ['practice_session'], 'the day is reserved before any question is fetched');
  assert.deepEqual(world.calls.committed, ['reservation-1'], 'and spent only once a session exists');
  assert.equal(world.calls.createdInputs[0].count, 20, 'a Free session may be the full 20');
  assert.equal(body.questionCount, 20);
});

test('4. a Free request for more than 20 builds 20 — the server clamps, it does not trust', async () => {
  world.reset();
  await createPractice(practiceRequest({ count: 40 }));
  assert.equal(world.calls.createdInputs[0].count, 20, 'a crafted 40 yields the 20 the plan allows');
});

test('4b. Master is not clamped to the Free ceiling', async () => {
  world.reset(MASTER);
  await createPractice(practiceRequest({ count: 40 }));
  assert.equal(world.calls.createdInputs[0].count, 40, 'Master keeps the 40 it has always had');
});

test('5. a second new session the same day is refused, with the exact copy', async () => {
  world.reset({ reserveAllowed: false });
  const response = await createPractice(practiceRequest());
  const body = await response.json();

  assert.equal(response.status, 402, 'a plan boundary is 402, distinct from a 429 "slow down"');
  assert.equal(body.code, 'PLAN_LIMIT');
  assert.equal(body.limit.capability, 'practice_session');
  assert.equal(body.limit.tier, 'free');
  assert.equal(body.limit.limit, 1);
  assert.equal(body.limit.message, 'You’ve used today’s free practice session.');
  assert.equal(body.limit.upgradeMessage, 'Upgrade to Master to start more practice sessions today.');
  assert.equal(body.limit.upgradeHref, '/pricing?source=practice_exhausted#plans');
  assert.ok(!/quota|limit exceeded/i.test(body.error), 'the student never sees internal wording');
  assert.deepEqual(world.calls.created, [], 'nothing is built and no provider is contacted');
});

test('6-7. a different subject, and a different exam body, share the one allowance', async () => {
  // The route reserves before it ever looks at the subject, so a second subject
  // reaches exactly the same refusal. Same for JAMB and WAEC: one account, one day.
  for (const body of [{ subjectSlug: 'biology' }, { subjectSlug: 'biology', examBody: 'waec' }]) {
    world.reset({ reserveAllowed: false });
    const response = await createPractice(practiceRequest(body));
    assert.equal(response.status, 402, JSON.stringify(body) + ' must not get an allowance of its own');
    assert.deepEqual(world.calls.created, []);
  }
});

test('8. a session already in progress is a redirect, not a dead end', async () => {
  world.reset({
    reserveAllowed: false,
    activePractice: { id: 'session-9', subjectName: 'Biology', answeredCount: 3, questionCount: 20 },
  });
  const response = await createPractice(practiceRequest());
  const body = await response.json();

  assert.equal(response.status, 402);
  assert.equal(body.limit.message, 'Today’s practice session is already in progress.');
  assert.equal(body.limit.resumeSessionId, 'session-9', 'the browser can offer Resume without a second request');
  assert.equal(body.limit.upgradeSource, 'practice_session_in_progress');
  assert.equal(body.limit.upgradeHref, '/pricing?source=practice_session_in_progress#plans');
  assert.equal(body.activeSession.id, 'session-9');
  assert.ok(!/used today|have been used/i.test(body.limit.message), 'nothing has been lost, so nothing says it has');
});

test('10. a failed creation hands the day straight back', async () => {
  world.reset({ providerFails: true });
  const response = await createPractice(practiceRequest());

  assert.equal(response.status, 503);
  assert.deepEqual(world.calls.released, ['reservation-1'], 'a provider outage must not cost a day');
  assert.deepEqual(world.calls.committed, [], 'nothing was created, so nothing is spent');
});

test('11. two tabs racing for the day: exactly one session, exactly one refusal', async () => {
  /*
   * The lock itself lives in reserve_product_quota, which takes the student's
   * window row before it counts — proven against real SQL in
   * tests/free-plan-quota-database.test.mjs. What is asserted here is that the
   * route has no path around it: the loser never reaches the provider and never
   * creates anything.
   */
  world.reset();
  const responses = [];
  for (const attempt of [0, 1]) {
    world.reserveAllowed = attempt === 0;
    responses.push(await createPractice(practiceRequest()));
  }

  assert.deepEqual(responses.map((response) => response.status), [201, 402]);
  assert.deepEqual(world.calls.created, ['practice'], 'exactly one session is built');
  assert.deepEqual(world.calls.committed, ['reservation-1'], 'exactly one day is spent');
});

test('a Free duplicate submit returns the first session and builds nothing more', async () => {
  world.reset({ claimOutcome: { status: 'duplicate', sessionId: 'session-1' } });
  const response = await createPractice(practiceRequest());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).deduplicated, true);
  assert.deepEqual(world.calls.created, []);
});

test('a request rejected by the abuse limiter never touches the plan allowance', async () => {
  world.reset({ rateLimited: true });
  const response = await createPractice(practiceRequest());

  assert.equal(response.status, 429);
  assert.deepEqual(world.calls.reserved, [], 'the provider limiter runs first and costs no product quota');
});

test('an unauthenticated request is rejected before anything is reserved', async () => {
  world.reset({ unauthenticated: true });
  const response = await createPractice(practiceRequest());

  assert.equal(response.status, 401);
  assert.deepEqual(world.calls.reserved, []);
  world.reset();
});

// ────────────────────────────────────────────────────── mock attempt quota

test('a Free student gets two full mocks a month, then the exact monthly upgrade prompt', async () => {
  world.reset();
  assert.equal((await createMock()).status, 201);
  assert.deepEqual(world.calls.committed, ['reservation-1']);

  world.reset({ reserveAllowed: false });
  const body = await (await createMock()).json();

  assert.equal(body.code, 'PLAN_LIMIT');
  assert.equal(body.limit.limit, 2);
  assert.equal(body.limit.capability, 'mock_attempt');
  assert.equal(body.limit.message, 'You’ve used your 2 free mocks for this month.');
  assert.equal(body.limit.upgradeMessage, 'Upgrade to Master to continue taking mock exams now.');
  assert.equal(body.limit.upgradeHref, '/pricing?source=mock_exhausted#plans');
  assert.deepEqual(world.calls.created, [], 'a third free mock is never built');
});

test('a Free student with no mocks left can still resume the paper they started', async () => {
  world.reset({
    reserveAllowed: false,
    activeAttempt: { id: 'attempt-live', totalQuestions: 180 },
  });
  const response = await createMock();
  const body = await response.json();

  assert.equal(response.status, 200, 'a resume is never a new attempt, so it is never refused');
  assert.equal(body.attemptId, 'attempt-live');
  assert.equal(body.resumed, true);
  assert.deepEqual(world.calls.created, [], 'nothing is built');
  assert.deepEqual(world.calls.committed, [], 'and nothing is spent');
});

test('a Master student gets three full mocks a day', async () => {
  world.reset({
    tier: 'master',
    limits: MASTER_LIMITS,
    reserveAllowed: false,
  });
  const body = await (await createMock()).json();

  assert.equal(body.limit.limit, 3);
  assert.match(body.error, /3 full mocks today/);
  assert.equal(body.limit.upgradeMessage, null);
});

test('resuming a paper in progress does not spend the monthly mock again', async () => {
  world.reset({ mockResumed: true });
  const response = await createMock();

  assert.equal(response.status, 200);
  assert.deepEqual(world.calls.released, ['reservation-1'], 'a resume is not a new attempt');
  assert.deepEqual(world.calls.committed, []);
});

test('a mock that cannot be built returns the allowance', async () => {
  world.reset({ providerFails: true });
  const response = await createMock();

  assert.equal(response.status, 503);
  assert.deepEqual(world.calls.released, ['reservation-1']);
  assert.deepEqual(world.calls.committed, []);
});

// ────────────────────────────────────────── AI generation is plan-resolved

test('the AI service resolves its daily limit from the entitlement, not the environment', () => {
  const source = readFileSync('features/ai/service.ts', 'utf8');

  assert.ok(source.includes('await getEntitlement(userId)'), 'the tier is resolved server-side');
  assert.ok(source.includes('entitlement.limits.aiExplanationsPerDay'), 'the limit is the plan limit');
  assert.ok(!source.includes('aiDailyLimit'), 'the environment override is gone');

  const config = readFileSync('features/ai/config.ts', 'utf8');
  assert.ok(!config.includes('AI_EXPLANATIONS_DAILY_LIMIT'),
    'a second source of truth in the environment could contradict the pricing page');
});

test('a cache hit still returns before the allowance is consulted', () => {
  const source = readFileSync('features/ai/service.ts', 'utf8');
  const cacheReturn = source.indexOf("return { explanation, cached: true, remainingToday: null };");
  const quotaConsume = source.indexOf('consume_ai_daily_quota');

  assert.ok(cacheReturn > 0 && quotaConsume > cacheReturn,
    'a reused explanation must cost nothing, exactly as it did before plans existed');
  assert.ok(source.includes('cacheHit: true'), 'the cache hit is still recorded as a cache hit');
});

test('the AI limit refusal carries the recommended upgrade copy', () => {
  const source = readFileSync('features/ai/service.ts', 'utf8');
  assert.ok(source.includes("capability: \"ai_explanation\""));
  assert.ok(source.includes('tier: entitlement.tier'), 'the message is written for the student\'s actual plan');
  assert.ok(source.includes('402'), 'a plan boundary, not a generic 429');

  const route = readFileSync('app/api/ai/question-explanation/route.ts', 'utf8');
  assert.ok(route.includes('error.limit'), 'the structured notice reaches the browser');
});

// ─────────────────────────────────── the answer-security boundary is untouched

test('paid access never weakens the timed or mock answer protection', () => {
  const policy = readFileSync('features/ai/policy.ts', 'utf8');
  // Entitlements have no say in exam security, and must never gain one.
  assert.ok(!policy.includes('tier'), 'the AI access policy is not plan-aware');
  assert.ok(!policy.includes('billing'));
  assert.ok(!policy.includes('master'));
  assert.ok(policy.includes('ACTIVE_TIMED_SESSION'));
  assert.ok(policy.includes('ACTIVE_EXAM'));

  for (const file of ['features/questions/delivery.ts', 'features/results/grading.ts']) {
    const source = readFileSync(file, 'utf8');
    assert.ok(!source.includes('billing'), `${file} must not become plan-aware`);
    assert.ok(!source.includes('entitlement'), `${file} must not become plan-aware`);
  }
});

test('scoring, review and the mistake bank are never gated behind a plan', () => {
  for (const file of [
    'features/results/service.ts',
    'features/results/grading.ts',
    'features/practice/service.ts',
    'features/exams/service.ts',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.ok(!/isMaster|denyIfNotMaster|MASTER_REQUIRED/.test(source),
      `${file} must not withhold a student's own results behind a plan`);
  }
});

test('the product quota is not confused with the provider abuse limiter', () => {
  const full = readFileSync('app/api/practice/sessions/route.ts', 'utf8');
  // Imports are alphabetical; only the order inside the handler is meaningful.
  const practice = full.slice(full.indexOf('export async function POST'));
  const rateIndex = practice.indexOf('enforceRateLimit');
  const reserveIndex = practice.indexOf('reserveCapability');

  assert.ok(rateIndex > 0 && reserveIndex > rateIndex,
    'the abuse limiter runs first, so a refused request costs no plan allowance');
  assert.ok(practice.includes('releaseCapability'), 'the allowance can be handed back');
  assert.ok(practice.includes('commitCapability'), 'and is only spent on success');
});
