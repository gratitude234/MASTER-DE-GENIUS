/**
 * Question context classification — what may appear in the PASSAGE card.
 *
 * Two questions were served to students in this state:
 *
 *   Mathematics 2004  PASSAGE: "M\ni\nd\np\no\ni\nn\nt\n=\n\n(\n\nx\n1 ... (1,1)"
 *   Mathematics 2016  PASSAGE: "12.02\n×<!-- × -->\n20.06\n\n26.04\n..."
 *
 * Both came from ALOC Station's `section` field, and both were a MathJax
 * MathML document rather than prose. The first was the *worked solution*, so
 * the blue card was showing the answer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

const {
  classifyQuestionContext, joinCharacterFragments, contextDuplicatesPrompt,
  isIncompleteContext, hasMathMarkup,
} = await import('../features/questions/context.ts');
const { cleanText, normalizeSection } = await import('../features/questions/providers/aloc/normalize.ts');
const { normalizeStationQuestion } = await import('../features/questions/providers/aloc-station/normalize.ts');

/* The exact bytes the provider returned, verified live on 2026-09-20. */
const MIDPOINT_SECTION = `<math xmlns="http://www.w3.org/1998/Math/MathML">
  <mi>M</mi>
  <mi>i</mi>
  <mi>d</mi>
  <mi>p</mi>
  <mi>o</mi>
  <mi>i</mi>
  <mi>n</mi>
  <mi>t</mi>
  <mo>=</mo>
  <mfrac>
    <mrow>
      <mo stretchy="false">(</mo>
      <msub><mi>x</mi><mn>1</mn></msub>
      <mo>+</mo>
      <msub><mi>x</mi><mn>2</mn></msub>
      <mo stretchy="false">)</mo>
    </mrow>
    <mn>2</mn>
  </mfrac>
  <mo>=</mo>
  <mfrac>
    <mrow>
      <mo stretchy="false">(</mo>
      <mo>&#x2212;<!-- − --></mo>
      <mn>3</mn>
      <mo>+</mo>
      <mn>5</mn>
      <mo stretchy="false">)</mo>
    </mrow>
    <mn>2</mn>
  </mfrac>
  <mo>=</mo>
  <mo stretchy="false">(</mo><mn>1</mn><mo>,</mo><mn>1</mn><mo stretchy="false">)</mo>
</math>`;

const EVALUATE_SECTION = `<math xmlns="http://www.w3.org/1998/Math/MathML">
  <mfrac>
    <mrow>
      <mn>12.02</mn>
      <mo>&#x00D7;<!-- × --></mo>
      <mn>20.06</mn>
    </mrow>
    <mrow>
      <mn>26.04</mn>
      <mo>&#x00D7;<!-- × --></mo>
      <mn>60.06</mn>
    </mrow>
  </mfrac>
</math>`;

const MIDPOINT_PROMPT = 'Find the midpoint of the line joining P(-3, 5) and Q(5, -3).';
const EVALUATE_PROMPT = 'Evaluate (12.02×20.06)/(26.04×60.06)\n, correct to three significant figures.';

const classify = (raw, prompt = '') =>
  classifyQuestionContext({ raw, text: cleanText(raw), prompt });

/* ---------------------------------------------------------------- *
 * The two production cases
 * ---------------------------------------------------------------- */

test('production case: the "Midpoint =" MathML section is never a passage', () => {
  const result = classify(MIDPOINT_SECTION, MIDPOINT_PROMPT);
  assert.notEqual(result.kind, 'passage');
  assert.equal(result.discard, true);
});

test('production case: the 12.02/20.06 fraction section is never a passage', () => {
  const result = classify(EVALUATE_SECTION, EVALUATE_PROMPT);
  assert.notEqual(result.kind, 'passage');
  assert.equal(result.discard, true);
});

test('production case: neither question keeps a passage after normalization', () => {
  for (const [section, text] of [[MIDPOINT_SECTION, MIDPOINT_PROMPT], [EVALUATE_SECTION, EVALUATE_PROMPT]]) {
    const { question } = normalizeStationQuestion(
      {
        id: 'q1', text, section, year: 2004,
        options: { A: '(1, 1)', B: '(2, 2)', C: '(4, 4)', D: '(4, -4)' }, correctAnswer: 'A',
      },
      { examBody: 'jamb', subjectSlug: 'mathematics', subjectName: 'Mathematics' },
    );
    assert.equal(question.passage, null);
  }
});

test('the worked solution never reaches the student in any field', () => {
  const { question } = normalizeStationQuestion(
    {
      id: 'q1', text: MIDPOINT_PROMPT, section: MIDPOINT_SECTION, year: 2004,
      options: { A: '(1, 1)', B: '(2, 2)', C: '(4, 4)', D: '(4, -4)' }, correctAnswer: 'A',
    },
    { examBody: 'jamb', subjectSlug: 'mathematics', subjectName: 'Mathematics' },
  );
  const visible = [question.passage?.body, question.instruction].filter(Boolean).join('\n');
  assert.ok(!visible.includes('Midpoint'), 'the solution label leaked');
  assert.ok(!/\(\s*1\s*,\s*1\s*\)/.test(visible), 'the answer leaked into visible text');
});

/* ---------------------------------------------------------------- *
 * HTML comment residue
 * ---------------------------------------------------------------- */

test('HTML comments are stripped, the entity they annotate is kept', () => {
  assert.equal(cleanText('<mo>&#x00D7;<!-- × --></mo>'), '×');
  assert.equal(cleanText('5 <!-- a stray note --> apples'), '5 apples');
  assert.equal(cleanText('<!-- leading --><p>Real text.</p>'), 'Real text.');
});

test('a comment never survives into a cleaned context', () => {
  for (const section of [MIDPOINT_SECTION, EVALUATE_SECTION]) {
    assert.ok(!cleanText(section).includes('<!--'));
    assert.ok(!cleanText(section).includes('-->'));
  }
});

/* ---------------------------------------------------------------- *
 * Character-fragment repair and incompleteness
 * ---------------------------------------------------------------- */

test('consecutive single-character lines are recognised as one fragmented token', () => {
  const repaired = joinCharacterFragments('M\ni\nd\np\no\ni\nn\nt\n=');
  assert.equal(repaired.repaired, true);
  assert.equal(repaired.text, 'Midpoint =');
});

test('the repaired "Midpoint =" is recognised as incomplete', () => {
  for (const text of ['Midpoint =', 'Area =', 'Velocity =', 'Given that:', 'From the equation:', 'Where:']) {
    assert.equal(isIncompleteContext(text), true, text);
  }
});

/* ---------------------------------------------------------------- *
 * Legitimate formula context must survive
 * ---------------------------------------------------------------- */

test('a complete formula is never called incomplete', () => {
  for (const formula of [
    'Midpoint = ((x1+x2)/2, (y1+y2)/2)',
    'Area = πr²',
    'v = u + at',
    'x = 5',
    'Given that x + y = 12',
    'Given that: x + y = 12',
  ]) {
    assert.equal(isIncompleteContext(formula), false, formula);
  }
});

test('a legitimate short formula context is kept and is not a passage', () => {
  for (const formula of ['Area = πr²', 'v = u + at', 'x = 5', 'Given that x + y = 10']) {
    const result = classify(formula, 'Find the value of the expression.');
    assert.equal(result.discard, false, `${formula} was discarded`);
    assert.notEqual(result.kind, 'passage', `${formula} became a passage`);
    assert.equal(result.text, formula);
  }
});

/* ---------------------------------------------------------------- *
 * Prose, poems, lists and instructions are untouched
 * ---------------------------------------------------------------- */

const PROSE = 'Young men have strong passions, and tend to gratify them indiscriminately. Of the bodily desires, it is the sexual by which they are most swayed and in which they show absence of self-control.';

test('a real prose passage remains a passage', () => {
  const result = classify(PROSE, 'The writer suggests that young men are');
  assert.equal(result.kind, 'passage');
  assert.equal(result.discard, false);
  assert.equal(result.text, PROSE);
});

test('a poem keeps its deliberate line breaks', () => {
  const poem = 'I wandered lonely as a cloud\nThat floats on high o’er vales and hills,\nWhen all at once I saw a crowd,\nA host, of golden daffodils;';
  const result = classify(poem, 'The poem above is best described as');
  assert.equal(result.kind, 'passage');
  assert.equal(result.text, poem, 'line breaks were altered');
});

test('a legitimate lettered list never collapses into one word', () => {
  const list = 'A\nB\nC\nD';
  assert.equal(joinCharacterFragments(list).repaired, false);
  assert.equal(joinCharacterFragments(list).text, list);
});

test('an instruction stays an instruction', () => {
  const rubric = 'In each of questions 86 to 100, choose the option opposite in meaning to the word or phrase in italics.';
  assert.equal(normalizeSection(rubric).instruction, rubric);
  assert.equal(normalizeSection(rubric).passage, null);
});

/* ---------------------------------------------------------------- *
 * Duplicated prompt context
 * ---------------------------------------------------------------- */

test('context whose tokens are all already in the prompt is a duplicate', () => {
  assert.equal(contextDuplicatesPrompt('12.02\n×\n20.06\n\n26.04\n×\n60.06', EVALUATE_PROMPT), true);
});

test('context carrying information the prompt lacks is not a duplicate', () => {
  assert.equal(
    contextDuplicatesPrompt('Class Interval 3-5 6-8 9-11 Frequency 2 2 2', 'Find the standard deviation of the distribution.'),
    false,
  );
  assert.equal(contextDuplicatesPrompt(PROSE, 'The writer suggests that young men are'), false);
});

/* ---------------------------------------------------------------- *
 * No false collapse of real content
 * ---------------------------------------------------------------- */

test('chemical notation and stress-marked English are never collapsed', () => {
  for (const text of ['H2SO4 is a strong acid', 'CO and Co are different', 'aSSociation', 'NaOH + HCl → NaCl + H2O']) {
    assert.equal(joinCharacterFragments(text).text, text, text);
  }
});

test('legitimate numeric and tabular context stays intact', () => {
  const table = 'Use the table below to answer questions. Unit of capital [1,2,3,4,5,6] Total output (kg) [16, 64, 126, 212, 425, 684]';
  const result = classify(table, 'The marginal product of the 5th unit of capital is');
  assert.equal(result.discard, false);
  assert.equal(result.text, table);
});

test('math markup is detected from the raw provider value', () => {
  assert.equal(hasMathMarkup(MIDPOINT_SECTION), true);
  assert.equal(hasMathMarkup(EVALUATE_SECTION), true);
  assert.equal(hasMathMarkup(PROSE), false);
  assert.equal(hasMathMarkup('The formula is x < 5 and y > 2'), false);
});

/* ---------------------------------------------------------------- *
 * What the frozen snapshot carries
 * ---------------------------------------------------------------- */

const { toStudentQuestion } = await import('../features/questions/delivery.ts');
const { checkQuestionIntegrity } = await import('../features/questions/integrity.ts');
const { contextDiagnostic } = await import('../features/questions/context.ts');

test('the frozen snapshot stores the classification, never the refused text', () => {
  const { question } = normalizeStationQuestion(
    {
      id: 'q1', text: MIDPOINT_PROMPT, section: MIDPOINT_SECTION, year: 2004,
      options: { A: '(1, 1)', B: '(2, 2)', C: '(4, 4)', D: '(4, -4)' }, correctAnswer: 'A',
    },
    { examBody: 'jamb', subjectSlug: 'mathematics', subjectName: 'Mathematics' },
  );
  const student = toStudentQuestion(question);

  assert.equal(student.discardedContext.kind, 'malformed');
  assert.equal(student.passage, null);
  // The diagnostic is a fixed phrase from this module, never provider text, so
  // a worked solution cannot travel inside it.
  const payload = JSON.stringify(student);
  assert.ok(!payload.includes('Midpoint'), 'refused text travelled in the snapshot');
  assert.equal(payload.split('(1, 1)').length - 1, 1, 'the answer appears only as option A');
  assert.ok(!('correctOptionKey' in student) && !('explanation' in student), 'the answer key must stay server-side');
});

test('a kept context records its kind so the renderer cannot guess', () => {
  const { question } = normalizeStationQuestion(
    {
      id: 'q2', text: 'The writer suggests that young men are', section: PROSE, hasPassage: 1,
      options: { A: 'calm', B: 'swayed' }, correctAnswer: 'B',
    },
    { examBody: 'jamb', subjectSlug: 'use-of-english', subjectName: 'Use of English' },
  );
  assert.equal(question.passage.kind, 'passage');
  assert.equal(question.discardedContext, null);
});

test('the admin inspector can report both the classification and the integrity reason', () => {
  // "the above distribution" needs the table the provider destroyed, so the
  // question is refused — and the reason must say the context was broken
  // rather than never sent.
  const classification = classifyQuestionContext({
    raw: '<math><mtable><mtr><mtd><mi>C</mi>\n<mi>l</mi>\n<mi>a</mi>\n<mi>s</mi>\n<mi>s</mi></mtd></mtr></mtable>',
    text: 'C\nl\na\ns\ns',
    prompt: 'Find the standard deviation of the above distribution.',
  });
  assert.equal(classification.discard, true);

  const verdict = checkQuestionIntegrity({
    prompt: 'Find the standard deviation of the above distribution.',
    passage: null, assets: [], options: [{ text: '2.4' }, { text: '2.5' }],
    discardedContext: contextDiagnostic(classification),
  });
  assert.equal(verdict.valid, false);
  assert.equal(verdict.reason, 'malformed_context');
  assert.match(verdict.detail, /context discarded/);
});

test('a missing diagram is still reported as a missing diagram, not as broken context', () => {
  // A worked solution thrown away beside a question that needs a figure does
  // not make the figure "malformed" — the provider never sent one.
  const verdict = checkQuestionIntegrity({
    prompt: 'Find the value of x in the figure above',
    passage: null, assets: [], options: [{ text: '5' }, { text: '6' }],
    discardedContext: { kind: 'solution', detail: 'context is labelled a worked solution' },
  });
  assert.equal(verdict.reason, 'missing_referenced_asset');
});

test('a discarded context never rescues or condemns a question on its own', () => {
  const selfContained = {
    prompt: 'Find the midpoint of the line joining P(-3, 5) and Q(5, -3).',
    passage: null, assets: [], options: [{ text: '(1, 1)' }, { text: '(2, 2)' }],
  };
  assert.equal(checkQuestionIntegrity(selfContained).valid, true);
  assert.equal(
    checkQuestionIntegrity({ ...selfContained, discardedContext: { kind: 'solution' } }).valid,
    true,
    'losing a worked solution must not reject a question that never needed it',
  );
});
