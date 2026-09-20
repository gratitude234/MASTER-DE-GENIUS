import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

const {
  normalizeAlocQuestion, normalizeOptionKey, normalizeOptions,
  resolveAnswerKey, normalizePassage, normalizeSection, cleanText,
} = await import('../features/questions/providers/aloc/normalize.ts');
const { toStudentQuestion } = await import('../features/questions/delivery.ts');

const context = { examBody: 'jamb', subjectSlug: 'physics', subjectName: 'Physics' };
const raw = (overrides = {}) => ({
  id: 101,
  question: 'Which quantity is a vector?',
  option: { a: 'Speed', b: 'Velocity', c: 'Mass', d: 'Energy' },
  answer: 'b',
  examyear: '2019',
  section: null,
  image: null,
  solution: null,
  ...overrides,
});
const ok = (overrides) => {
  const result = normalizeAlocQuestion(raw(overrides), context);
  assert.equal(result.discarded, undefined, `unexpectedly discarded: ${result.discarded}`);
  return result.question;
};

test('lowercase answer maps to the uppercase domain key', () => {
  assert.equal(ok().correctOptionKey, 'B');
  assert.equal(ok({ answer: 'D' }).correctOptionKey, 'D');
  assert.equal(ok({ answer: 'option_c' }).correctOptionKey, 'C');
  assert.equal(ok({ answer: 'a.' }).correctOptionKey, 'A');
});

test('option keys normalize from every observed representation', () => {
  assert.equal(normalizeOptionKey('a'), 'A');
  assert.equal(normalizeOptionKey('option_b'), 'B');
  assert.equal(normalizeOptionKey('C)'), 'C');
  assert.equal(normalizeOptionKey('f'), null);
  assert.equal(normalizeOptionKey(''), null);
  assert.equal(normalizeOptionKey(null), null);
});

test('four-option and five-option questions are both delivered', () => {
  assert.equal(ok().options.length, 4);
  const five = ok({ option: { a: 'A1', b: 'B1', c: 'C1', d: 'D1', e: 'E1' }, answer: 'e' });
  assert.equal(five.options.length, 5);
  assert.equal(five.correctOptionKey, 'E');
});

test('an absent fifth option is dropped rather than delivered empty', () => {
  const question = ok({ option: { a: 'A1', b: 'B1', c: 'C1', d: 'D1', e: null } });
  assert.deepEqual(question.options.map((o) => o.key), ['A', 'B', 'C', 'D']);
});

test('options are ordered A-E regardless of upstream key order', () => {
  const question = ok({ option: { c: 'Gamma', a: 'Alpha', d: 'Delta', b: 'Beta' } });
  assert.deepEqual(question.options.map((o) => o.key), ['A', 'B', 'C', 'D']);
  assert.equal(question.options[0].text, 'Alpha');
});

test('option ids are deterministic, never random', () => {
  assert.equal(ok().options[0].id, 'aloc:101:A');
  assert.deepEqual(ok().options.map((o) => o.id), normalizeOptions(raw().option, '101').options.map((o) => o.id));
});

test('an array of options is accepted and positionally keyed', () => {
  const { options } = normalizeOptions(['One', 'Two', 'Three'], '7');
  assert.deepEqual(options.map((o) => o.key), ['A', 'B', 'C']);
  assert.equal(options[2].text, 'Three');
});

test('an answer matching exactly one option text resolves; an ambiguous one does not', () => {
  const options = normalizeOptions({ a: 'Velocity', b: 'Mass' }, '1').options;
  assert.equal(resolveAnswerKey('velocity', options), 'A');
  const ambiguous = normalizeOptions({ a: 'Same', b: 'Same' }, '1').options;
  assert.equal(resolveAnswerKey('same', ambiguous), null);
});

test('an unresolvable answer discards the question and never defaults to A', () => {
  assert.equal(normalizeAlocQuestion(raw({ answer: null }), context).discarded, 'unresolved_answer');
  assert.equal(normalizeAlocQuestion(raw({ answer: 'z' }), context).discarded, 'unresolved_answer');
  assert.equal(normalizeAlocQuestion(raw({ answer: '' }), context).discarded, 'unresolved_answer');
  // A numeric answer is an unverified format: discarded rather than guessed.
  assert.equal(normalizeAlocQuestion(raw({ answer: 2 }), context).discarded, 'unresolved_answer');
});

test('malformed questions are discarded with a specific reason', () => {
  assert.equal(normalizeAlocQuestion(raw({ id: null }), context).discarded, 'missing_id');
  assert.equal(normalizeAlocQuestion(raw({ question: '   ' }), context).discarded, 'empty_prompt');
  assert.equal(normalizeAlocQuestion(raw({ option: { a: 'Only' } }), context).discarded, 'too_few_options');
  assert.equal(normalizeAlocQuestion(raw({ option: 'not-an-object' }), context).discarded, 'invalid_structure');
  assert.equal(normalizeAlocQuestion(null, context).discarded, 'invalid_structure');
  assert.equal(normalizeAlocQuestion([], context).discarded, 'invalid_structure');
});

test('duplicate option keys discard the question', () => {
  assert.equal(normalizeAlocQuestion(raw({ option: { a: 'One', A: 'Two', b: 'Three' } }), context).discarded, 'duplicate_option_key');
});

test('year is preserved from the upstream record and bounded', () => {
  assert.equal(ok().year, 2019);
  assert.equal(ok({ examyear: 2004 }).year, 2004);
  assert.equal(ok({ examyear: 'unknown' }).year, null);
  assert.equal(ok({ examyear: '1878' }).year, null);
  assert.equal(ok({ examyear: null }).year, null);
});

test('provider identity is stable and carries the upstream id', () => {
  const question = ok();
  assert.deepEqual(question.source, { provider: 'aloc', providerQuestionId: '101', internalQuestionId: null });
  assert.equal(question.id, 'aloc:physics:101');
  assert.equal(ok({ id: '101' }).source.providerQuestionId, '101');
});

test('topic and difficulty are null because the source cannot supply them', () => {
  assert.equal(ok().topic, null);
  assert.equal(ok().difficulty, null);
});

test('explanation is null when the source supplies none', () => {
  assert.equal(ok().explanation, null);
  assert.equal(ok({ solution: '  ' }).explanation, null);
  assert.equal(ok({ solution: 'Velocity has direction.' }).explanation, 'Velocity has direction.');
});

test('a passage is normalized and shared by every question quoting it', () => {
  const body = 'The rain had not stopped for three days, and the road to the market had become a river of mud that no lorry could cross.';
  const first = ok({ id: 1, section: { theme: 'Comprehension', passage: body } });
  const second = ok({ id: 2, section: { theme: 'Comprehension', passage: body } });
  assert.equal(first.passage.body, body);
  assert.equal(first.passage.title, 'Comprehension');
  assert.equal(first.passage.id, second.passage.id, 'same passage must share one id');
  assert.notEqual(first.passage.id, ok({ id: 3, section: { passage: body.replace('rain', 'wind') } }).passage.id);
});

test('a short instruction is not promoted into a fabricated passage', () => {
  assert.equal(normalizePassage('Choose the best option.'), null);
  assert.equal(normalizePassage(null), null);
  assert.equal(normalizePassage({}), null);
  assert.equal(ok({ section: 'Answer all questions.' }).passage, null);
});

test('markup is stripped and entities decoded without destroying mathematics', () => {
  assert.equal(cleanText('<p>Water is H<sub>2</sub>O</p>'), 'Water is H2O');
  assert.equal(cleanText('Rate &amp; time'), 'Rate & time');
  assert.equal(cleanText('If x &lt; 5 and y &gt; 2'), 'If x < 5 and y > 2');
  assert.equal(cleanText('x < 5 and y > 2'), 'x < 5 and y > 2', 'bare comparisons must survive');
  assert.equal(cleanText('30&deg;C'), '30°C');
  assert.equal(cleanText('&#65;&#x42;'), 'AB');
  assert.equal(cleanText('First<br>Second'), 'First\nSecond');
  assert.equal(cleanText('  spaced   out  '), 'spaced out');
});

test('an image is only carried through when it is a usable absolute URL', () => {
  assert.deepEqual(ok().assets, []);
  assert.deepEqual(ok({ image: '' }).assets, []);
  assert.deepEqual(ok({ image: 'not-a-url' }).assets, []);
  const withImage = ok({ image: 'https://example.test/diagram.png' });
  assert.equal(withImage.assets.length, 1);
  assert.equal(withImage.assets[0].id, 'aloc:101:image');
  assert.equal(withImage.assets[0].kind, 'image');
});

test('SECURITY: the student payload drops the answer key and explanation', () => {
  const canonical = ok({ solution: 'Velocity is a vector quantity.' });
  assert.equal(canonical.correctOptionKey, 'B');
  assert.equal(canonical.explanation, 'Velocity is a vector quantity.');

  const student = toStudentQuestion(canonical);
  assert.equal('correctOptionKey' in student, false);
  assert.equal('explanation' in student, false);

  const serialized = JSON.stringify(student);
  assert.equal(serialized.includes('correctOptionKey'), false);
  assert.equal(serialized.includes('explanation'), false);
  assert.equal(serialized.includes('Velocity is a vector quantity.'), false);
  assert.equal(student.options.length, 4, 'options themselves must still be delivered');
});

test('REGRESSION: instruction text is not rendered as a passage when hasPassage is 0', () => {
  // Observed live: most English questions carry a long instruction in `section`
  // with hasPassage=0. Treating it as a passage put fabricated content on screen.
  const instruction = '<b>In each of questions 86 to 100, choose the option opposite in meaning to the underlined word(s).</b>';
  assert.ok(instruction.length > 40, 'long enough to defeat the length heuristic alone');

  assert.equal(normalizePassage(instruction, 0), null);
  assert.equal(normalizePassage(instruction, '0'), null);
  assert.equal(ok({ section: instruction, hasPassage: 0 }).passage, null);
});

test('a genuine comprehension passage is kept when hasPassage is set', () => {
  const body = 'The rain had not stopped for three days, and the road to the market had become a river of mud.';
  assert.ok(normalizePassage(body, 1));
  assert.equal(normalizePassage(body, '1').body, body);

  const question = ok({ section: body, hasPassage: 1 });
  assert.equal(question.passage.body, body);
  assert.equal(question.passage.id, ok({ id: 9, section: body, hasPassage: 1 }).passage.id, 'shared passage id');
});

test('a payload without the flag still falls back to the length heuristic', () => {
  const body = 'The rain had not stopped for three days, and the road had become a river of mud.';
  assert.ok(normalizePassage(body, undefined), 'unknown flag keeps the previous behaviour');
  assert.equal(normalizePassage('Choose the best option.', undefined), null);
});

test('REGRESSION: a section instruction is preserved instead of being discarded', () => {
  // The live shape behind the orphaned "mischief" question: the task lived in
  // `section`, hasPassage was 0, and the instruction used to be dropped entirely.
  const instruction = 'In each of the following questions, choose the option opposite in meaning to the word given.';
  const question = ok({
    question: 'mischief',
    option: { a: 'Christmas', b: 'ritual', c: 'goodness', d: 'Champagne' },
    answer: 'c',
    section: instruction,
    hasPassage: 0,
  });

  assert.equal(question.instruction, instruction, 'the instruction must survive normalization');
  assert.equal(question.passage, null, 'an instruction is never promoted into a passage');
  assert.equal(question.prompt, 'mischief');
});

test('instruction wording observed across English sections is recognised', () => {
  for (const instruction of [
    'Choose the option nearest in meaning to the word given.',
    'Choose the option opposite in meaning to the word given.',
    'From the words lettered A to D, choose the word that best completes the sentence.',
    'Complete each sentence with the most appropriate option.',
    'In each of questions 1 to 10, choose the option that best completes the gap.',
    'Choose the word that best completes the following sentence.',
  ]) {
    const section = normalizeSection(instruction);
    assert.equal(section.instruction, instruction, `lost: ${instruction}`);
    assert.equal(section.passage, null, `fabricated a passage from: ${instruction}`);
  }
});

test('markup and entities are cleaned in an instruction exactly as elsewhere', () => {
  const question = ok({ section: '<b>Choose the option nearest in meaning &amp; usage.</b>', hasPassage: 0 });
  assert.equal(question.instruction, 'Choose the option nearest in meaning & usage.');
});

test('a real passage still arrives as a passage, with no instruction invented', () => {
  const body = 'The rain had not stopped for three days, and the road to the market had become a river of mud that no lorry could cross.';
  const question = ok({ section: { theme: 'Comprehension', passage: body }, hasPassage: 1 });
  assert.equal(question.passage.body, body);
  assert.equal(question.passage.title, 'Comprehension');
  assert.equal(question.instruction, null, 'nothing may be invented to fill the instruction');
});

test('a section carrying both an instruction and a passage keeps both apart', () => {
  const body = 'The rain had not stopped for three days, and the road to the market had become a river of mud.';
  const question = ok({
    section: { instruction: 'Read the passage and answer the question.', passage: body },
    hasPassage: 1,
  });
  assert.equal(question.instruction, 'Read the passage and answer the question.');
  assert.equal(question.passage.body, body);
});

test('SECURITY: the instruction reaches the student payload, the answer key still does not', () => {
  const canonical = ok({
    question: 'mischief',
    section: 'Choose the option opposite in meaning to the word given.',
    hasPassage: 0,
    solution: 'The opposite of mischief is goodness.',
  });
  const student = toStudentQuestion(canonical);

  assert.equal(student.instruction, 'Choose the option opposite in meaning to the word given.');
  assert.equal('correctOptionKey' in student, false);
  assert.equal('explanation' in student, false);
  const serialized = JSON.stringify(student);
  assert.equal(serialized.includes('correctOptionKey'), false);
  assert.equal(serialized.includes('The opposite of mischief is goodness.'), false);
});

test('instruction recognition is not tied to the wording of one fixture', () => {
  // Real papers phrase the same task many ways: the imperative is not always the
  // first word, and the vocabulary varies between JAMB and WAEC sections.
  for (const instruction of [
    'For each of the following questions, select from the options lettered A to D the interpretation that is most appropriate to the sentence given.',
    'From the alternatives provided, choose the one that best completes the sentence.',
    'Select the option that is nearest in meaning to the word in italics.',
    'Choose the most suitable answer from the alternatives below.',
    'After each of the following sentences, a list of possible interpretations is given. Pick the interpretation you consider most appropriate.',
    'In the following passage, the numbered gaps indicate missing words. Against each number in the list below, choose the most appropriate option.',
    'From the words lettered A to D, choose the word that has the same vowel sound as the one represented by the letters underlined.',
    'Answer the questions that follow each passage by choosing the most appropriate of the options lettered A to D.',
    'Complete each of the following sentences with the most suitable alternative.',
    'Fill in the gap with the option that is grammatically correct.',
    'Indicate the option that has the same consonant sound as the one underlined.',
    'Study the diagram carefully and answer the question that follows.',
  ]) {
    const section = normalizeSection(instruction);
    assert.equal(section.instruction, instruction, `lost or misread: ${instruction}`);
    assert.equal(section.passage, null, `fabricated a passage from: ${instruction}`);
  }
});

test('prose is still a passage, including prose that happens to use task words', () => {
  // The counter-test for the recogniser above: a rubric marker only counts when
  // it opens a sentence or belongs to examination register, so narrative prose
  // that merely contains "choose" or "the options" is untouched.
  for (const body of [
    'The rain had not stopped for three days, and the road to the market had become a river of mud that no lorry could cross before dawn.',
    'He had to choose between two paths, and neither of them promised an easy journey home to the village where his mother waited.',
    'She weighed the options carefully. Her father had always told her that a farmer who plants late will find the harvest thin.',
    'Nigeria became a republic in 1963. Lagos remained the capital until 1991, when the seat of government moved to Abuja.',
  ]) {
    const section = normalizeSection(body);
    assert.ok(section.passage, `passage preservation broke for: ${body.slice(0, 50)}`);
    assert.equal(section.passage.body, body);
    assert.equal(section.instruction, null);
  }
});

test('a flagged passage is preserved even when it opens with a task word', () => {
  // The provider's own flag stays authoritative, so no recogniser can ever
  // demote real source material to a rubric.
  const body = 'Read the letter again, he said, and tell me whether the writer meant to sell the land or merely to lease it for a season.';
  const question = ok({ section: body, hasPassage: 1 });
  assert.equal(question.passage.body, body);
  assert.equal(question.instruction, null);
});
