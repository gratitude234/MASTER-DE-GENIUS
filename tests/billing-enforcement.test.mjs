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

const FREE_LIMITS = { practice: { unit: 'question', perDay: 4 }, mockAttempts: 2, mockAttemptWindow: 'month', aiExplanationsPerDay: 2 };
const MASTER_LIMITS = { practice: { unit: 'session', perDay: 200 }, mockAttempts: 3, mockAttemptWindow: 'day', aiExplanationsPerDay: 20 };

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
      // The free practice ledger, as `practice_question_allowance` would report it.
      allowance: { limit: 4, used: 0, waiting: 0, remaining: 4, available: 4 },
      allowanceUnreadable: false,
      // Set when the metered create loses a race under the ledger lock.
      meteredCreateRefused: false,
      activeAttempt: null,
      calls: { reserved: [], committed: [], released: [], created: [], createdInputs: [], meters: [] },
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
            ? { limit: limits.practice.perDay, windowKind: 'day' }
            : { limit: limits.mockAttempts, windowKind: limits.mockAttemptWindow };
        }
        export function practiceMeterFor(entitlement) {
          if (entitlement.limits.practice.unit !== 'question') return null;
          return { dayKey: '2026-09-21', limit: entitlement.limits.practice.perDay, resetAt: new Date(Date.now() + 3600_000), tier: entitlement.tier };
        }
        export async function readPracticeAllowance() {
          const world = w();
          return world.allowanceUnreadable ? null : { ...world.allowance };
        }
        export class PracticeAllowanceExhausted extends Error {
          constructor(meter) { super('FREE_PRACTICE_LIMIT'); this.meter = meter; }
        }
        export function isPracticeLimitError(error) { return String(error?.message ?? error).includes('FREE_PRACTICE_LIMIT'); }
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
        import { PracticeAllowanceExhausted } from '@/features/billing/quota';
        export async function createPracticeSessionForUser(userId, input, meter = null) {
          const world = globalThis.__world;
          if (world.providerFails) throw new Error('The question provider is unavailable.');
          if (meter && world.meteredCreateRefused) throw new PracticeAllowanceExhausted(meter);
          world.calls.created.push('practice');
          world.calls.createdInputs.push(input);
          world.calls.meters.push(meter);
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

    if (specifier === '@/features/practice/validation') {
      return stub(`
        export function parseCreatePracticeSessionInput(value) {
          return {
            subjectSlug: value?.subjectSlug ?? 'mathematics',
            topicSlug: null, count: value?.count ?? 10,
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

const practiceRequest = () => new Request('https://app.invalid/api/practice/sessions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ subjectSlug: 'mathematics', count: 10 }),
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
  assert.deepEqual(world.calls.meters, [null], 'Master answers and sessions are never question-metered');
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

// ───────────────────────────────────── Free: practice counted in questions

test('a new Free student starts a session sized to their allowance, through the metered path', async () => {
  world.reset();
  const response = await createPractice(practiceRequest());
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.deepEqual(world.calls.reserved, [], 'Free no longer spends a session slot');
  assert.equal(world.calls.createdInputs[0].count, 4, 'asked for 10, built no more than the 4 left');
  assert.equal(body.questionCount, 4);
  assert.equal(world.calls.meters[0].limit, 4);
  assert.equal(world.calls.meters[0].tier, 'free');
});

test('a Free session is never larger than what is left — 2 left means at most 2', async () => {
  world.reset({ allowance: { limit: 4, used: 2, waiting: 0, remaining: 2, available: 2 } });
  await createPractice(practiceRequest());
  assert.equal(world.calls.createdInputs[0].count, 2);
});

test('a manipulated count is clamped, never trusted', async () => {
  world.reset({ allowance: { limit: 4, used: 3, waiting: 0, remaining: 1, available: 1 } });
  const request = new Request('https://app.invalid/api/practice/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subjectSlug: 'mathematics', count: 40 }),
  });
  await createPractice(request);
  assert.equal(world.calls.createdInputs[0].count, 1, 'a 40-question request yields one question');
});

test('a Free student with nothing left is refused before any question is fetched', async () => {
  world.reset({ allowance: { limit: 4, used: 4, waiting: 0, remaining: 0, available: 0 } });
  const response = await createPractice(practiceRequest());
  const body = await response.json();

  assert.equal(response.status, 402, 'a plan boundary is 402, distinct from a 429 "slow down"');
  assert.equal(body.code, 'PLAN_LIMIT');
  assert.equal(body.limit.capability, 'practice_question');
  assert.equal(body.limit.tier, 'free');
  assert.equal(body.limit.limit, 4);
  assert.equal(body.limit.message, 'You’ve used today’s 4 free practice questions.');
  assert.equal(body.limit.upgradeMessage, 'Upgrade to Master to keep practising today.');
  assert.equal(body.limit.upgradeHref, '/pricing?source=practice_exhausted#plans');
  assert.ok(!/quota/i.test(body.error), 'the student never sees internal wording');
  assert.deepEqual(world.calls.created, [], 'nothing is built and no provider is contacted');
});

test('questions waiting in an unfinished session are described as waiting, not as used', async () => {
  world.reset({ allowance: { limit: 4, used: 1, waiting: 3, remaining: 3, available: 0 } });
  const response = await createPractice(practiceRequest());
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.code, 'PRACTICE_QUESTIONS_WAITING');
  assert.ok(!/used today/i.test(body.error));
  assert.deepEqual(world.calls.created, []);
});

test('losing the race for the last questions under the ledger lock is a clean 402', async () => {
  world.reset({ meteredCreateRefused: true, allowance: { limit: 4, used: 3, waiting: 0, remaining: 1, available: 1 } });
  const response = await createPractice(practiceRequest());
  const body = await response.json();

  assert.equal(response.status, 402);
  assert.equal(body.limit.capability, 'practice_question');
  assert.deepEqual(world.calls.created, [], 'the losing request created and held nothing');
});

test('an unreadable ledger fails closed as an outage, not as a used-up allowance', async () => {
  world.reset({ allowanceUnreadable: true });
  const response = await createPractice(practiceRequest());
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.ok(!/used today/i.test(body.error), 'a student is never told they spent questions they did not');
  assert.deepEqual(world.calls.created, []);
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
