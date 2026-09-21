import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { registerTsxHook } from '../scripts/tsx-hook.mjs';

registerAliasHook();
registerTsxHook();

/**
 * The three other routes that deliver or consume practice questions — the
 * answer endpoint, revision from results or the mistake bank, and the offline
 * copy — each resolve the plan per request and pass the same meter down.
 *
 * The real quota module runs here (the meter, the refusal type, the allowance
 * read); only the entitlement row, the service calls and the database client
 * are replaced.
 */

const stub = (source) => ({ url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true });
const NEXT_SERVER_URL = new URL('../node_modules/next/server.js', import.meta.url).href;

const FREE_LIMITS = { practice: { unit: 'question', perDay: 4 }, mockAttempts: 2, mockAttemptWindow: 'month', aiExplanationsPerDay: 2 };
const MASTER_LIMITS = { practice: { unit: 'session', perDay: 200 }, mockAttempts: 3, mockAttemptWindow: 'day', aiExplanationsPerDay: 20 };

const world = {
  reset(overrides = {}) {
    Object.assign(this, { tier: 'free', exhausted: false, meters: [], allowance: { allowance: 4, used: 4, waiting: 0, remaining: 0, available: 0 } }, overrides);
  },
};
world.reset();
globalThis.__routes = world;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/server') return { url: NEXT_SERVER_URL, shortCircuit: true };
    if (specifier === '@/lib/supabase/admin') {
      return stub(`export function createAdminClient(){ return {
        rpc: async () => ({ data: [globalThis.__routes.allowance], error: null }),
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
      return stub(`import { PracticeAllowanceExhausted } from '@/features/billing/quota';
        export async function savePracticeAnswerForUser(u, s, q, key, rev, mutation, meter){
          const w = globalThis.__routes; w.meters.push(meter);
          if (meter && w.exhausted) throw new PracticeAllowanceExhausted(meter);
          return { revision: rev + 1, mutationId: mutation, selectedOptionKey: key, answeredCount: 1, questionCount: 4 };
        }
        export async function loadPracticeSessionForUser(u, s, meter){ globalThis.__routes.meters.push(meter); return { id: s, questions: [] }; }`);
    }
    if (specifier === '@/features/exams/service') return stub('export async function loadExamAttemptForUser(){ return { id: "a" }; }');
    if (specifier === '@/features/results/service') {
      return stub(`import { PracticeAllowanceExhausted } from '@/features/billing/quota';
        export async function startRevision(u, input, meter){
          const w = globalThis.__routes; w.meters.push(meter);
          if (meter && w.exhausted) throw new PracticeAllowanceExhausted(meter);
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

test('a Free answer is saved through the practice-question meter', async () => {
  world.reset();
  const response = await saveAnswer(answerRequest(), params);
  assert.equal(response.status, 200);
  assert.equal(world.meters[0].limit, 4);
  assert.match(world.meters[0].dayKey, /^\d{4}-\d{2}-\d{2}$/);
});

test('58. an answer beyond the allowance is refused by the server — whatever the UI showed', async () => {
  world.reset({ exhausted: true });
  const response = await saveAnswer(answerRequest(), params);
  const body = await response.json();

  assert.equal(response.status, 402);
  assert.equal(body.code, 'PLAN_LIMIT');
  assert.equal(body.limit.capability, 'practice_question');
  assert.equal(body.limit.message, 'You’ve used today’s 4 free practice questions.');
  assert.deepEqual(body.allowance, { limit: 4, used: 4, waiting: 0, remaining: 0, available: 0 }, 'the counts come back with the refusal');
});

test('39. an exhausted Free student who upgrades answers on Master limits at the very next request', async () => {
  world.reset({ exhausted: true });
  assert.equal((await saveAnswer(answerRequest(), params)).status, 402);

  // Paystack activates Master: the entitlement row changes, nothing else.
  world.tier = 'master';
  const response = await saveAnswer(answerRequest(), params);
  assert.equal(response.status, 200, 'no sign-out, no new day');
  assert.equal(world.meters.at(-1), null, 'the Master answer path is unmetered');
});

test('revision from the mistake bank draws on the same allowance, and is refused at zero', async () => {
  world.reset({ exhausted: true });
  const refused = await startRevision(revisionRequest());
  assert.equal(refused.status, 402);
  assert.equal((await refused.json()).limit.upgradeHref, '/pricing?source=practice_exhausted#plans');

  world.reset({ tier: 'master', exhausted: true });
  assert.equal((await startRevision(revisionRequest())).status, 201, 'Master revision is unchanged');
  assert.equal(world.meters[0], null);
});

test('the offline copy of a Free session is gated by the same meter as the session page', async () => {
  world.reset();
  await offlineSession(new Request('https://app.invalid'), { params: Promise.resolve({ kind: 'practice', id: 's1' }) });
  assert.equal(world.meters[0].limit, 4);

  world.reset({ tier: 'master' });
  await offlineSession(new Request('https://app.invalid'), { params: Promise.resolve({ kind: 'practice', id: 's1' }) });
  assert.equal(world.meters[0], null);
});
