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

/** Everything the routes reach for, recorded rather than performed. */
const world = {
  reset(overrides = {}) {
    Object.assign(this, {
      tier: 'free',
      limits: { practiceSessionsPerDay: 20, mockAttempts: 1, mockAttemptWindow: 'month', aiExplanationsPerDay: 3 },
      reserveAllowed: true,
      rateLimited: false,
      claimOutcome: { status: 'claimed' },
      unauthenticated: false,
      providerFails: false,
      mockResumed: false,
      calls: { reserved: [], committed: [], released: [], created: [] },
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
    if (specifier === 'next/server') {
      return { url: NEXT_SERVER_URL, shortCircuit: true };
    }

    if (specifier === '@/features/billing/quota') {
      return stub(`
        const w = () => globalThis.__world;
        export function quotaWindow(kind, now = new Date()) {
          return { key: 'window', kind, resetAt: new Date(Date.now() + 3600_000) };
        }
        export function capabilityLimit(capability, limits) {
          return capability === 'practice_session'
            ? { limit: limits.practiceSessionsPerDay, windowKind: 'day' }
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
        export async function createPracticeSessionForUser() {
          const world = globalThis.__world;
          if (world.providerFails) throw new Error('The question provider is unavailable.');
          world.calls.created.push('practice');
          return { sessionId: 'session-1', questionCount: 10, requestedCount: 10 };
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

test('a Free student within their allowance starts a session and spends one slot', async () => {
  world.reset();
  const response = await createPractice(practiceRequest());

  assert.equal(response.status, 201);
  assert.deepEqual(world.calls.reserved, ['practice_session']);
  assert.deepEqual(world.calls.committed, ['reservation-1'], 'the allowance is spent only once a session exists');
  assert.deepEqual(world.calls.released, []);
});

test('a Free student over their daily practice allowance is refused with an upgrade path', async () => {
  world.reset({ reserveAllowed: false });
  const response = await createPractice(practiceRequest());
  const body = await response.json();

  assert.equal(response.status, 402, 'a plan boundary is 402, distinct from a 429 "slow down"');
  assert.equal(body.code, 'PLAN_LIMIT');
  assert.equal(body.limit.tier, 'free');
  assert.equal(body.limit.limit, 20);
  assert.equal(body.limit.upgradeHref, '/pricing');
  assert.match(body.error, /20 practice sessions for today/);
  assert.match(body.error, /Upgrade to Master/);
  assert.ok(!/quota/i.test(body.error), 'the student never sees internal wording');
  assert.deepEqual(world.calls.created, [], 'nothing is built and no provider is contacted');
});

test('a Master student gets the larger practice allowance from the same mechanism', async () => {
  world.reset({
    tier: 'master',
    limits: { practiceSessionsPerDay: 200, mockAttempts: 3, mockAttemptWindow: 'day', aiExplanationsPerDay: 20 },
    reserveAllowed: false,
  });
  const body = await (await createPractice(practiceRequest())).json();

  assert.equal(body.limit.limit, 200, 'Master is stopped at 200, not at 20');
  assert.equal(body.limit.tier, 'master');
  assert.equal(body.limit.upgradeMessage, null, 'there is nothing further to sell');
});

test('a provider failure gives the practice allowance straight back', async () => {
  world.reset({ providerFails: true });
  const response = await createPractice(practiceRequest());

  assert.equal(response.status, 503);
  assert.deepEqual(world.calls.released, ['reservation-1'], 'a failed upstream call must not cost a slot');
  assert.deepEqual(world.calls.committed, [], 'nothing was created, so nothing is spent');
});

test('a suppressed duplicate submit returns the first session without spending twice', async () => {
  world.reset({ claimOutcome: { status: 'duplicate', sessionId: 'session-1' } });
  const response = await createPractice(practiceRequest());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.deduplicated, true);
  assert.deepEqual(world.calls.released, ['reservation-1'], 'the second tap created nothing and pays nothing');
  assert.deepEqual(world.calls.committed, []);
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

test('a Free student gets one full mock a month, then a monthly upgrade prompt', async () => {
  world.reset();
  assert.equal((await createMock()).status, 201);
  assert.deepEqual(world.calls.committed, ['reservation-1']);

  world.reset({ reserveAllowed: false });
  const body = await (await createMock()).json();

  assert.equal(body.code, 'PLAN_LIMIT');
  assert.equal(body.limit.limit, 1);
  assert.equal(body.limit.capability, 'mock_attempt');
  assert.match(body.error, /free full mock for this month/);
  assert.match(body.error, /3 full mocks every day/, 'the student is told exactly what Master changes');
});

test('a Master student gets three full mocks a day', async () => {
  world.reset({
    tier: 'master',
    limits: { practiceSessionsPerDay: 200, mockAttempts: 3, mockAttemptWindow: 'day', aiExplanationsPerDay: 20 },
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
