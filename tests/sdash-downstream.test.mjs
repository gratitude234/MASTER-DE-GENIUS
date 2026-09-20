import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

/**
 * Everything downstream of delivery, for a question that came from Sdash.
 *
 * The point of normalizing at the provider boundary is that nothing after it
 * needs to know where a question came from. These tests take real Sdash records
 * through the real adapter and then hand the results to the grading engine, the
 * mistake bank and the AI prompt builder — none of which was changed for this
 * milestone, which is exactly what is being checked.
 */

process.env.SDASH_API_KEY = 'sdash-test-key-never-logged';
process.env.SDASH_BASE_URL = 'https://sdash.test/api/v1';
process.env.SDASH_SANDBOX = 'true';

const { SdashQuestionProvider } = await import('../features/questions/providers/sdash/index.ts');
const { toStudentQuestion, toStudentQuestions } = await import('../features/questions/delivery.ts');
const { grade, outcome, mistakeBank, breakdown } = await import('../features/results/grading.ts');
const { buildQuestionExplanationPrompt } = await import('../features/ai/prompts/question-explanation.ts');

console.info = () => {};
const silentUsage = async () => {};

const record = (id, overrides = {}) => ({
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

/** Fetches through the real adapter, so nothing here is a hand-built fixture. */
async function fetchSdash(records, count = records.length) {
  const provider = new SdashQuestionProvider(
    async () => new Response(JSON.stringify({ status: 200, data: records }), { status: 200 }),
    silentUsage,
  );
  return provider.fetchQuestions({
    examBody: 'waec', subjectSlug: 'biology', count, requestType: 'practice',
  });
}

/** The review item shape the results layer builds from a frozen snapshot. */
const reviewItem = (question, selected, position = 1) => ({
  id: question.id,
  position,
  question: toStudentQuestion(question),
  selected,
  correct: question.correctOptionKey,
  explanation: question.explanation,
  outcome: outcome(selected, question.correctOptionKey),
  flagged: false,
});

/* ────────────────────────────────────────────────────  Q. grading and results */

test('Q: a Sdash question scores exactly like any other', async () => {
  const questions = await fetchSdash([record(1), record(2), record(3)]);
  const items = [
    reviewItem(questions[0], 'A', 1),     // correct
    reviewItem(questions[1], 'C', 2),     // incorrect
    reviewItem(questions[2], null, 3),    // unanswered
  ];

  const result = grade(items, false);
  assert.deepEqual(
    [result.correct, result.incorrect, result.unanswered, result.score, result.maximum, result.accuracy],
    [1, 1, 1, 1, 3, 33],
  );
});

test('Q: scoring is server-authoritative — the provider never supplies the verdict', async () => {
  const [question] = await fetchSdash([record(1, { answer: 'c' })]);

  // The key came from the provider record but lives only on the canonical
  // question, which the browser never receives.
  assert.equal(question.correctOptionKey, 'C');
  const student = toStudentQuestion(question);
  assert.equal('correctOptionKey' in student, false);
  assert.equal(grade([reviewItem(question, 'C')], false).correct, 1);
  assert.equal(grade([reviewItem(question, 'A')], false).incorrect, 1);
});

test('Q: review shows the answer and explanation the session froze', async () => {
  const [question] = await fetchSdash([record(4821)]);
  const item = reviewItem(question, 'B');

  assert.equal(item.outcome, 'incorrect');
  assert.equal(item.correct, 'A');
  assert.equal(item.explanation, 'Ribosomes assemble amino acids into polypeptide chains.');
  assert.deepEqual(item.question.options.map((option) => option.key), ['A', 'B', 'C', 'D']);
  assert.equal(item.question.instruction, null);
});

test('Q: subject breakdown groups Sdash questions under the MASTER subject slug', async () => {
  const questions = await fetchSdash([record(1), record(2)]);
  const [row] = breakdown([reviewItem(questions[0], 'A', 1), reviewItem(questions[1], 'B', 2)], false);

  assert.equal(row.subjectSlug, 'biology');
  assert.equal(row.name, 'Biology');
  assert.equal(row.total, 2);
  assert.equal(row.correct, 1);
});

/* ───────────────────────────────────────────────────────────  R. mistake bank */

test('R: an incorrect Sdash question is stored and can be mastered', async () => {
  const questions = await fetchSdash([record(4821)]);
  const [question] = questions;
  const result = (id, selected, completedAt) => ({
    id, kind: 'practice', completedAt, examBodyId: 'waec-id',
    items: [reviewItem(question, selected)],
    ...grade([reviewItem(question, selected)], false),
  });

  const wrong = result('a', 'B', '2026-01-01');
  const first = result('b', 'A', '2026-01-02');
  const second = result('c', 'A', '2026-01-03');

  const afterOne = mistakeBank([wrong, first]);
  assert.equal(afterOne.length, 1, 'the mistake is banked');
  assert.equal(afterOne[0].failures, 1);
  assert.equal(afterOne[0].mastered, false);

  const afterTwo = mistakeBank([wrong, first, second]);
  assert.equal(afterTwo[0].mastered, true, 'two clean repeats master it, exactly as for any provider');
});

test('R: a Sdash id and an ALOC id that collide stay separate mistakes', async () => {
  const [sdashQuestion] = await fetchSdash([record(42)]);
  const alocLookalike = {
    ...toStudentQuestion(sdashQuestion),
    source: { provider: 'aloc_station', providerQuestionId: '42' },
  };

  const items = [
    reviewItem(sdashQuestion, 'B', 1),
    { ...reviewItem(sdashQuestion, 'B', 2), id: 'aloc-42', question: alocLookalike },
  ];
  const result = {
    id: 'a', kind: 'practice', completedAt: '2026-01-01', examBodyId: 'waec-id', items,
    ...grade(items, false),
  };

  assert.equal(mistakeBank([result]).length, 2, 'provider identity is part of a question’s identity');
});

/* ────────────────────────────────────────────────────  AI explanation context */

test('the AI prompt is built from the canonical shape, with no Sdash field names', async () => {
  const [question] = await fetchSdash([record(4821, {
    section: 'In each of the following questions, choose the option nearest in meaning to the word given.',
  })]);

  const prompt = buildQuestionExplanationPrompt({
    question: toStudentQuestion(question),
    correctOptionKey: question.correctOptionKey,
    selectedOptionKey: 'B',
    standardExplanation: question.explanation,
  }, 'why_wrong');

  assert.match(prompt, /"examination":"waec"/);
  assert.match(prompt, /"subject":"Biology"/);
  assert.match(prompt, /"verifiedCorrectOptionKey":"A"/);
  assert.match(prompt, /choose the option nearest in meaning/, 'the instruction travels with the question');
  assert.equal(/examtype|examyear|"option":|"solution":/.test(prompt), false,
    'no provider field name reaches the model');
  assert.equal(prompt.includes('sdash-test-key'), false);
});

/* ──────────────────────────────────────────  frozen snapshot and secrecy */

test('P/O: the frozen snapshot is complete, stable and answer-free', async () => {
  const questions = await fetchSdash([record(1), record(2, { image: 'https://cdn.sdash.test/2.png' })]);
  const snapshots = toStudentQuestions(questions);

  for (const snapshot of snapshots) {
    // Everything the student needs to answer survives the freeze...
    assert.ok(snapshot.prompt);
    assert.ok(snapshot.options.length >= 2);
    assert.equal(snapshot.examBody, 'waec');
    assert.equal(snapshot.subject.slug, 'biology');
    assert.equal(snapshot.year, 2018);
    // ...and nothing that would give the answer away does.
    assert.equal('correctOptionKey' in snapshot, false);
    assert.equal('explanation' in snapshot, false);
    assert.equal(JSON.stringify(snapshot).includes('Ribosomes assemble'), false);
  }

  // Source identity is preserved, which is what the admin inspector and the
  // blocklist key on.
  assert.deepEqual(snapshots.map((snapshot) => snapshot.source.provider), ['sdash', 'sdash']);
  assert.deepEqual(snapshots.map((snapshot) => snapshot.source.providerQuestionId), ['1', '2']);
  assert.equal(snapshots[1].assets[0].url, 'https://cdn.sdash.test/2.png');

  // A refresh or resume re-reads the same JSON, so it must round-trip exactly.
  assert.deepEqual(JSON.parse(JSON.stringify(snapshots)), snapshots);
});
