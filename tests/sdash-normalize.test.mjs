import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

/**
 * Turning one raw Sdash V1 record into a canonical MASTER question.
 *
 * The rules here are deliberately the same rules the ALOC adapters use — the
 * text cleaner, the option/answer resolver and the instruction/passage
 * classifier are imported, not reimplemented — because Practice must behave
 * identically whichever provider a subject happens to route to. These tests
 * exist to prove that a second copy has not quietly appeared.
 */

const { normalizeSdashQuestion } = await import('../features/questions/providers/sdash/normalize.ts');
const { checkQuestionIntegrity } = await import('../features/questions/integrity.ts');

const context = {
  examBody: 'waec',
  subjectSlug: 'biology',
  subjectName: 'Biology',
  examType: 'wassce',
};

const record = (overrides = {}) => ({
  id: 4821,
  question: 'Which organelle carries out protein synthesis?',
  section: null,
  option: { a: 'Ribosome', b: 'Lysosome', c: 'Golgi body', d: 'Vacuole' },
  answer: 'a',
  solution: 'Ribosomes assemble amino acids into polypeptide chains.',
  image: null,
  examtype: 'WASSCE',
  examyear: '2018',
  ...overrides,
});

const normalize = (overrides) => normalizeSdashQuestion(record(overrides), context);

/* ───────────────────────────────────────────────────────────  D. the shape */

test('D: a realistic payload becomes a complete canonical question', () => {
  const { question, discarded } = normalize();
  assert.equal(discarded, undefined);

  assert.equal(question.id, 'sdash:waec:biology:4821');
  assert.deepEqual(question.source, {
    provider: 'sdash', providerQuestionId: '4821', internalQuestionId: null,
  });
  assert.equal(question.examBody, 'waec');
  assert.deepEqual(question.subject, { id: 'biology', slug: 'biology', name: 'Biology' });
  assert.equal(question.prompt, 'Which organelle carries out protein synthesis?');
  assert.equal(question.correctOptionKey, 'A');
  assert.equal(question.explanation, 'Ribosomes assemble amino acids into polypeptide chains.');
  assert.equal(question.year, 2018);

  // Nothing is invented for a field V1 does not carry.
  assert.equal(question.topic, null);
  assert.equal(question.difficulty, null);
  assert.equal(question.instruction, null);
  assert.equal(question.passage, null);
  assert.deepEqual(question.assets, []);
});

test('D: the MASTER subject slug is preserved; the Sdash spelling never appears', () => {
  const { question } = normalizeSdashQuestion(record(), {
    ...context, subjectSlug: 'agricultural-science', subjectName: 'Agricultural Science',
  });

  assert.equal(question.subject.slug, 'agricultural-science');
  const serialized = JSON.stringify(question);
  assert.equal(/\bagriculture\b/.test(serialized), false, 'the vendor identifier stops at the adapter');
  assert.equal(/examtype|examyear|solution"|"option"/.test(serialized), false,
    'no Sdash field name leaks into the canonical shape');
});

test('D: a missing solution becomes null rather than an empty string', () => {
  assert.equal(normalize({ solution: null }).question.explanation, null);
  assert.equal(normalize({ solution: '   ' }).question.explanation, null);
  assert.equal(normalize({ solution: undefined }).question.explanation, null);
});

/* ───────────────────────────────────────────────────────────  F. options */

test('F: lower-case Sdash keys become canonical A-E', () => {
  const { question } = normalize();
  assert.deepEqual(question.options.map((option) => option.key), ['A', 'B', 'C', 'D']);
  assert.deepEqual(question.options.map((option) => option.text), ['Ribosome', 'Lysosome', 'Golgi body', 'Vacuole']);
  assert.deepEqual(question.options.map((option) => option.id), [
    'sdash:4821:A', 'sdash:4821:B', 'sdash:4821:C', 'sdash:4821:D',
  ]);
});

test('F: a fifth option is carried when present', () => {
  const { question } = normalize({
    option: { a: 'One', b: 'Two', c: 'Three', d: 'Four', e: 'Five' },
    answer: 'e',
  });
  assert.deepEqual(question.options.map((option) => option.key), ['A', 'B', 'C', 'D', 'E']);
  assert.equal(question.correctOptionKey, 'E');
});

test('F: an empty or absent option is dropped, and fewer than two is a rejection', () => {
  // A null fifth option is normal and must not invalidate the record.
  assert.equal(normalize({ option: { a: 'One', b: 'Two', c: null, d: '' } }).question.options.length, 2);

  assert.equal(normalize({ option: { a: 'Only one' } }).discarded, 'too_few_options');
  assert.equal(normalize({ option: {} }).discarded, 'too_few_options');
  assert.equal(normalize({ option: null }).discarded, 'invalid_structure');
  assert.equal(normalize({ option: 'Ribosome' }).discarded, 'invalid_structure');
});

test('F: duplicate keys are rejected rather than silently collapsed', () => {
  // Two spellings of the same key would make one option unreachable, and which
  // text survived would depend on iteration order.
  const { discarded } = normalize({ option: { a: 'Ribosome', A: 'Lysosome', b: 'Golgi body' } });
  assert.equal(discarded, 'duplicate_option_key');
});

test('F: an unrecognisable option key is ignored, not guessed at', () => {
  assert.equal(normalize({ option: { z: 'One', y: 'Two' } }).discarded, 'too_few_options');
});

/* ────────────────────────────────────────────────────────────  G. answers */

test('G: a letter answer resolves, in any casing or decoration', () => {
  for (const answer of ['b', 'B', 'b)', 'B.', 'option b']) {
    assert.equal(normalize({ answer }).question.correctOptionKey, 'B', `"${answer}" must resolve`);
  }
});

test('G: an answer given as option text resolves only when it is unambiguous', () => {
  assert.equal(normalize({ answer: 'Golgi body' }).question.correctOptionKey, 'C');
  assert.equal(
    normalize({ option: { a: 'Same', b: 'Same', c: 'Other', d: 'Another' }, answer: 'Same' }).discarded,
    'unresolved_answer',
    'two identical texts make the key unknowable, so the question is discarded',
  );
});

test('G: an unresolvable answer is never guessed', () => {
  for (const answer of [null, '', '   ', 'z', 'Mitochondrion', 42]) {
    assert.equal(normalize({ answer }).discarded, 'unresolved_answer', `"${answer}" must not produce a key`);
  }
});

/* ───────────────────────────────────────────────────────────────  H. year */

test('H: a WASSCE year arrives as a string and normalizes to a number', () => {
  assert.equal(normalize({ examyear: '2012' }).question.year, 2012);
  assert.equal(normalize({ examyear: 2025 }).question.year, 2025);
});

test('H: an unusable year becomes null rather than a wrong number', () => {
  for (const examyear of [null, '', 'unknown', '18', '3050']) {
    assert.equal(normalize({ examyear }).question.year, null, `"${examyear}" must not become a year`);
  }
});

/* ─────────────────────────────────────────────  I. instruction vs passage */

test('I: rubric text in `section` becomes an instruction, not a passage', () => {
  const { question } = normalize({
    question: 'photosynthesis',
    section: 'In each of the following questions, choose the option nearest in meaning to the word given.',
  });

  assert.match(question.instruction, /choose the option nearest in meaning/);
  assert.equal(question.passage, null, 'a rubric is never rendered as source material');
  // And the instruction is what keeps the bare prompt answerable.
  assert.equal(checkQuestionIntegrity(question).valid, true);
});

test('I: genuine source material in `section` becomes a passage', () => {
  const body =
    'The rainforest canopy intercepts most of the incoming light, so the plants of the forest floor ' +
    'have broad, thin leaves adapted to the dim conditions beneath it.';
  const { question } = normalize({
    question: 'According to the passage above, forest-floor plants have leaves that are',
    section: body,
    option: { a: 'broad and thin', b: 'narrow and thick', c: 'waxy', d: 'absent' },
    answer: 'a',
  });

  assert.equal(question.passage.body, body);
  assert.equal(question.instruction, null);
  assert.equal(checkQuestionIntegrity(question).valid, true, 'the passage it quotes is present');
});

test('I: the classifier is the shared one — a bare section is never invented into a passage', () => {
  // Too short to be source material and not rubric-shaped: it becomes neither,
  // exactly as the ALOC adapters behave.
  const { question } = normalize({ section: 'Biology' });
  assert.equal(question.passage, null);
  assert.equal(question.instruction, null);
});

/* ────────────────────────────────────────────────  J. missing context */

test('J: a prompt that quotes a missing passage is refused by the shared validator', () => {
  const { question } = normalize({
    question: 'According to the passage above, the narrator felt',
    section: null,
    option: { a: 'angry', b: 'calm', c: 'tired', d: 'afraid' },
    answer: 'b',
  });

  // The record itself is well formed — this is not a normalization failure.
  assert.equal(question.prompt, 'According to the passage above, the narrator felt');
  const verdict = checkQuestionIntegrity(question);
  assert.equal(verdict.valid, false);
  assert.equal(verdict.reason, 'missing_passage_context');
});

test('J: a prompt that needs a diagram it did not receive is refused', () => {
  const { question } = normalize({
    question: 'In the diagram above, the structure labelled X is the',
    image: null,
  });

  const verdict = checkQuestionIntegrity(question);
  assert.equal(verdict.valid, false);
  assert.equal(verdict.reason, 'missing_referenced_asset');
});

test('J: an orphaned fragment with nothing to explain it is refused', () => {
  const { question } = normalize({ question: 'osmosis', section: null });
  assert.equal(checkQuestionIntegrity(question).reason, 'orphan_fragment');
});

test('J: the same question with its diagram delivered is accepted', () => {
  const { question } = normalize({
    question: 'In the diagram above, the structure labelled X is the',
    image: 'https://cdn.sdash.test/q/4821.png',
  });

  assert.equal(question.assets.length, 1);
  assert.equal(checkQuestionIntegrity(question).valid, true);
});

/* ─────────────────────────────────────────────────────────────  K. assets */

test('K: a valid image becomes a canonical asset with a deterministic id', () => {
  const { question } = normalize({ image: 'https://cdn.sdash.test/q/4821.png' });
  assert.deepEqual(question.assets, [{
    id: 'sdash:4821:image',
    kind: 'image',
    url: 'https://cdn.sdash.test/q/4821.png',
    altText: null,
    caption: null,
  }]);

  // Deterministic: the same record twice produces the same asset id, so a
  // resumed session renders identically.
  assert.equal(normalize({ image: 'https://cdn.sdash.test/q/4821.png' }).question.assets[0].id, 'sdash:4821:image');
});

test('K: nothing is fabricated from a missing or unusable image', () => {
  for (const image of [null, undefined, '', '   ', 'not-a-url', '/relative/path.png', 'javascript:alert(1)', 'data:image/png;base64,AAA', 42]) {
    assert.deepEqual(normalize({ image }).question.assets, [], `"${image}" must not become an asset`);
  }
});

test('K: alt text and caption stay null rather than being written for the provider', () => {
  const [asset] = normalize({ image: 'https://cdn.sdash.test/q/1.png' }).question.assets;
  assert.equal(asset.altText, null);
  assert.equal(asset.caption, null);
});

test('K: a plain-HTTP image is refused rather than admitted as an unrenderable asset', () => {
  // The product is served over HTTPS and hands the URL straight to the browser,
  // so an http:// image is blocked as mixed content and shows nothing. Admitting
  // it would satisfy the visual-dependency check while the student still saw no
  // diagram — the precise failure this suite exists to prevent. Refusing it
  // leaves the question with no asset, so the integrity validator replaces it.
  assert.deepEqual(normalize({ image: 'http://cdn.sdash.test/q/1.png' }).question.assets, []);
});

/* ──────────────────────────────────────────────  structural rejections */

test('a malformed record is rejected individually and never throws', () => {
  for (const [raw, reason] of [
    [null, 'invalid_structure'],
    [undefined, 'invalid_structure'],
    ['a string', 'invalid_structure'],
    [[], 'invalid_structure'],
    [{}, 'missing_id'],
    [{ id: '   ' }, 'missing_id'],
    [{ id: 1 }, 'empty_prompt'],
    [{ id: 1, question: '   ' }, 'empty_prompt'],
  ]) {
    assert.equal(normalizeSdashQuestion(raw, context).discarded, reason, JSON.stringify(raw));
  }
});

test('a WASSCE request is never satisfied with a UTME record', () => {
  assert.equal(normalize({ examtype: 'UTME' }).discarded, 'exam_mismatch');
  assert.equal(normalize({ examtype: 'NECO' }).discarded, 'exam_mismatch');

  // Both spellings the body uses are accepted, and an absent label is not
  // evidence of anything — refusing it would cost a student a valid question.
  assert.equal(normalize({ examtype: 'WASSCE' }).discarded, undefined);
  assert.equal(normalize({ examtype: 'waec' }).discarded, undefined);
  assert.equal(normalize({ examtype: null }).discarded, undefined);
  assert.equal(normalize({ examtype: '' }).discarded, undefined);
});

test('provider markup is stripped, so the product never needs dangerous HTML', () => {
  const { question } = normalize({
    question: '<p>Which organelle makes <b>protein</b>?</p>',
    option: { a: '<i>Ribosome</i>', b: 'Lysosome' },
    answer: 'a',
  });

  assert.equal(question.prompt, 'Which organelle makes protein?');
  assert.equal(question.options[0].text, 'Ribosome');
  assert.equal(/<[a-z]/i.test(JSON.stringify(question)), false, 'no tag survives into the canonical question');
});

test('HTML entities are decoded after markup removal, so maths survives', () => {
  const { question } = normalize({ question: 'Is 5 &lt; 7 &amp; 7 &gt; 5?' });
  assert.equal(question.prompt, 'Is 5 < 7 & 7 > 5?');
});
