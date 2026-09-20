import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { registerTsxHook } from '../scripts/tsx-hook.mjs';

registerAliasHook();
registerTsxHook();

const stub = (source) => ({ url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true });

/* The session engine is stubbed exactly as the runner suite does it, so this
 * file exercises presentation only. */
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

const { ExamAttemptRunner } = await import('../components/exam/exam-attempt-runner.tsx');
const { PracticeSessionRunner } = await import('../components/practice/practice-session-runner.tsx');
const { AnswerReview } = await import('../components/results/answer-review.tsx');

const h = React.createElement;
const html = (element) => renderToStaticMarkup(element).replace(/<!--.*?-->/g, '');

const INSTRUCTION = 'Choose the option opposite in meaning to the word given.';
const PROMPT = 'mischief';

const question = (overrides = {}) => ({
  id: 'q-1', examBody: 'jamb',
  subject: { id: 'use-of-english', slug: 'use-of-english', name: 'Use of English' },
  topic: null, year: 2024,
  source: { provider: 'aloc', providerQuestionId: '1' },
  instruction: INSTRUCTION,
  prompt: PROMPT,
  passage: null, assets: [], difficulty: null,
  options: [
    { id: 'o-a', key: 'A', text: 'Christmas' },
    { id: 'o-b', key: 'B', text: 'goodness' },
  ],
  ...overrides,
});

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

const practiceSession = (studentQuestion) => ({
  userId: 'u1', serverNow: Date.now(), id: 'sess-1', mode: 'practice', status: 'in_progress',
  subjectName: 'Use of English', subjectSlug: 'use-of-english', topicName: null, topicSlug: null,
  requestedCount: 1, questionCount: 1, answeredCount: 0, correctCount: 0, sourceProvider: 'aloc',
  startedAt: new Date().toISOString(),
  questions: [{ revision: 0, id: 'pq-1', position: 1, question: studentQuestion }],
});

const examAttempt = (studentQuestion) => ({
  userId: 'u1', serverNow: Date.now(), id: 'attempt-1', examBody: 'jamb', examName: 'JAMB',
  blueprintName: 'JAMB Full Mock', examYear: 2027, status: 'in_progress', sourceProvider: 'aloc',
  durationSeconds: 7200, totalQuestions: 1, answeredCount: 0, flaggedCount: 0,
  startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3.6e6).toISOString(),
  subjects: [{
    id: 'as-1', subjectId: 'use-of-english', slug: 'use-of-english', name: 'Use of English',
    displayOrder: 1, questionCount: 1, answeredCount: 0, flaggedCount: 0,
    questions: [{ revision: 0, id: 'eq-1', subjectId: 'use-of-english', subjectPosition: 1, overallPosition: 1, question: studentQuestion, isFlagged: false }],
  }],
});

const reviewItems = (studentQuestion) => ([{
  id: 'r-1', position: 1, question: studentQuestion, selected: 'A', correct: 'B',
  explanation: null, outcome: 'incorrect', flagged: false,
}]);

const renderPractice = (studentQuestion) => {
  globalThis.__sync = sync();
  return html(h(PracticeSessionRunner, { initialSession: practiceSession(studentQuestion) }));
};

const renderExam = (studentQuestion) => {
  globalThis.__sync = sync();
  return html(h(ExamAttemptRunner, { initialAttempt: examAttempt(studentQuestion) }));
};

const renderReview = (studentQuestion) =>
  html(h(AnswerReview, { items: reviewItems(studentQuestion), resultKind: 'practice', resultId: 'sess-1' }));

const positionOf = (markup, text) => markup.indexOf(text);

test('Practice shows the instruction, and shows it before the prompt', () => {
  const markup = renderPractice(question());
  assert.ok(markup.includes(INSTRUCTION), 'the instruction must be rendered');
  assert.ok(positionOf(markup, INSTRUCTION) < positionOf(markup, `>${PROMPT}<`), 'the instruction belongs above the prompt');
});

test('Mock shows the same instruction above the same prompt', () => {
  const markup = renderExam(question());
  assert.ok(markup.includes(INSTRUCTION));
  assert.ok(positionOf(markup, INSTRUCTION) < positionOf(markup, `>${PROMPT}<`));
});

test('Review shows the frozen instruction again, so the question still reads', () => {
  const markup = renderReview(question());
  assert.ok(markup.includes(INSTRUCTION), 'the stored instruction must reappear during review');
  // Review repeats the prompt in its collapsed summary, so the expanded body is
  // the occurrence that matters here.
  assert.ok(positionOf(markup, INSTRUCTION) < markup.lastIndexOf(`>${PROMPT}<`), 'the instruction belongs above the prompt');
});

test('the instruction stays visually secondary to the question it introduces', () => {
  // The prompt keeps the larger, heavier type; the instruction is quieter.
  for (const markup of [renderPractice(question()), renderExam(question())]) {
    const instructionTag = markup.slice(0, positionOf(markup, INSTRUCTION)).lastIndexOf('<p');
    const instructionClasses = markup.slice(instructionTag, positionOf(markup, INSTRUCTION));
    assert.match(instructionClasses, /text-\[13px\]/, 'the instruction uses the smaller size');
    assert.match(instructionClasses, /text-slate-600/, 'the instruction uses the quieter colour');
    assert.doesNotMatch(instructionClasses, /font-semibold/, 'the instruction must not compete with the prompt');
  }
});

test('nothing is rendered when a question carries no instruction', () => {
  const plain = question({ instruction: null, prompt: 'Which quantity is a vector?' });
  for (const markup of [renderPractice(plain), renderExam(plain), renderReview(plain)]) {
    assert.equal(markup.includes(INSTRUCTION), false);
    assert.ok(markup.includes('Which quantity is a vector?'));
  }
});

test('a passage still precedes the instruction it introduces', () => {
  const body = 'The rain had not stopped for three days, and the road had become a river of mud.';
  const markup = renderPractice(question({ passage: { id: 'p-1', title: 'Comprehension', body } }));
  assert.ok(positionOf(markup, body) < positionOf(markup, INSTRUCTION), 'source material comes first');
  assert.ok(positionOf(markup, INSTRUCTION) < positionOf(markup, `>${PROMPT}<`));
});
