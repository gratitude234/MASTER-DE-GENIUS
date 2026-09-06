import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

const { alocRequest, requireAlocConfig, envelopeRecords, MAX_ATTEMPTS, REQUEST_TIMEOUT_MS } =
  await import('../features/questions/providers/aloc/transport.ts');
const {
  QuestionProviderError, QuestionProviderAuthError,
  QuestionProviderRateLimitError, QuestionProviderUnavailableError,
} = await import('../features/questions/errors.ts');

const SECRET = 'super-secret-token-value';
const config = { baseUrl: 'https://questions.aloc.test/api/v2', token: SECRET };

/** Captures provider logs so they can be asserted for secret leakage. */
let logs = [];
console.info = (line) => logs.push(line);

function responder(steps) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers, signal: init.signal });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (typeof step === 'function') return step();
    const { status = 200, body = { status: 200, data: [] }, headers = {} } = step;
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  };
  return { calls, fetchImpl };
}

const run = (fetchImpl, overrides = {}) => alocRequest({
  path: '/q/3', query: { subject: 'physics', type: 'utme' },
  subject: 'physics', examType: 'utme', config, fetchImpl, ...overrides,
});

test('a successful call returns the envelope and sends the AccessToken header', async () => {
  logs = [];
  const { calls, fetchImpl } = responder([{ body: { status: 200, data: [{ id: 1 }] } }]);
  const body = await run(fetchImpl);

  assert.deepEqual(envelopeRecords(body), [{ id: 1 }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.AccessToken, SECRET);
  assert.ok(calls[0].signal, 'every request carries an abort signal');
  assert.equal(calls[0].url.searchParams.get('subject'), 'physics');
});

test('401 and 403 are auth failures and are never retried', async () => {
  for (const status of [401, 403]) {
    const { calls, fetchImpl } = responder([{ status, body: { status, error: 'denied' } }]);
    await assert.rejects(() => run(fetchImpl), QuestionProviderAuthError);
    assert.equal(calls.length, 1, `status ${status} must not be retried`);
  }
});

test('the live 406 token rejection is classified as auth, not as a transient failure', async () => {
  // Exactly what questions.aloc.com.ng returns for a bad or deactivated token.
  const { calls, fetchImpl } = responder([{ status: 406, body: { status: 406, error: 'Access token not valid or deactivated' } }]);
  await assert.rejects(() => run(fetchImpl), QuestionProviderAuthError);
  assert.equal(calls.length, 1);
});

test('a missing token header is reported as auth, not retried', async () => {
  const { calls, fetchImpl } = responder([{ status: 406, body: { status: 400, error: 'Access token not provide on request header' } }]);
  await assert.rejects(() => run(fetchImpl), QuestionProviderAuthError);
  assert.equal(calls.length, 1);
});

test('a 400 unrelated to the token fails immediately without retrying', async () => {
  const { calls, fetchImpl } = responder([{ status: 400, body: { status: 400, error: 'bad subject' } }]);
  await assert.rejects(() => run(fetchImpl), (error) => error instanceof QuestionProviderError && !(error instanceof QuestionProviderUnavailableError));
  assert.equal(calls.length, 1);
});

test('404 is not retried', async () => {
  const { calls, fetchImpl } = responder([{ status: 404, body: { status: 404, error: 'not found' } }]);
  await assert.rejects(() => run(fetchImpl), QuestionProviderError);
  assert.equal(calls.length, 1);
});

test('500 is retried and a later success is returned', async () => {
  const { calls, fetchImpl } = responder([
    { status: 500, body: { status: 500, error: 'boom' } },
    { body: { status: 200, data: [{ id: 7 }] } },
  ]);
  const body = await run(fetchImpl);
  assert.deepEqual(envelopeRecords(body), [{ id: 7 }]);
  assert.equal(calls.length, 2);
});

test('a persistent 5xx fails as unavailable after the attempt limit', async () => {
  const { calls, fetchImpl } = responder([{ status: 503, body: { status: 503, error: 'down' } }]);
  await assert.rejects(() => run(fetchImpl), QuestionProviderUnavailableError);
  assert.equal(calls.length, MAX_ATTEMPTS, 'retries are bounded');
});

test('429 respects Retry-After before retrying', async () => {
  const { calls, fetchImpl } = responder([
    { status: 429, body: { status: 429, error: 'slow down' }, headers: { 'Retry-After': '1' } },
    { body: { status: 200, data: [{ id: 3 }] } },
  ]);
  const started = Date.now();
  await run(fetchImpl);
  assert.ok(Date.now() - started >= 900, 'Retry-After must delay the retry');
  assert.equal(calls.length, 2);
});

test('a persistent 429 surfaces a rate-limit error with a calm student message', async () => {
  const { calls, fetchImpl } = responder([{ status: 429, body: { status: 429, error: 'quota' }, headers: { 'Retry-After': '0' } }]);
  await assert.rejects(() => run(fetchImpl), (error) => {
    assert.ok(error instanceof QuestionProviderRateLimitError);
    assert.match(error.studentMessage, /try again/i);
    assert.doesNotMatch(error.studentMessage, /429|aloc/i, 'students never see upstream status codes');
    return true;
  });
  assert.equal(calls.length, MAX_ATTEMPTS);
});

test('a network failure is retried then reported as unavailable', async () => {
  const { calls, fetchImpl } = responder([() => Promise.reject(new Error('ECONNRESET'))]);
  await assert.rejects(() => run(fetchImpl), QuestionProviderUnavailableError);
  assert.equal(calls.length, MAX_ATTEMPTS);
});

test('an aborted request is treated as a timeout and reported as unavailable', async () => {
  const abort = () => Promise.reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
  const { calls, fetchImpl } = responder([abort]);
  await assert.rejects(() => run(fetchImpl), (error) => {
    assert.ok(error instanceof QuestionProviderUnavailableError);
    assert.match(error.message, /timed out/);
    return true;
  });
  assert.equal(calls.length, MAX_ATTEMPTS);
  assert.ok(REQUEST_TIMEOUT_MS >= 8000 && REQUEST_TIMEOUT_MS <= 12000, 'one central timeout in the agreed range');
});

test('a non-JSON body does not crash the transport', async () => {
  const { fetchImpl } = responder([() => new Response('<html>gateway</html>', { status: 502 })]);
  await assert.rejects(() => run(fetchImpl), QuestionProviderUnavailableError);
});

test('SECURITY: no log line or error message ever contains the token', async () => {
  logs = [];
  const { fetchImpl } = responder([
    { status: 500, body: { status: 500, error: 'boom' } },
    { body: { status: 200, data: [] } },
  ]);
  await run(fetchImpl);

  const authFailure = responder([{ status: 406, body: { status: 406, error: 'Access token not valid or deactivated' } }]);
  const captured = await run(authFailure.fetchImpl).catch((error) => error);

  assert.ok(logs.length > 0, 'calls are observable');
  for (const line of logs) assert.equal(line.includes(SECRET), false, `token leaked into log: ${line}`);
  assert.equal(captured.message.includes(SECRET), false, 'token leaked into an error message');
  assert.equal(JSON.stringify(logs).includes(SECRET), false);
});

test('missing configuration fails fast with an explicit message', () => {
  const previous = process.env.ALOC_ACCESS_TOKEN;
  try {
    delete process.env.ALOC_ACCESS_TOKEN;
    assert.throws(() => requireAlocConfig(), (error) => {
      assert.ok(error instanceof QuestionProviderAuthError);
      assert.match(error.message, /ALOC_ACCESS_TOKEN/);
      assert.match(error.message, /NEXT_PUBLIC_/);
      return true;
    });

    process.env.ALOC_ACCESS_TOKEN = 'present';
    delete process.env.ALOC_BASE_URL;
    assert.equal(requireAlocConfig().baseUrl, 'https://questions.aloc.com.ng/api/v2', 'legacy base URL is the default');
  } finally {
    if (previous === undefined) delete process.env.ALOC_ACCESS_TOKEN;
    else process.env.ALOC_ACCESS_TOKEN = previous;
  }
});
