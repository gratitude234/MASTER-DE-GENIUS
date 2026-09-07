import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

process.env.ALOC_STATION_API_KEY = 'station-test-key';
process.env.ALOC_STATION_BASE_URL = 'https://station.aloc.test/api/v1';

const { AlocStationQuestionProvider, STATION_RANDOM_BATCH_LIMIT } =
  await import('../features/questions/providers/aloc-station/index.ts');
const { getQuestionProvider } = await import('../features/questions/providers/index.ts');
const { QuestionProviderUnsupportedFilterError } = await import('../features/questions/errors.ts');

console.info = () => {};

const item = (id, overrides = {}) => ({
  id: `station-${id}`,
  text: `<p>Question ${id}</p>`,
  options: { a: 'Alpha', b: 'Beta', c: 'Gamma', d: 'Delta' },
  correctAnswer: 'b',
  examType: 'jamb',
  subject: 'physics',
  year: 2021,
  ...overrides,
});

function upstream(batches) {
  const calls = [];
  const usage = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const data = batches[Math.min(calls.length - 1, batches.length - 1)] ?? [];
    return new Response(JSON.stringify({ data, meta: { creditsUsed: data.length, creditsRemaining: 900 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-Credits-Used': String(data.length), 'X-Credits-Remaining': '900' },
    });
  };
  return {
    calls,
    usage,
    provider: new AlocStationQuestionProvider(fetchImpl, async (entry) => usage.push(entry)),
  };
}

const ids = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => item(from + index));

test('Station assembles a 20-question practice set in documented random batches of ten', async () => {
  const { calls, usage, provider } = upstream([ids(1, 10), ids(11, 20)]);
  const questions = await provider.fetchQuestions({
    examBody: 'jamb', subjectSlug: 'physics', count: 20, requestType: 'practice',
  });

  assert.equal(questions.length, 20);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.pathname, '/api/v1/questions');
  assert.equal(calls[0].url.searchParams.get('limit'), String(STATION_RANDOM_BATCH_LIMIT));
  assert.equal(calls[0].url.searchParams.get('random'), 'true');
  assert.equal(calls[0].url.searchParams.get('examType'), 'jamb');
  assert.equal(calls[0].init.headers['X-API-Key'], 'station-test-key');
  assert.equal(usage.length, 2);
  assert.equal(usage[0].requestType, 'practice');
  assert.equal(usage[0].creditsUsed, 10);
});

test('Station normalizes its response without exposing provider-specific field names', async () => {
  const { provider } = upstream([[
    item(1, { text: '<p>Which answer?</p>', correctAnswer: 'B', difficultyLevel: 'medium' }),
  ]]);
  const [question] = await provider.fetchQuestions({ examBody: 'waec', subjectSlug: 'mathematics', count: 1 });
  assert.equal(question.prompt, 'Which answer?');
  assert.equal(question.correctOptionKey, 'B');
  assert.equal(question.source.provider, 'aloc_station');
  assert.equal(question.examBody, 'waec');
  assert.equal(question.difficulty, 'medium');
});

test('JAMB, WAEC and NECO are mapped while later exam bodies stay gated', async () => {
  const { provider } = upstream([[item(1)]]);
  assert.equal(provider.supportsSubject('jamb', 'physics'), true);
  assert.equal(provider.supportsSubject('waec', 'physics'), true);
  assert.equal(provider.supportsSubject('neco', 'physics'), true);
  assert.equal(provider.supportsSubject('post_utme', 'physics'), false);
  assert.equal(provider.supportsSubject('school', 'physics'), false);

  await assert.rejects(
    () => provider.fetchQuestions({ examBody: 'post_utme', subjectSlug: 'physics', count: 1 }),
    QuestionProviderUnsupportedFilterError,
  );
});

test('duplicates and malformed answer keys are never used to pad a paper', async () => {
  const invalid = item(2, { correctAnswer: 'z' });
  const { provider } = upstream([[item(1), item(1), invalid]]);
  const questions = await provider.fetchQuestions({ examBody: 'neco', subjectSlug: 'physics', count: 5 });
  assert.deepEqual(questions.map((question) => question.source.providerQuestionId), ['station-1']);
});

test('the provider registry keeps legacy ALOC and Station independently selectable', () => {
  assert.equal(getQuestionProvider('aloc').id, 'aloc');
  assert.ok(getQuestionProvider('aloc_station') instanceof AlocStationQuestionProvider);
  assert.equal(getQuestionProvider('internal').id, 'internal');
});
