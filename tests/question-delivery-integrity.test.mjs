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

/* ────────────────────────────────────────────────────────────────────
 * Malformed mathematical context
 *
 * ALOC Station's `section` carries a MathJax MathML document for much of the
 * Mathematics catalogue. Flattened to plain text it becomes an unreadable
 * vertical stack, and for thirteen distinct live records it is the *worked
 * solution*, ending in the correct option. None of it may be shown; whether the
 * question survives without it is decided by the integrity rules that already
 * exist, not by a new guess about what maths a prompt needs.
 * ──────────────────────────────────────────────────────────────── */

const mathml = (body) => `<math xmlns="http://www.w3.org/1998/Math/MathML">\n${body}\n</math>`;

/** The exact 2004 production record: prompt self-contained, section = the answer. */
const workedSolution = (id) => ({
  id,
  question: 'Find the midpoint of the line joining P(-3, 5) and Q(5, -3).',
  option: { a: '(1, 1)', b: '(2, 2)', c: '(4, 4)', d: '(4, -4)' },
  answer: 'a',
  examyear: '2004',
  section: mathml('  <mi>M</mi>\n  <mi>i</mi>\n  <mi>d</mi>\n  <mi>p</mi>\n  <mi>o</mi>\n  <mi>i</mi>\n  <mi>n</mi>\n  <mi>t</mi>\n  <mo>=</mo>\n  <mo stretchy="false">(</mo>\n  <mn>1</mn>\n  <mo>,</mo>\n  <mn>1</mn>\n  <mo stretchy="false">)</mo>'),
});

/** The exact 2016 production record: the section merely repeats the prompt. */
const duplicatedFraction = (id) => ({
  id,
  question: 'Evaluate (12.02×20.06)/(26.04×60.06)\n, correct to three significant figures.',
  option: { a: '0.157', b: '0.154', c: '0.155', d: '0.158' },
  answer: 'b',
  examyear: '2016',
  section: mathml('  <mfrac>\n    <mrow>\n      <mn>12.02</mn>\n      <mo>&#x00D7;<!-- × --></mo>\n      <mn>20.06</mn>\n    </mrow>\n    <mrow>\n      <mn>26.04</mn>\n      <mo>&#x00D7;<!-- × --></mo>\n      <mn>60.06</mn>\n    </mrow>\n  </mfrac>'),
});

/**
 * The 2011 production record: the section *was* the table, and the prompt
 * cannot be answered without it. Nothing can reconstruct an `<mtable>` from a
 * column of single characters, so this question must be refused.
 */
const destroyedTable = (id) => ({
  id,
  question: 'Find the standard deviation of the above distribution.',
  option: { a: '2.4', b: '2.5', c: '2.6', d: '2.7' },
  answer: 'a',
  examyear: '2011',
  // Pretty-printed exactly as the provider sends it: one element per line, and
  // one `<mi>` per character, because a multi-letter name in TeX maths mode is
  // a product of single-letter identifiers.
  section: mathml('  <mtable>\n    <mtr>\n      <mtd>\n        <mi>C</mi>\n        <mi>l</mi>\n        <mi>a</mi>\n        <mi>s</mi>\n        <mi>s</mi>\n      </mtd>\n    </mtr>\n  </mtable>'),
});

test('a worked solution in the context field never reaches the student', async () => {
  const { provider } = upstream([[...range(1, 19), workedSolution(50)]]);
  const result = await assembleDeliverableQuestions(provider, query());

  const question = result.questions.find((q) => q.source.providerQuestionId === '50');
  assert.ok(question, 'the prompt is self-contained, so the question is still deliverable');
  assert.equal(question.passage, null, 'the solution must not be shown as context');
  assert.equal(question.instruction, null, 'nor smuggled in as an instruction');

  const [student] = toStudentQuestions([question]);
  const visible = JSON.stringify(student);
  assert.ok(!visible.includes('Midpoint'), 'the solution label leaked into the student payload');
  assert.ok(!/\(\s*1\s*,\s*1\s*\)[^"]*"[^"]*$/.test(''), 'guard placeholder');
  // The answer text appears once, as option A. It must not appear a second time.
  assert.equal(visible.split('(1, 1)').length - 1, 1, 'the answer appeared outside the option list');
});

test('context that merely repeats the prompt is not shown as a passage', async () => {
  const { provider } = upstream([[...range(1, 19), duplicatedFraction(51)]]);
  const result = await assembleDeliverableQuestions(provider, query());

  const question = result.questions.find((q) => q.source.providerQuestionId === '51');
  assert.ok(question, 'the question is answerable from its own prompt');
  assert.equal(question.passage, null);
  assert.ok(question.prompt.includes('12.02'), 'the prompt itself keeps the expression');
  assert.equal(question.discardedContext.kind, 'duplicate');
});

test('an irreparably malformed required context rejects the question and is topped up', async () => {
  const { calls, provider } = upstream([[...range(1, 19), destroyedTable(52)], [valid(60)]]);
  const result = await assembleDeliverableQuestions(provider, query());

  assert.equal(result.questions.length, 20, 'the student still receives twenty');
  assert.ok(!result.questions.some((q) => q.source.providerQuestionId === '52'), 'the broken question was not served');
  assert.equal(result.rejections.length, 1);
  assert.equal(result.rejections[0].providerQuestionId, '52');
  assert.equal(result.rejections[0].reason, 'malformed_context',
    'the reason must say the context was broken, not that it was never sent');
  assert.ok(calls.length >= 2, 'the replacement was fetched');
  // No cross-provider fallback: the top-up asks the same provider again. A
  // single-question round uses `/q` rather than `/q/1`, so both shapes count.
  assert.ok(calls.every((call) => call.path.startsWith('/api/v2/q')), 'a different provider was called');
  assert.equal(calls[1].subject, 'physics', 'the top-up kept the requested subject');
});

test('discarding context never changes an answer key', async () => {
  const { provider } = upstream([[workedSolution(53), duplicatedFraction(54), ...range(1, 18)]]);
  const result = await assembleDeliverableQuestions(provider, query());

  assert.equal(result.questions.find((q) => q.source.providerQuestionId === '53').correctOptionKey, 'A');
  assert.equal(result.questions.find((q) => q.source.providerQuestionId === '54').correctOptionKey, 'B');
  for (const question of result.questions) {
    assert.equal(question.options.length, 4, 'the option list is untouched');
  }
});

test('a genuine passage is still delivered beside the malformed ones', async () => {
  const passage = {
    id: 55,
    question: 'According to the passage above, the narrator was',
    option: { a: 'angry', b: 'calm', c: 'tired', d: 'afraid' },
    answer: 'b',
    hasPassage: 1,
    section: 'The rain had not stopped for three days, and the road to the market had become a river of mud that swallowed every cart that tried it.',
  };
  const { provider } = upstream([[...range(1, 18), workedSolution(56), passage]]);
  const result = await assembleDeliverableQuestions(provider, query());

  const kept = result.questions.find((q) => q.source.providerQuestionId === '55');
  assert.ok(kept.passage, 'a real passage must survive the same pipeline');
  assert.match(kept.passage.body, /river of mud/);
  assert.equal(kept.passage.kind, 'passage');
});
