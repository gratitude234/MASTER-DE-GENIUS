import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

const { checkQuestionIntegrity, isDeliverableQuestion, isLexicalFragment } =
  await import('../features/questions/integrity.ts');
const { normalizeAlocQuestion, normalizeSection } =
  await import('../features/questions/providers/aloc/normalize.ts');
const { normalizeStationQuestion } =
  await import('../features/questions/providers/aloc-station/normalize.ts');
const { toStudentQuestion } = await import('../features/questions/delivery.ts');

const question = (overrides = {}) => ({
  prompt: 'Which quantity is a vector?',
  instruction: null,
  passage: null,
  assets: [],
  options: [{ text: 'Speed' }, { text: 'Velocity' }],
  ...overrides,
});

const asset = { id: 'aloc:1:image' };
const passage = { body: 'The rain had not stopped for three days, and the road to the market had become a river of mud.' };

const reject = (overrides, reason) => {
  const result = checkQuestionIntegrity(question(overrides));
  assert.equal(result.valid, false, `expected a rejection for: ${overrides.prompt}`);
  assert.equal(result.reason, reason);
  return result;
};

const accept = (overrides) => {
  const result = checkQuestionIntegrity(question(overrides));
  assert.equal(result.valid, true, `unexpectedly rejected (${result.reason}): ${overrides.prompt}`);
};

// ---------------------------------------------------------------------------
// Missing textual context
// ---------------------------------------------------------------------------

test('a prompt quoting a passage that is not there is rejected', () => {
  reject({ prompt: 'According to the passage above, the narrator felt' }, 'missing_passage_context');
  reject({ prompt: 'From the extract above, the writer suggests that' }, 'missing_passage_context');
  reject({ prompt: 'The tone of the poem above is best described as' }, 'missing_passage_context');
});

test('REGRESSION: the observed live orphan quotation question is rejected', () => {
  // Served in production with no quotation anywhere on screen.
  reject({ prompt: "The image in the quotation above depicts the speaker's" }, 'missing_passage_context');
});

test('the same prompt is accepted once the passage travels with it', () => {
  accept({ prompt: 'According to the passage above, the narrator felt', passage });
  accept({ prompt: "The image in the quotation above depicts the speaker's", passage });
});

test('an instruction that quotes a missing passage is caught too', () => {
  reject({ prompt: 'He felt relieved', instruction: 'Read the passage above and answer the question.' }, 'missing_passage_context');
});

// ---------------------------------------------------------------------------
// Missing visual context
// ---------------------------------------------------------------------------

test('a prompt describing a diagram that was never delivered is rejected', () => {
  reject({ prompt: 'The diagram above shows a simple pendulum. Its period is' }, 'missing_referenced_asset');
  reject({ prompt: 'From the graph below, the acceleration of the body is' }, 'missing_referenced_asset');
  for (const noun of ['figure', 'table', 'map', 'illustration', 'image', 'picture']) {
    reject({ prompt: `In the ${noun} above, the labelled part X is` }, 'missing_referenced_asset');
  }
});

test('the same prompt is accepted when the asset is present', () => {
  accept({ prompt: 'The diagram above shows a simple pendulum. Its period is', assets: [asset] });
  accept({ prompt: 'From the graph below, the acceleration of the body is', assets: [asset] });
});

test('a passage does not stand in for a missing diagram', () => {
  reject({ prompt: 'The diagram above shows a simple pendulum. Its period is', passage }, 'missing_referenced_asset');
});

// ---------------------------------------------------------------------------
// Generic and ambiguous references
// ---------------------------------------------------------------------------

test('a bare backwards reference needs some context to point at', () => {
  reject({ prompt: 'From the above, the correct conclusion is' }, 'missing_referenced_context');
  reject({ prompt: 'The reaction shown above is an example of' }, 'missing_referenced_context');
  reject({ prompt: 'Which of the statements above is correct?' }, 'missing_referenced_context');
  accept({ prompt: 'From the above, the correct conclusion is', passage });
  accept({ prompt: 'The reaction shown above is an example of', assets: [asset] });
});

test('"above" and "below" in ordinary prose are never mistaken for references', () => {
  accept({ prompt: 'Water boils at a temperature above 99°C at sea level because' });
  accept({ prompt: 'A reading below zero on the Celsius scale indicates' });
  accept({ prompt: 'Which of the statements below is true of an ideal gas?' });
  accept({ prompt: 'Complete the sentence below', instruction: 'Choose the option that best completes the sentence below.' });
});

// ---------------------------------------------------------------------------
// Underlined expressions
// ---------------------------------------------------------------------------

test('an underlined expression inside a sentence cannot be identified, so it is rejected', () => {
  reject(
    {
      prompt: 'The principal described the boy as a mischievous child who needed guidance',
      instruction: 'Choose the option nearest in meaning to the underlined word.',
    },
    'missing_underlined_context',
  );
  reject({ prompt: 'Choose the option opposite in meaning to the underlined expression in the sentence' }, 'missing_underlined_context');
});

test('an underlined instruction is fine when the prompt is itself the expression', () => {
  accept({ prompt: 'mischief', instruction: 'Choose the option opposite in meaning to the underlined word(s).' });
  accept({ prompt: 'a piece of cake', instruction: 'Choose the option nearest in meaning to the underlined expression.' });
});

// ---------------------------------------------------------------------------
// Orphan fragments
// ---------------------------------------------------------------------------

test('REGRESSION: a bare lexical fragment with no instruction is rejected', () => {
  // Served in production as: "mischief" / A. Christmas B. ritual C. Brochure D. Champagne
  reject(
    { prompt: 'mischief', options: [{ text: 'Christmas' }, { text: 'ritual' }, { text: 'Brochure' }, { text: 'Champagne' }] },
    'orphan_fragment',
  );
  reject({ prompt: 'photosynthesis' }, 'orphan_fragment');
  reject({ prompt: 'wild goose chase' }, 'orphan_fragment');
});

test('the same fragment is accepted once its instruction travels with it', () => {
  accept({ prompt: 'mischief', instruction: 'Choose the option opposite in meaning to the word given.' });
  accept({ prompt: 'mischief', passage });
});

test('short but self-contained questions are never rejected for being short', () => {
  accept({ prompt: '2 + 2 = ?' });
  accept({ prompt: 'Simplify 3x + 6x' });
  accept({ prompt: 'What is osmosis?' });
  accept({ prompt: 'The capital of Nigeria is' });
  accept({ prompt: 'Name the process.' });
  accept({ prompt: 'He ____ to school every day' });
  accept({ prompt: 'Evaluate log₁₀ 100' });
  accept({ prompt: 'H₂SO₄ is a strong' });
});

test('the fragment heuristic is documented by its own unit checks', () => {
  assert.equal(isLexicalFragment('mischief'), true);
  assert.equal(isLexicalFragment('  '), true);
  assert.equal(isLexicalFragment('2 + 2 = ?'), false, 'mathematics is never a fragment');
  assert.equal(isLexicalFragment('What is osmosis?'), false, 'a question carries its own task');
  assert.equal(isLexicalFragment('Name the process'), false, 'an imperative carries its own task');
  assert.equal(isLexicalFragment('The boy walked slowly to the market'), false, 'a sentence is not a fragment');
  assert.equal(isLexicalFragment('He ____ to school'), false, 'a blank is a task');
});

// ---------------------------------------------------------------------------
// The validator works on canonical questions, student snapshots and every provider
// ---------------------------------------------------------------------------

test('the check accepts the canonical shape and the student snapshot alike', () => {
  const { question: canonical } = normalizeAlocQuestion({
    id: 77,
    question: 'mischief',
    option: { a: 'Christmas', b: 'ritual', c: 'goodness', d: 'Champagne' },
    answer: 'c',
    section: 'In each of the following questions, choose the option opposite in meaning to the word given.',
    hasPassage: 0,
  }, { examBody: 'jamb', subjectSlug: 'use-of-english', subjectName: 'Use of English' });

  assert.equal(isDeliverableQuestion(canonical), true);
  assert.equal(isDeliverableQuestion(toStudentQuestion(canonical)), true);
});

test('internal questions are protected by the same rule', () => {
  // The internal provider builds the same canonical shape, so the guard needs no
  // provider-specific branch: a passage-less passage question fails identically.
  const internal = {
    prompt: 'According to the passage above, the writer was',
    passage: null,
    assets: [],
    options: [{ text: 'angry' }, { text: 'calm' }],
  };
  assert.equal(isDeliverableQuestion(internal), false);
  assert.equal(isDeliverableQuestion({ ...internal, passage }), true);
});

test('a Station question keeps its instruction and passes the check', () => {
  const { question: station } = normalizeStationQuestion({
    id: 'station-9',
    text: 'mischief',
    section: 'From the words lettered A to D, choose the word opposite in meaning to the word given.',
    options: { a: 'Christmas', b: 'ritual', c: 'goodness', d: 'Champagne' },
    correctAnswer: 'c',
  }, { examBody: 'waec', subjectSlug: 'use-of-english', subjectName: 'Use of English' });

  assert.ok(station.instruction);
  assert.equal(station.passage, null);
  assert.equal(isDeliverableQuestion(station), true);
});

test('normalizeSection never invents context it was not given', () => {
  assert.deepEqual(normalizeSection(null), { instruction: null, passage: null });
  assert.deepEqual(normalizeSection(''), { instruction: null, passage: null });
  assert.deepEqual(normalizeSection('   '), { instruction: null, passage: null });
});

test('an italicised expression inside a sentence is as unanswerable as an underlined one', () => {
  // JAMB and WAEC both use italics for the task ALOC marks with <u>; the markup
  // is stripped either way, so the referenced word cannot be identified.
  reject(
    {
      prompt: 'The principal described the boy as a mischievous child who needed guidance',
      instruction: 'Select the option that is nearest in meaning to the word in italics.',
    },
    'missing_underlined_context',
  );
  accept({ prompt: 'mischievous', instruction: 'Select the option that is nearest in meaning to the word in italics.' });
});
