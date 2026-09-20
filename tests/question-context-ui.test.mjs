/**
 * The PASSAGE card is reserved for prose.
 *
 * A Mathematics question was served with a flattened MathML worked solution in
 * the blue card headed "Passage". Material that is not prose is still shown —
 * losing a formula would be its own defect — but it is shown under a neutral
 * label, and the same label is used in Practice, the Mock runner, answer review
 * and the admin inspector, because four copies is how a formula ends up called
 * a passage on one screen and something else on another.
 *
 * Presentation only: the session engine is stubbed exactly as the runner suite
 * does it, so these tests exercise markup rather than behaviour.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { registerTsxHook } from '../scripts/tsx-hook.mjs';

registerAliasHook();
registerTsxHook();

const stub = (source) => ({ url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true });

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/link') return { url: new URL('./stubs/next-link.mjs', import.meta.url).href, shortCircuit: true };
    if (specifier === 'next/image') return { url: new URL('./stubs/next-image.mjs', import.meta.url).href, shortCircuit: true };
    if (specifier === 'next/navigation') return stub(`export function useRouter(){ return { push(){} }; }`);
    if (specifier === '@/features/offline/use-session') return stub(`export function useOfflineSession(){ return globalThis.__sync; }`);
    return next(specifier, context);
  },
});

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const { PracticeSessionRunner } = await import('../components/practice/practice-session-runner.tsx');
const { ExamAttemptRunner } = await import('../components/exam/exam-attempt-runner.tsx');
const { AnswerReview } = await import('../components/results/answer-review.tsx');
const { contextHeading, isProseContext } = await import('../features/questions/context.ts');

const h = React.createElement;
const html = (element) => renderToStaticMarkup(element).replace(/<!--.*?-->/g, '');

/**
 * The words a student actually reads. Attributes are dropped first, because
 * Tailwind group names such as `group/passage` are styling, not a label, and
 * asserting against raw markup would confuse the two.
 */
const visibleText = (markup) => markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

const PROSE = 'The rain had not stopped for three days, and the road to the market had become a river of mud that swallowed every cart that tried it.';
const FORMULA = 'v = u + at';
const PROMPT = 'What does the passage suggest?';

/**
 * The prompt is deliberately free of the word "passage": these tests assert
 * that the word is absent from the rendered markup, so a fixture that used it
 * would fail for a reason that has nothing to do with the label.
 */
const question = (passage, prompt = PROMPT) => ({
  id: 'q-1', examBody: 'jamb',
  subject: { id: 'mathematics', slug: 'mathematics', name: 'Mathematics' },
  topic: null, year: 2016,
  source: { provider: 'aloc_station', providerQuestionId: '1' },
  instruction: null,
  prompt,
  passage, assets: [], difficulty: null,
  options: [{ id: 'o-a', key: 'A', text: 'One' }, { id: 'o-b', key: 'B', text: 'Two' }],
});

const MATHS_PROMPT = 'Find the final velocity after 3 seconds.';

const prosePassage = { id: 'p-1', title: null, body: PROSE, kind: 'passage' };
const givenContext = { id: 'p-2', title: null, body: FORMULA, kind: 'given' };
/** A snapshot frozen before `kind` existed. It must render exactly as it always did. */
const legacyPassage = { id: 'p-3', title: null, body: PROSE };

function sync(overrides = {}) {
  return {
    answers: { 'pq-1': { selectedOptionKey: null, isFlagged: false }, 'eq-1': { selectedOptionKey: null, isFlagged: false } },
    ready: true, state: 'saved', online: true, error: '', code: '',
    secondsLeft: 3600, cursor: { subject: 0, question: 0 },
    select() {}, setCursor() {}, flush() {}, finish() {}, finishing: false,
    receipt: null, pendingCount: 0, resolveConflict() {}, retryStorage() {},
    ...overrides,
  };
}

const practiceSession = (q) => ({
  userId: 'u1', serverNow: Date.now(), id: 'sess-1', mode: 'practice', status: 'in_progress',
  subjectName: 'Mathematics', subjectSlug: 'mathematics', topicName: null, topicSlug: null,
  requestedCount: 1, questionCount: 1, answeredCount: 0, correctCount: 0, sourceProvider: 'aloc_station',
  startedAt: new Date().toISOString(),
  questions: [{ revision: 0, id: 'pq-1', position: 1, question: q }],
});

const examAttempt = (q) => ({
  userId: 'u1', serverNow: Date.now(), id: 'attempt-1', examBody: 'jamb', examName: 'JAMB',
  blueprintName: 'JAMB Full Mock', examYear: 2027, status: 'in_progress', sourceProvider: 'aloc_station',
  durationSeconds: 7200, totalQuestions: 1, answeredCount: 0, flaggedCount: 0,
  startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3.6e6).toISOString(),
  subjects: [{
    id: 'as-1', subjectId: 'mathematics', slug: 'mathematics', name: 'Mathematics',
    displayOrder: 1, questionCount: 1, answeredCount: 0, flaggedCount: 0,
    questions: [{ revision: 0, id: 'eq-1', subjectId: 'mathematics', subjectPosition: 1, overallPosition: 1, question: q, isFlagged: false }],
  }],
});

const reviewItems = (q) => ([{
  id: 'r-1', position: 1, question: q, selected: 'A', correct: 'B',
  explanation: null, outcome: 'incorrect', flagged: false,
}]);

const renderPractice = (passage, prompt) => { globalThis.__sync = sync(); return html(h(PracticeSessionRunner, { initialSession: practiceSession(question(passage, prompt)) })); };
const renderExam = (passage, prompt) => { globalThis.__sync = sync(); return html(h(ExamAttemptRunner, { initialAttempt: examAttempt(question(passage, prompt)) })); };
const renderReview = (passage, prompt) => html(h(AnswerReview, { items: reviewItems(question(passage, prompt)), resultKind: "practice", resultId: "sess-1" }));

/* ---------------------------------------------------------------- *
 * The label
 * ---------------------------------------------------------------- */

test('prose is labelled a passage on every surface', () => {
  assert.match(renderPractice(prosePassage), /Passage/);
  assert.match(renderExam(prosePassage), /Comprehension passage/);
  assert.match(renderReview(prosePassage), /View passage/);
});

test('formula context is never labelled PASSAGE on any surface', () => {
  for (const [surface, markup] of [
    ['Practice', renderPractice(givenContext, MATHS_PROMPT)],
    ['Mock', renderExam(givenContext, MATHS_PROMPT)],
    ['review', renderReview(givenContext, MATHS_PROMPT)],
  ]) {
    assert.ok(!/[Pp]assage/.test(visibleText(markup)), `${surface} called a formula a passage`);
  }
});

test('formula context is still shown — refusing to label it is not refusing to show it', () => {
  // The Mock keeps context behind its reader sheet, as it does for a passage,
  // so there the contract is that the opener exists and is neutrally worded.
  assert.ok(renderPractice(givenContext, MATHS_PROMPT).includes(FORMULA), 'Practice lost the formula');
  assert.ok(renderReview(givenContext, MATHS_PROMPT).includes(FORMULA), 'review lost the formula');
  assert.match(renderExam(givenContext, MATHS_PROMPT), /Given information/, 'the Mock lost its opener');
});

test('Practice heads formula context "Given"', () => {
  assert.match(renderPractice(givenContext, MATHS_PROMPT), /Given/);
});

test('a snapshot frozen before the classification existed still reads as a passage', () => {
  assert.equal(contextHeading(legacyPassage), 'Passage');
  assert.equal(isProseContext(legacyPassage), true);
  assert.match(renderPractice(legacyPassage), /Passage/);
  assert.ok(renderPractice(legacyPassage).includes(PROSE));
});

test('the heading comes from one shared function, so no two surfaces can disagree', () => {
  assert.equal(contextHeading(prosePassage), 'Passage');
  assert.equal(contextHeading(givenContext), 'Given');
  // A provider-supplied title still wins, as it always has.
  assert.equal(contextHeading({ ...prosePassage, title: 'The Potter’s Wheel' }), 'The Potter’s Wheel');
});

/* ---------------------------------------------------------------- *
 * What is never rendered
 * ---------------------------------------------------------------- */

test('a question whose context was discarded renders no context block at all', () => {
  for (const [surface, markup] of [
    ['Practice', renderPractice(null, MATHS_PROMPT)],
    ['Mock', renderExam(null, MATHS_PROMPT)],
    ['review', renderReview(null, MATHS_PROMPT)],
  ]) {
    assert.ok(!/View passage|Comprehension passage|>Given</.test(markup), `${surface} rendered an empty context block`);
    assert.ok(markup.includes(MATHS_PROMPT), `${surface} lost the prompt`);
  }
});

test('the discarded-context diagnostic never reaches a student surface', () => {
  const withDiagnostic = { ...question(null), discardedContext: { kind: 'solution', detail: 'context is labelled a worked solution' } };
  globalThis.__sync = sync();
  const practice = html(h(PracticeSessionRunner, { initialSession: practiceSession(withDiagnostic) }));
  const review = html(h(AnswerReview, { items: reviewItems(withDiagnostic), resultKind: 'practice', resultId: 'sess-1' }));
  for (const markup of [practice, review]) {
    assert.ok(!markup.includes('worked solution'), 'a diagnostic leaked to the student');
    assert.ok(!markup.includes('solution'), 'a diagnostic leaked to the student');
  }
});
