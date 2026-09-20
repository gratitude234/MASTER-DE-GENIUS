import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

process.env.ALOC_ACCESS_TOKEN = 'test-token-never-logged';
process.env.ALOC_BASE_URL = 'https://questions.aloc.test/api/v2';

const { AlocQuestionProvider, MAX_UPSTREAM_REQUESTS } =
  await import('../features/questions/providers/aloc/index.ts');
const { assembleDeliverableQuestions, MAX_INTEGRITY_TOPUP_ROUNDS } =
  await import('../features/questions/service.ts');
const { toStudentQuestions } = await import('../features/questions/delivery.ts');

console.info = () => {};   // per-batch provider diagnostics are asserted elsewhere

/** A well-formed question: a real stem, four options and a resolvable key. */
const valid = (id) => ({
  id,
  question: `Which quantity is a vector? (${id})`,
  option: { a: 'Speed', b: 'Velocity', c: 'Mass', d: 'Energy' },
  answer: 'b',
  examyear: '2019',
});

/** Structurally valid, semantically orphaned: the section instruction was lost. */
const orphan = (id) => ({
  id,
  question: 'mischief',
  option: { a: 'Christmas', b: 'ritual', c: 'goodness', d: 'Champagne' },
  answer: 'c',
  section: null,
});

/** References a comprehension passage that was never delivered. */
const danglingPassage = (id) => ({
  id,
  question: 'According to the passage above, the narrator was',
  option: { a: 'angry', b: 'calm', c: 'tired', d: 'afraid' },
  answer: 'b',
  section: null,
});

/** Carries its instruction, so it is answerable as delivered. */
const withInstruction = (id) => ({
  id,
  question: 'mischief',
  option: { a: 'Christmas', b: 'ritual', c: 'goodness', d: 'Champagne' },
  answer: 'c',
  section: 'In each of the following questions, choose the option opposite in meaning to the word given.',
  hasPassage: 0,
});

/**
 * Replays scripted upstream batches and records what was asked for, so the
 * tests can prove the exclusion list grows and the filters are never relaxed.
 */
function upstream(batches) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push({
      path: url.pathname,
      year: url.searchParams.get('year'),
      subject: url.searchParams.get('subject'),
      type: url.searchParams.get('type'),
    });
    const data = batches[Math.min(calls.length - 1, batches.length - 1)] ?? [];
    return new Response(JSON.stringify({ status: 200, subject: 'physics', data }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  return { calls, provider: new AlocQuestionProvider(fetchImpl) };
}

const range = (from, to, make = valid) =>
  Array.from({ length: to - from + 1 }, (_, index) => make(from + index));

const query = (overrides = {}) => ({
  examBody: 'jamb', subjectSlug: 'physics', count: 20, requestType: 'practice', ...overrides,
});

test('a question that fails integrity is replaced, not subtracted', async () => {
  // Twenty candidates arrive, three of them orphaned; the top-up round supplies
  // three sound replacements.
  const first = [...range(1, 17), orphan(18), orphan(19), danglingPassage(20)];
  const { calls, provider } = upstream([first, range(21, 23)]);

  const result = await assembleDeliverableQuestions(provider, query());

  assert.equal(result.questions.length, 20, 'the student asked for twenty and must receive twenty');
  assert.equal(new Set(result.questions.map((q) => q.source.providerQuestionId)).size, 20, 'no duplicates');
  assert.equal(result.rejections.length, 3);
  assert.ok(calls.length >= 2, 'replacements were actually fetched');
  for (const question of result.questions) {
    assert.equal(['18', '19', '20'].includes(question.source.providerQuestionId), false);
  }
});

test('a replacement round asks only for the shortfall and excludes everything already seen', async () => {
  const first = [...range(1, 17), orphan(18), orphan(19), orphan(20)];
  const { calls, provider } = upstream([first, range(21, 23)]);

  await assembleDeliverableQuestions(provider, query());

  assert.equal(calls[0].path, '/api/v2/q/20', 'the first round asks for the full set');
  assert.equal(calls[1].path, '/api/v2/q/3', 'the top-up asks only for the three that were refused');
});

test('rejected questions are never re-fetched, so a bad record cannot loop', async () => {
  // The provider keeps offering the same orphan; it must be requested through
  // the exclusion list and counted once, not forever.
  const { calls, provider } = upstream([[...range(1, 19), orphan(99)], [orphan(99)], [valid(20)]]);
  const result = await assembleDeliverableQuestions(provider, query());

  assert.equal(result.questions.length, 20);
  assert.equal(result.rejections.filter((r) => r.providerQuestionId === '99').length, 1);
  assert.ok(calls.length <= MAX_INTEGRITY_TOPUP_ROUNDS + 1 + MAX_UPSTREAM_REQUESTS);
});

test('BOUNDED: bad inventory terminates and reports a shortage instead of looping', async () => {
  // Every round returns the same three orphaned questions, forever.
  const { calls, provider } = upstream([range(1, 3, orphan)]);
  const result = await assembleDeliverableQuestions(provider, query());

  assert.equal(result.questions.length, 0, 'a malformed question is never used to pad a session');
  assert.equal(result.rejections.length, 3, 'each distinct bad record is reported once');
  assert.ok(result.rounds <= MAX_INTEGRITY_TOPUP_ROUNDS + 1, `rounds must stay bounded, spent ${result.rounds}`);
  assert.ok(calls.length < 30, `upstream calls must stay bounded, spent ${calls.length}`);
});

test('BOUNDED: an exhausted pool stops after a single barren round', async () => {
  const { provider } = upstream([[]]);
  const result = await assembleDeliverableQuestions(provider, query());

  assert.equal(result.questions.length, 0);
  assert.equal(result.rounds, 1, 'nothing new arrived, so no replacement round is attempted');
});

test('admin-blocked questions stay excluded through every replacement round', async () => {
  const blocked = [{ provider: 'aloc', sourceQuestionId: '7' }];
  const { calls, provider } = upstream([[...range(1, 17), orphan(18), orphan(19), orphan(20)], range(21, 24)]);

  const result = await assembleDeliverableQuestions(provider, query(), blocked);

  assert.equal(result.questions.some((q) => q.source.providerQuestionId === '7'), false, 'a blocked question must never reach a session');
  assert.equal(result.rejections.some((r) => r.providerQuestionId === '7'), false, 'a block is not an integrity rejection');
  assert.ok(calls.length >= 2);
});

test('an explicit filter is never relaxed to top up a short session', async () => {
  const { calls, provider } = upstream([
    [...range(1, 5).map((item) => ({ ...item, examyear: '2016' })), orphan(6)],
    range(7, 9).map((item) => ({ ...item, examyear: '2016' })),
  ]);

  const result = await assembleDeliverableQuestions(provider, query({ count: 6, year: 2016 }));

  assert.equal(result.questions.length, 6);
  for (const call of calls) {
    assert.equal(call.year, '2016', 'every round must keep the requested year');
    assert.equal(call.subject, 'physics', 'every round must keep the requested subject');
    assert.equal(call.type, 'utme', 'every round must keep the requested exam');
  }
});

test('DIAGNOSTICS: a rejection identifies the question without exposing its answer', async () => {
  const { provider } = upstream([[valid(1), orphan(2), danglingPassage(3)]]);
  const result = await assembleDeliverableQuestions(provider, query({ count: 3 }));

  const byId = new Map(result.rejections.map((rejection) => [rejection.providerQuestionId, rejection]));
  assert.equal(byId.get('2').reason, 'orphan_fragment');
  assert.equal(byId.get('3').reason, 'missing_passage_context');
  for (const rejection of result.rejections) {
    assert.equal(rejection.provider, 'aloc');
    assert.equal(rejection.examBody, 'jamb');
    assert.equal(rejection.subjectSlug, 'physics');
    const serialized = JSON.stringify(rejection);
    assert.equal(serialized.includes('correctOptionKey'), false, 'a diagnostic never carries an answer key');
    assert.equal(/\buserId\b|\bstudent\b/i.test(serialized), false, 'a diagnostic never carries student identity');
  }
});

test('SECURITY: the delivered payload carries the instruction and withholds the key', async () => {
  const { provider } = upstream([[withInstruction(1), withInstruction(2)]]);
  const result = await assembleDeliverableQuestions(provider, query({ count: 2 }));
  const [first] = toStudentQuestions(result.questions);

  assert.equal(result.questions[0].correctOptionKey, 'C');
  assert.equal(first.instruction, 'In each of the following questions, choose the option opposite in meaning to the word given.');
  assert.equal('correctOptionKey' in first, false);
  assert.equal('explanation' in first, false);
  assert.equal(JSON.stringify(first).includes('correctOptionKey'), false);
});

test('both session engines freeze questions through the one guarded entry point', () => {
  // The guard is worthless if an engine can reach a provider around it, and
  // Practice and Mock must not drift into two different rules.
  const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  for (const path of ['features/practice/service.ts', 'features/exams/service.ts']) {
    const text = source(path);
    assert.match(text, /fetchCanonicalQuestions/, `${path} must use the shared question service`);
    assert.doesNotMatch(text, /getQuestionProvider|providers\//, `${path} must not reach a provider directly`);
    assert.doesNotMatch(text, /checkQuestionIntegrity/, `${path} must not carry its own copy of the integrity rule`);
  }
});

test('an integrity rejection is not a permanent block, and stays visible to an admin', () => {
  const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

  // A provider hiccup must not silently create a permanent admin block: the
  // blocklist stays a human decision.
  const service = source('features/questions/service.ts');
  assert.doesNotMatch(service, /question_blocks/, 'the delivery path never writes to the blocklist');
  assert.doesNotMatch(service, /\.insert\(/, 'the delivery path never records a block');

  // It is still diagnosable: the admin inspector reports the verdict for the
  // exact snapshot a student was served.
  assert.match(source('features/admin/questions.ts'), /checkQuestionIntegrity/);
});
