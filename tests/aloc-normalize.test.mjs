import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

const {
  normalizeAlocQuestion, normalizeOptionKey, normalizeOptions,
  resolveAnswerKey, normalizePassage, cleanText,
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
