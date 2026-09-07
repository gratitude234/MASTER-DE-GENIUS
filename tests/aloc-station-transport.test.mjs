import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { readFileSync } from 'node:fs';

registerAliasHook();

const { stationRequest, requireAlocStationConfig } =
  await import('../features/questions/providers/aloc-station/transport.ts');
const {
  QuestionProviderAuthError, QuestionProviderRateLimitError, QuestionProviderUnavailableError,
} = await import('../features/questions/errors.ts');

const SECRET = 'station-secret-must-never-leak';
const config = { baseUrl: 'https://station.aloc.test/api/v1', apiKey: SECRET };

function run(fetchImpl, usage, overrides = {}) {
  return stationRequest({
    path: '/questions', query: { subject: 'physics', examType: 'jamb', limit: 10 },
    examBody: 'jamb', subject: 'physics', requestType: 'probe', requestedQuestionCount: 10,
    config, fetchImpl, usageRecorder: async (entry) => usage.push(entry), ...overrides,
  });
}

test('successful calls capture the provider credit ledger without recording the key', async () => {
  const usage = [];
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ data: [{ id: 'q1' }], meta: { requestId: 'req-1' } }), {
      status: 200,
      headers: { 'X-Credits-Used': '40', 'X-Credits-Remaining': '960' },
    });
  };
  await run(fetchImpl, usage);
  assert.equal(calls[0].init.headers['X-API-Key'], SECRET);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].creditsUsed, 40);
  assert.equal(usage[0].creditsRemaining, 960);
  assert.equal(usage[0].providerRequestId, 'req-1');
  assert.equal(JSON.stringify(usage).includes(SECRET), false);
});

test('invalid credentials fail once and never leak the API key', async () => {
  const usage = [];
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: 'invalid key' }), { status: 401 });
  };
  const error = await run(fetchImpl, usage).catch((cause) => cause);
  assert.ok(error instanceof QuestionProviderAuthError);
  assert.equal(calls, 1);
  assert.equal(error.message.includes(SECRET), false);
  assert.equal(JSON.stringify(usage).includes(SECRET), false);
});

test('credit exhaustion is classified separately from bad credentials', async () => {
  const usage = [];
  const fetchImpl = async () => new Response(JSON.stringify({ error: 'sandbox credit limit exceeded' }), { status: 403 });
  await assert.rejects(() => run(fetchImpl, usage), QuestionProviderRateLimitError);
  assert.equal(usage[0].outcome, 'failed');
});

test('transient failures are retried and every attempt is metered', async () => {
  const usage = [];
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ error: 'temporary' }), { status: 503 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  await run(fetchImpl, usage);
  assert.equal(calls, 2);
  assert.deepEqual(usage.map((entry) => entry.outcome), ['retry', 'ok']);
});

test('network failures are bounded and metered without storing raw errors', async () => {
  const usage = [];
  await assert.rejects(
    () => run(async () => { throw new Error('socket secret detail'); }, usage),
    QuestionProviderUnavailableError,
  );
  assert.equal(usage.length, 3);
  assert.equal(JSON.stringify(usage).includes('socket secret detail'), false);
});

test('missing Station configuration fails before any request', () => {
  const previous = process.env.ALOC_STATION_API_KEY;
  try {
    delete process.env.ALOC_STATION_API_KEY;
    assert.throws(() => requireAlocStationConfig(), /ALOC_STATION_API_KEY/);
  } finally {
    if (previous === undefined) delete process.env.ALOC_STATION_API_KEY;
    else process.env.ALOC_STATION_API_KEY = previous;
  }
});

test('the usage migration is service-role-only and stores no student or question content', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260907220013_external_api_usage.sql', import.meta.url), 'utf8');
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.external_api_usage from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert on table public\.external_api_usage to service_role/i);
  assert.doesNotMatch(sql, /\buser_id\b|question_text|correct_option|api_key/i);
});
