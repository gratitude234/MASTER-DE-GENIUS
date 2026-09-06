import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

process.env.ALOC_ACCESS_TOKEN = 'test-token-never-logged';
process.env.ALOC_BASE_URL = 'https://questions.aloc.test/api/v2';

const { AlocQuestionProvider, ALOC_BATCH_LIMIT, MAX_UPSTREAM_REQUESTS } =
  await import('../features/questions/providers/aloc/index.ts');
const { getQuestionProvider } = await import('../features/questions/providers/index.ts');
const { fetchCanonicalQuestions } = await import('../features/questions/service.ts');
const { QuestionProviderUnsupportedFilterError } = await import('../features/questions/errors.ts');

console.info = () => {};   // provider diagnostics are asserted elsewhere, not here

const item = (id) => ({
  id,
  question: `Question ${id}`,
  option: { a: 'Alpha', b: 'Beta', c: 'Gamma', d: 'Delta' },
  answer: 'b',
  examyear: '2019',
});

/** Records each upstream call and replays the supplied batches in order. */
function upstream(batches) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push({ path: url.pathname, subject: url.searchParams.get('subject'), year: url.searchParams.get('year'), type: url.searchParams.get('type') });
    const data = batches[Math.min(calls.length - 1, batches.length - 1)] ?? [];
    return new Response(JSON.stringify({ status: 200, subject: 'physics', data }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  return { calls, provider: new AlocQuestionProvider(fetchImpl) };
}

const ids = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => item(from + i));

test('a 60-question paper is assembled from several bounded upstream requests', async () => {
  const { calls, provider } = upstream([ids(1, 40), ids(41, 60)]);
  const questions = await provider.fetchQuestions({ examBody: 'jamb', subjectSlug: 'use-of-english', count: 60 });

  assert.equal(questions.length, 60);
  assert.equal(new Set(questions.map((q) => q.source.providerQuestionId)).size, 60);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, `/api/v2/q/${ALOC_BATCH_LIMIT}`, 'first call requests a full batch');
  assert.equal(calls[1].path, '/api/v2/q/20', 'second call requests only the remainder');
  assert.equal(calls[0].subject, 'english', 'internal slug is mapped to the ALOC subject');
  assert.equal(calls[0].type, 'utme', 'jamb is mapped to utme');
});

test('duplicates inside one response are collapsed', async () => {
  const { provider } = upstream([[item(1), item(2), item(1), item(2), item(3)]]);
  const questions = await provider.fetchQuestions({ examBody: 'jamb', subjectSlug: 'physics', count: 5 });
  assert.deepEqual(questions.map((q) => q.source.providerQuestionId), ['1', '2', '3']);
});

test('duplicates across repeated requests are collapsed and never padded', async () => {
  const { calls, provider } = upstream([ids(1, 3), [item(2), item(3), item(4)], [item(4), item(5)]]);
  const questions = await provider.fetchQuestions({ examBody: 'jamb', subjectSlug: 'physics', count: 5 });
  assert.deepEqual(questions.map((q) => q.source.providerQuestionId), ['1', '2', '3', '4', '5']);
  assert.equal(calls.length, 3);
});

test('excludeSourceIds are never returned', async () => {
  const { provider } = upstream([ids(1, 5)]);
  const questions = await provider.fetchQuestions({
    examBody: 'jamb', subjectSlug: 'physics', count: 5, excludeSourceIds: ['1', '3'],
  });
  assert.deepEqual(questions.map((q) => q.source.providerQuestionId), ['2', '4', '5']);
});

test('an exhausted pool stops early and reports a genuine shortage', async () => {
  const { calls, provider } = upstream([ids(1, 3)]);   // same three questions forever
  const questions = await provider.fetchQuestions({ examBody: 'jamb', subjectSlug: 'physics', count: 40 });
  assert.equal(questions.length, 3, 'a shortage is reported, never padded with duplicates');
  assert.equal(calls.length, 3, 'two barren rounds end the loop');
  assert.ok(calls.length < MAX_UPSTREAM_REQUESTS);
});

test('an empty upstream response ends the loop immediately', async () => {
  const { calls, provider } = upstream([[]]);
  const questions = await provider.fetchQuestions({ examBody: 'jamb', subjectSlug: 'physics', count: 20 });
  assert.equal(questions.length, 0);
  assert.equal(calls.length, 1);
});

test('malformed records are dropped without failing the batch', async () => {
  const { provider } = upstream([[item(1), { id: 2, question: '', option: {}, answer: 'a' }, item(3), null]]);
  const questions = await provider.fetchQuestions({ examBody: 'jamb', subjectSlug: 'physics', count: 4 });
  assert.deepEqual(questions.map((q) => q.source.providerQuestionId), ['1', '3']);
});

test('a requested year is forwarded and the upstream year is preserved', async () => {
  const { calls, provider } = upstream([[{ ...item(9), examyear: '2016' }]]);
  const questions = await provider.fetchQuestions({ examBody: 'jamb', subjectSlug: 'physics', count: 1, year: 2016 });
  assert.equal(calls[0].year, '2016');
  assert.equal(questions[0].year, 2016);
});

test('an unmapped subject and an unmapped exam both fail loudly', async () => {
  const { calls, provider } = upstream([ids(1, 5)]);
  await assert.rejects(
    () => provider.fetchQuestions({ examBody: 'jamb', subjectSlug: 'yoruba', count: 5 }),
    (error) => error instanceof QuestionProviderUnsupportedFilterError && /verified mapping/i.test(error.message),
  );
  await assert.rejects(
    () => provider.fetchQuestions({ examBody: 'waec', subjectSlug: 'physics', count: 5 }),
    (error) => error instanceof QuestionProviderUnsupportedFilterError && /exam mapping/i.test(error.message),
  );
  assert.equal(calls.length, 0, 'an unsupported request must never reach the network');
});

test('unsupported filters are refused before a session is created', async () => {
  for (const query of [
    { examBody: 'jamb', subjectSlug: 'physics', count: 10, topicSlug: 'waves' },
    { examBody: 'jamb', subjectSlug: 'physics', count: 10, difficulty: 'hard' },
  ]) {
    await assert.rejects(
      () => fetchCanonicalQuestions(query, 'aloc'),
      (error) => {
        assert.ok(error instanceof QuestionProviderUnsupportedFilterError);
        assert.match(error.studentMessage, /expanded question source/);
        assert.doesNotMatch(error.studentMessage, /aloc/i, 'students are never told the provider name');
        return true;
      },
    );
  }
});

test('the year filter is allowed because the provider supports it', async () => {
  const provider = getQuestionProvider('aloc');
  assert.equal(provider.capabilities.years, true);
  assert.equal(provider.capabilities.topics, false);
  assert.equal(provider.capabilities.difficulty, false);
  assert.equal(provider.capabilities.passages, true);
});

test('QUESTION_PROVIDER=aloc resolves the ALOC provider; internal still works', () => {
  const previous = process.env.QUESTION_PROVIDER;
  process.env.QUESTION_PROVIDER = 'aloc';
  try {
    assert.ok(getQuestionProvider() instanceof AlocQuestionProvider);
    assert.equal(getQuestionProvider().id, 'aloc');
    assert.equal(getQuestionProvider('internal').id, 'internal');
    assert.throws(() => getQuestionProvider('sdash'), /not implemented in this build/);
  } finally {
    process.env.QUESTION_PROVIDER = previous;
  }
});
