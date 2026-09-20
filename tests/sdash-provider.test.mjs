import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

/**
 * The Sdash adapter: transport, batching, mapping and the guarantees a session
 * depends on.
 *
 * Every upstream call is a scripted fixture. No live request is made and no
 * provider credit is spent — the four verified mappings were confirmed by hand
 * once, and `npm run sdash:probe -- --confirm-spend` is how that is repeated.
 */

process.env.SDASH_API_KEY = 'sdash-test-key-never-logged';
process.env.SDASH_BASE_URL = 'https://sdash.test/api/v1';
process.env.SDASH_SANDBOX = 'true';

const { SdashQuestionProvider, SDASH_BATCH_LIMIT, SDASH_MAX_UPSTREAM_REQUESTS } =
  await import('../features/questions/providers/sdash/index.ts');
const { sdashExamType, sdashSubject, isSdashExamSubjectMapped, withheldSubjectEntries, sdashSubjectEntries } =
  await import('../features/questions/providers/sdash/mapping.ts');
const { getQuestionProvider } = await import('../features/questions/providers/index.ts');
const { assembleDeliverableQuestions, MAX_INTEGRITY_TOPUP_ROUNDS } =
  await import('../features/questions/service.ts');
const { toStudentQuestions } = await import('../features/questions/delivery.ts');
const {
  QuestionProviderAuthError,
  QuestionProviderRateLimitError,
  QuestionProviderUnavailableError,
  QuestionProviderUnsupportedFilterError,
} = await import('../features/questions/errors.ts');

console.info = () => {};   // per-batch provider diagnostics are asserted explicitly

/**
 * The usage ledger writes to Supabase, which these tests have no reason to
 * reach. A provider built without a recorder falls back to the real one, which
 * fails open and logs — so tests that do not assert usage inject a silent one.
 */
const silentUsage = async () => {};

/** A realistic Sdash V1 WASSCE record. */
const item = (id, overrides = {}) => ({
  id,
  question: `Which organelle carries out protein synthesis? (${id})`,
  section: null,
  option: { a: 'Ribosome', b: 'Lysosome', c: 'Golgi body', d: 'Vacuole' },
  answer: 'a',
  solution: 'Ribosomes assemble amino acids into polypeptide chains.',
  image: null,
  examtype: 'WASSCE',
  examyear: '2018',
  ...overrides,
});

const range = (from, to, make = item) =>
  Array.from({ length: to - from + 1 }, (_, index) => make(from + index));

/**
 * Replays scripted upstream batches and records what was asked for, so a test
 * can prove the exclusion list grows and the filters are never relaxed.
 */
function upstream(batches, { status = 200, headers = {}, envelope } = {}) {
  const calls = [];
  const usage = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const data = batches[Math.min(calls.length - 1, batches.length - 1)] ?? [];
    const body = envelope ?? { status, data: Array.isArray(data) && data.length === 1 && data.single ? data[0] : data };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  };
  return { calls, usage, provider: new SdashQuestionProvider(fetchImpl, async (entry) => usage.push(entry)) };
}

const query = (overrides = {}) => ({
  examBody: 'waec', subjectSlug: 'biology', count: 20, requestType: 'practice', ...overrides,
});

/* ─────────────────────────────────────────────  A. subject and exam mapping */

test('A: the four verified WAEC mappings translate at the provider boundary only', () => {
  assert.equal(sdashExamType('waec'), 'wassce');
  assert.equal(sdashSubject('waec', 'biology').sdash, 'biology');
  assert.equal(sdashSubject('waec', 'chemistry').sdash, 'chemistry');
  assert.equal(sdashSubject('waec', 'physics').sdash, 'physics');
  assert.equal(sdashSubject('waec', 'agricultural-science').sdash, 'agriculture');

  // MASTER slugs are the stable identifiers; the vendor spelling never escapes.
  assert.deepEqual(sdashSubjectEntries('waec').map(([slug]) => slug).sort(), [
    'agricultural-science', 'biology', 'chemistry', 'physics',
  ]);
});

test('B: English and Further Mathematics are withheld, each with its evidence', () => {
  const withheld = Object.fromEntries(withheldSubjectEntries());

  assert.ok(withheld['use-of-english'], 'WAEC English must stay withheld');
  assert.match(withheld['use-of-english'].reason, /403|Sandbox/i, 'the HTTP 403 evidence is recorded');
  assert.ok(withheld['further-mathematics'], 'Further Mathematics must stay withheld');
  assert.match(withheld['further-mathematics'].reason, /catalogue|verified source/i);

  for (const slug of ['use-of-english', 'further-mathematics']) {
    assert.equal(isSdashExamSubjectMapped('waec', slug), false);
    assert.throws(() => sdashSubject('waec', slug), QuestionProviderUnsupportedFilterError);
  }
});

test('B: no exam other than WAEC reaches Sdash', () => {
  for (const examBody of ['jamb', 'neco', 'post_utme', 'school']) {
    assert.throws(() => sdashExamType(examBody), QuestionProviderUnsupportedFilterError);
    for (const slug of ['biology', 'chemistry', 'physics', 'agricultural-science']) {
      assert.equal(isSdashExamSubjectMapped(examBody, slug), false,
        `${examBody} ${slug} must not be mapped: this milestone is WAEC-only`);
    }
  }
});

test('C: the registry resolves sdash to the Sdash adapter', () => {
  const provider = getQuestionProvider('sdash');
  assert.ok(provider instanceof SdashQuestionProvider);
  assert.equal(provider.id, 'sdash');
});

/* ──────────────────────────────────────────────────────────  transport/auth */

test('the access token travels in the AccessToken header, never in the query string', async () => {
  const { calls, provider } = upstream([range(1, 20)]);
  await provider.fetchQuestions(query());

  const [{ url, init }] = calls;
  assert.equal(init.headers.AccessToken, 'sdash-test-key-never-logged');
  assert.equal(url.pathname, '/api/v1/q');
  assert.equal(url.searchParams.get('token'), null, 'the token is never a query parameter');
  assert.equal(url.search.includes('sdash-test-key'), false);
  assert.equal(String(url).includes('sdash-test-key'), false);
});

test('the request carries the requested exam, subject and batch size', async () => {
  const { calls, provider } = upstream([range(1, 20)]);
  await provider.fetchQuestions(query({ subjectSlug: 'agricultural-science' }));

  const { url } = calls[0];
  assert.equal(url.searchParams.get('type'), 'wassce');
  assert.equal(url.searchParams.get('subject'), 'agriculture');
  assert.equal(url.searchParams.get('limit'), '20');
});

test('batching stays inside the documented 1-50 limit and never asks per question', async () => {
  const { calls, provider } = upstream([range(1, 50), range(51, 80)]);
  const questions = await provider.fetchQuestions(query({ count: 80 }));

  assert.equal(questions.length, 80);
  assert.equal(calls.length, 2, '80 questions must not cost 80 upstream calls');
  assert.equal(calls[0].url.searchParams.get('limit'), String(SDASH_BATCH_LIMIT));
  assert.equal(calls[1].url.searchParams.get('limit'), '30', 'the second round asks only for the shortfall');
});

test('E: a one-question response object and a multi-question array both normalize', async () => {
  const single = new SdashQuestionProvider(async () =>
    new Response(JSON.stringify({ status: 200, data: item(7) }), { status: 200 }), silentUsage);
  const one = await single.fetchQuestions(query({ count: 1 }));
  assert.equal(one.length, 1);
  assert.equal(one[0].source.providerQuestionId, '7');

  const { provider } = upstream([range(1, 3)]);
  const many = await provider.fetchQuestions(query({ count: 3 }));
  assert.equal(many.length, 3);
});

test('HTTP 404 means "nothing matched", not a provider failure', async () => {
  const provider = new SdashQuestionProvider(async () =>
    new Response(JSON.stringify({ status: 404, error: "No questions found" }), { status: 404 }), silentUsage);

  // The filters are never relaxed to produce something: an empty result is
  // returned, and the session engine reports the shortage.
  assert.deepEqual(await provider.fetchQuestions(query()), []);
});

test('provider failures become the shared error taxonomy, never raw upstream text', async () => {
  const respond = (status, body) => new SdashQuestionProvider(async () =>
    new Response(JSON.stringify(body), { status }), silentUsage);

  await assert.rejects(
    () => respond(401, { status: 401, error: 'Invalid AccessToken' }).fetchQuestions(query()),
    QuestionProviderAuthError,
  );

  // A Sandbox plan restriction is not a suspended account.
  const restricted = respond(403, {
    status: 403,
    error: 'This subject is not available for Sandbox testing. Please upgrade to a paid plan to access English.',
  });
  await assert.rejects(() => restricted.fetchQuestions(query()), QuestionProviderUnsupportedFilterError);

  await assert.rejects(
    () => respond(403, { status: 403, error: 'Account suspended' }).fetchQuestions(query()),
    QuestionProviderAuthError,
  );
  await assert.rejects(
    () => respond(429, { status: 429, error: 'Monthly quota exceeded' }).fetchQuestions(query()),
    QuestionProviderRateLimitError,
  );
  await assert.rejects(
    () => respond(503, { status: 503, error: 'upstream down' }).fetchQuestions(query()),
    QuestionProviderUnavailableError,
  );
});

test('SECURITY: a student-facing message never carries provider detail or the token', async () => {
  const provider = new SdashQuestionProvider(async () =>
    new Response(JSON.stringify({ status: 401, error: "Invalid AccessToken sdash-test-key-never-logged" }), { status: 401 }), silentUsage);

  const error = await provider.fetchQuestions(query()).catch((thrown) => thrown);
  assert.ok(error instanceof QuestionProviderAuthError);
  assert.equal(error.studentMessage, 'Questions are temporarily unavailable. Please try again shortly.');
  assert.equal(error.studentMessage.includes('sdash-test-key'), false);
  assert.equal(error.studentMessage.toLowerCase().includes('sdash'), false, 'the provider is not named to a student');
  assert.equal(error.studentMessage.includes('sdash.test'), false, 'no internal URL reaches a student');
});

test('a transport failure is bounded: finite retries, then a safe error', async () => {
  let attempts = 0;
  const provider = new SdashQuestionProvider(async () => {
    attempts += 1;
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  }, silentUsage);

  await assert.rejects(() => provider.fetchQuestions(query()), QuestionProviderUnavailableError);
  assert.equal(attempts, 3, 'retries are bounded, never unbounded');
});

/* ──────────────────────────────────────────────────  filters and capabilities */

test('an unsupported filter fails before a session is frozen, never silently dropped', async () => {
  const { calls, provider } = upstream([range(1, 20)]);

  await assert.rejects(
    () => provider.fetchQuestions(query({ topicSlug: 'cell-biology' })),
    QuestionProviderUnsupportedFilterError,
  );
  await assert.rejects(
    () => provider.fetchQuestions(query({ difficulty: 'hard' })),
    QuestionProviderUnsupportedFilterError,
  );
  assert.equal(calls.length, 0, 'no credit is spent on a request that cannot be honoured');
});

test('SANDBOX: a year request is refused rather than answered from the one stocked year', async () => {
  const { calls, provider } = upstream([range(1, 20)]);
  assert.equal(provider.capabilities.years, false, 'Sandbox must not advertise year selection');

  await assert.rejects(
    () => provider.fetchQuestions(query({ year: 2019 })),
    QuestionProviderUnsupportedFilterError,
  );
  assert.equal(calls.length, 0);
});

test('PRODUCTION: declaring a paid plan restores year filtering and passes it upstream', async () => {
  process.env.SDASH_SANDBOX = 'false';
  try {
    const { calls, provider } = upstream([range(1, 5)]);
    assert.equal(provider.capabilities.years, true);

    await provider.fetchQuestions(query({ count: 5, year: 2019 }));
    assert.equal(calls[0].url.searchParams.get('year'), '2019');
  } finally {
    process.env.SDASH_SANDBOX = 'true';
  }
});

test('V1 never claims a filter it does not have', () => {
  const { capabilities } = new SdashQuestionProvider();
  assert.equal(capabilities.topics, false, 'V1 carries no topic field');
  assert.equal(capabilities.difficulty, false, 'V1 carries no difficulty field');
});

/* ─────────────────────────────────────────────────  integrity and delivery */

/** Structurally valid, semantically orphaned: the section instruction was lost. */
const orphan = (id) => item(id, { question: 'osmosis', section: null });

/** References a diagram that never arrived. */
const danglingDiagram = (id) => item(id, {
  question: 'According to the diagram above, the labelled structure X is the',
  image: null,
});

test('J/L: a Sdash question that fails integrity is replaced, not subtracted', async () => {
  const first = [...range(1, 17), orphan(18), danglingDiagram(19), orphan(20)];
  const { calls, provider } = upstream([first, range(21, 23)]);

  const result = await assembleDeliverableQuestions(provider, query());

  assert.equal(result.questions.length, 20, 'the student asked for twenty and must receive twenty');
  assert.equal(new Set(result.questions.map((q) => q.source.providerQuestionId)).size, 20, 'no duplicates');
  assert.equal(result.rejections.length, 3);
  assert.equal(result.rejections.every((r) => r.provider === 'sdash'), true);
  assert.ok(calls.length >= 2, 'same-provider replacements were actually fetched');
  for (const question of result.questions) {
    assert.equal(['18', '19', '20'].includes(question.source.providerQuestionId), false);
  }
});

test('J: the shared integrity validator owns the verdict — no provider shortcut', async () => {
  const { provider } = upstream([[item(1), orphan(2), danglingDiagram(3)]]);
  const result = await assembleDeliverableQuestions(provider, query({ count: 3 }));

  const byId = new Map(result.rejections.map((rejection) => [rejection.providerQuestionId, rejection]));
  assert.equal(byId.get('2').reason, 'orphan_fragment');
  assert.equal(byId.get('3').reason, 'missing_referenced_asset');
  for (const rejection of result.rejections) {
    assert.equal(rejection.examBody, 'waec');
    assert.equal(rejection.subjectSlug, 'biology');
    const serialized = JSON.stringify(rejection);
    assert.equal(serialized.includes('correctOptionKey'), false, 'a diagnostic never carries an answer key');
    assert.equal(/\buserId\b|\bstudent\b/i.test(serialized), false, 'a diagnostic never carries student identity');
  }
});

test('L: a replacement round asks only for the shortfall and excludes everything seen', async () => {
  const first = [...range(1, 17), orphan(18), orphan(19), orphan(20)];
  const { calls, provider } = upstream([first, range(21, 23)]);

  await assembleDeliverableQuestions(provider, query());

  assert.equal(calls[0].url.searchParams.get('limit'), '20', 'the first round asks for the full set');
  assert.equal(calls[1].url.searchParams.get('limit'), '3', 'the top-up asks only for the three that were refused');
  for (const call of calls) {
    assert.equal(call.url.searchParams.get('subject'), 'biology', 'the subject is never relaxed');
    assert.equal(call.url.searchParams.get('type'), 'wassce', 'the exam is never relaxed');
  }
});

test('M: repeated invalid or duplicate inventory terminates safely', async () => {
  // Every round returns the same three orphaned records, forever.
  const { calls, provider } = upstream([range(1, 3, orphan)]);
  const result = await assembleDeliverableQuestions(provider, query());

  assert.equal(result.questions.length, 0, 'a malformed question is never used to pad a session');
  assert.equal(result.rejections.length, 3, 'each distinct bad record is reported once');
  assert.ok(result.rounds <= MAX_INTEGRITY_TOPUP_ROUNDS + 1, `rounds must stay bounded, spent ${result.rounds}`);
  assert.ok(calls.length <= (MAX_INTEGRITY_TOPUP_ROUNDS + 1) * SDASH_MAX_UPSTREAM_REQUESTS,
    `upstream calls must stay bounded, spent ${calls.length}`);
});

test('M: an exhausted pool stops after a single barren round', async () => {
  const { provider } = upstream([[]]);
  const result = await assembleDeliverableQuestions(provider, query());

  assert.equal(result.questions.length, 0);
  assert.equal(result.rounds, 1, 'nothing new arrived, so no replacement round is attempted');
});

test('N: an admin-blocked Sdash question stays out of every replacement round', async () => {
  const blocked = [{ provider: 'sdash', sourceQuestionId: '7' }];
  const { calls, provider } = upstream([[...range(1, 17), orphan(18), orphan(19), orphan(20)], range(21, 24)]);

  const result = await assembleDeliverableQuestions(provider, query(), blocked);

  assert.equal(result.questions.some((q) => q.source.providerQuestionId === '7'), false,
    'a blocked question must never reach a session');
  assert.equal(result.rejections.some((r) => r.providerQuestionId === '7'), false,
    'a block is not an integrity rejection');
  assert.ok(calls.length >= 2);
});

test('N: a block against a different provider does not remove a Sdash question', async () => {
  const blocked = [{ provider: 'aloc_station', sourceQuestionId: '7' }];
  const { provider } = upstream([range(1, 20)]);
  const result = await assembleDeliverableQuestions(provider, query(), blocked);

  assert.equal(result.questions.some((q) => q.source.providerQuestionId === '7'), true,
    'provider identity is part of a block; ids are not global');
});

test('O: the delivered payload withholds the answer key and the explanation', async () => {
  const { provider } = upstream([range(1, 2)]);
  const result = await assembleDeliverableQuestions(provider, query({ count: 2 }));
  const [first] = toStudentQuestions(result.questions);

  assert.equal(result.questions[0].correctOptionKey, 'A');
  assert.equal(result.questions[0].explanation, 'Ribosomes assemble amino acids into polypeptide chains.');
  assert.equal('correctOptionKey' in first, false);
  assert.equal('explanation' in first, false);
  assert.equal(JSON.stringify(first).includes('correctOptionKey'), false);
  assert.equal(JSON.stringify(first).includes('Ribosomes assemble'), false);
});

test('P: a frozen snapshot is stable — the same record always produces the same id', async () => {
  const build = async () => {
    const { provider } = upstream([[item(4821)]]);
    const [question] = await provider.fetchQuestions(query({ count: 1 }));
    return question;
  };

  const first = await build();
  const second = await build();
  assert.equal(first.id, second.id);
  assert.equal(first.id, 'sdash:waec:biology:4821');
  assert.deepEqual(first.options.map((o) => o.id), second.options.map((o) => o.id));
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)),
    'a resumed or refreshed session must see byte-identical content');
});

/* ────────────────────────────────────────────────────  usage observability */

test('R19: usage is recorded per attempt without ever carrying the token', async () => {
  const { usage, provider } = upstream([range(1, 5)], {
    headers: { 'X-Credits-Used': '5', 'X-Credits-Remaining': '1,995' },
  });
  await provider.fetchQuestions(query({ count: 5 }));

  assert.equal(usage.length, 1);
  const [entry] = usage;
  assert.equal(entry.provider, 'sdash');
  assert.equal(entry.endpoint, '/q');
  assert.equal(entry.requestType, 'practice');
  assert.equal(entry.examBody, 'waec');
  assert.equal(entry.subject, 'biology');
  assert.equal(entry.outcome, 'ok');
  assert.equal(entry.httpStatus, 200);
  assert.equal(entry.questionCount, 5);
  assert.equal(entry.creditsUsed, 5);
  assert.equal(entry.creditsRemaining, 1995);
  assert.equal(JSON.stringify(entry).includes('sdash-test-key'), false, 'the ledger never holds a secret');
});

test('R19: credits stay null rather than invented when the response omits them', async () => {
  const { usage, provider } = upstream([range(1, 2)]);
  await provider.fetchQuestions(query({ count: 2 }));

  assert.equal(usage[0].creditsUsed, null);
  assert.equal(usage[0].creditsRemaining, null);
});

/* ───────────────────────────────────────────────────  missing credentials */

test('S: with no SDASH_API_KEY the adapter refuses before it reaches the network', async () => {
  const previous = process.env.SDASH_API_KEY;
  delete process.env.SDASH_API_KEY;
  try {
    const { calls, provider } = upstream([range(1, 20)]);
    assert.equal(provider.isConfigured(), false);
    const error = await provider.fetchQuestions(query()).catch((thrown) => thrown);

    assert.ok(error instanceof QuestionProviderAuthError);
    assert.match(error.message, /SDASH_API_KEY/, 'the operator is told which variable is missing');
    assert.equal(error.message.includes('NEXT_PUBLIC'), true, 'and warned not to publish it');
    assert.equal(calls.length, 0);
  } finally {
    process.env.SDASH_API_KEY = previous;
  }
});
