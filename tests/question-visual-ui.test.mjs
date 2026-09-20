/**
 * Where a question visual legitimately exists, it must render — in Practice, in
 * the Mock runner and in answer review — and it must stay legible on a phone.
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

const { ExamAttemptRunner } = await import('../components/exam/exam-attempt-runner.tsx');
const { PracticeSessionRunner } = await import('../components/practice/practice-session-runner.tsx');
const { AnswerReview } = await import('../components/results/answer-review.tsx');

const h = React.createElement;
const html = (element) => renderToStaticMarkup(element).replace(/<!--.*?-->/g, '');

const URL_ = 'https://res.cloudinary.com/aloc-ng/image/upload/v1/ALOC-Questions/Mathematics/2009/hist.jpg';
const PROMPT = 'The histogram above represents the number of candidates.';

const ASSET = {
  id: 'aloc-station:213f8f9e:image',
  kind: 'image',
  url: URL_,
  altText: null,
  caption: null,
};

const question = (overrides = {}) => ({
  id: 'q-1', examBody: 'jamb',
  subject: { id: 'mathematics', slug: 'mathematics', name: 'Mathematics' },
  topic: null, year: 2009,
  source: { provider: 'aloc_station', providerQuestionId: '213f8f9e' },
  instruction: null,
  prompt: PROMPT,
  passage: null,
  assets: [ASSET],
  difficulty: null,
  options: [
    { id: 'o-a', key: 'A', text: '80' },
    { id: 'o-b', key: 'B', text: '95' },
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
  subjectName: 'Mathematics', subjectSlug: 'mathematics', topicName: null, topicSlug: null,
  requestedCount: 1, questionCount: 1, answeredCount: 0, correctCount: 0, sourceProvider: 'aloc_station',
  startedAt: new Date().toISOString(),
  questions: [{ revision: 0, id: 'pq-1', position: 1, question: studentQuestion }],
});

const examAttempt = (studentQuestion) => ({
  userId: 'u1', serverNow: Date.now(), id: 'attempt-1', examBody: 'jamb', examName: 'JAMB',
  blueprintName: 'JAMB Full Mock', examYear: 2027, status: 'in_progress', sourceProvider: 'aloc_station',
  durationSeconds: 7200, totalQuestions: 1, answeredCount: 0, flaggedCount: 0,
  startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3.6e6).toISOString(),
  subjects: [{
    id: 'as-1', subjectId: 'mathematics', slug: 'mathematics', name: 'Mathematics',
    displayOrder: 1, questionCount: 1, answeredCount: 0, flaggedCount: 0,
    questions: [{ revision: 0, id: 'eq-1', subjectId: 'mathematics', subjectPosition: 1, overallPosition: 1, question: studentQuestion, isFlagged: false }],
  }],
});

const reviewItems = (studentQuestion) => ([{
  id: 'r-1', position: 1, question: studentQuestion, selected: 'A', correct: 'B',
  explanation: null, outcome: 'incorrect', flagged: false,
}]);

const renderPractice = (q) => { globalThis.__sync = sync(); return html(h(PracticeSessionRunner, { initialSession: practiceSession(q) })); };
const renderExam = (q) => { globalThis.__sync = sync(); return html(h(ExamAttemptRunner, { initialAttempt: examAttempt(q) })); };
const renderReview = (q) => html(h(AnswerReview, { items: reviewItems(q), resultKind: 'practice', resultId: 'sess-1' }));

const SURFACES = [
  ['Practice', renderPractice],
  ['Mock/Exam', renderExam],
  ['Answer review', renderReview],
];

/* ═════════════════════════════════════════════  17-19. it renders everywhere */

for (const [name, render] of SURFACES) {
  test(`${name} renders the question visual`, () => {
    const markup = render(question());
    assert.ok(markup.includes(URL_), `${name} must render the asset URL`);
    assert.match(markup, /<img[^>]+src="https:\/\/res\.cloudinary\.com/);
  });

  test(`${name} shows the visual above the prompt it belongs to`, () => {
    const markup = render(question());
    assert.ok(markup.indexOf(URL_) < markup.lastIndexOf(PROMPT), `${name} must show the visual before the question`);
  });

  test(`${name} renders nothing when the question has no visual`, () => {
    const markup = render(question({ assets: [] }));
    assert.equal(markup.includes('<img'), false, `${name} must not render an empty figure`);
    assert.ok(markup.includes(PROMPT));
  });
}

/* ════════════════════════════════════════════  mobile-first exam legibility */

test('the visual fills the column, keeps its aspect ratio and is never cropped', () => {
  for (const [name, render] of SURFACES) {
    const markup = render(question());
    const tag = /<img\b[^>]*>/.exec(markup)[0];
    assert.match(tag, /w-full/, `${name}: the visual must use the full column width`);
    assert.match(tag, /h-auto/, `${name}: height must follow the intrinsic aspect ratio`);
    assert.match(tag, /object-contain/, `${name}: a graph must never be cropped to fill a box`);
    assert.doesNotMatch(tag, /object-cover/, `${name}: cover would crop exam labels away`);
  }
});

test('the visual is bounded by the viewport, never by a small fixed pixel box', () => {
  const markup = renderPractice(question());
  const tag = /<img\b[^>]*>/.exec(markup)[0];
  // A viewport-relative cap keeps a tall table readable; a fixed pixel height
  // would turn an exam diagram into a thumbnail on a 360px screen.
  assert.match(tag, /max-h-\[\d+vh\]/, 'the cap must be viewport-relative');
  assert.doesNotMatch(tag, /max-h-\[\d+px\]/, 'a fixed pixel cap shrinks exam diagrams');
  assert.doesNotMatch(tag, /\bw-\[\d+px\]/, 'a fixed pixel width cannot be responsive');
});

test('the figure cannot overflow the page horizontally', () => {
  for (const [name, render] of SURFACES) {
    const markup = render(question());
    const figureStart = markup.lastIndexOf('<figure', markup.indexOf(URL_));
    const figure = markup.slice(figureStart, markup.indexOf(URL_));
    assert.match(figure, /overflow-hidden/, `${name}: the figure must clip rather than push the page wide`);
  }
});

test('every visual offers a way to enlarge it for small exam labels', () => {
  for (const [name, render] of SURFACES) {
    const markup = render(question());
    assert.match(markup, /Tap to enlarge/, `${name}: a candidate must be able to zoom`);
    assert.match(markup, /aria-label="Enlarge illustration: [^"]+"/, `${name}: the control must be labelled`);
    assert.match(markup, /cursor-zoom-in/, `${name}: the affordance must be visible`);
  }
});

test('alt text is the provider’s when supplied, and honest when it is not', () => {
  const generic = renderPractice(question());
  assert.match(generic, /alt="Illustration supplied with this question"/);

  const described = renderPractice(question({ assets: [{ ...ASSET, altText: 'Histogram of candidate scores' }] }));
  assert.match(described, /alt="Histogram of candidate scores"/);
});

test('a caption is shown when the provider supplied one, and nothing invented when not', () => {
  const captioned = renderPractice(question({ assets: [{ ...ASSET, caption: 'Fig. 1' }] }));
  assert.ok(captioned.includes('Fig. 1'));
  assert.equal(renderPractice(question()).includes('<figcaption'), false);
});

test('several visuals on one question all render, in provider order', () => {
  const second = { ...ASSET, id: 'aloc-station:213f8f9e:image:abc', url: 'https://cdn.test/second.png' };
  const markup = renderPractice(question({ assets: [ASSET, second] }));
  assert.ok(markup.includes(URL_));
  assert.ok(markup.includes(second.url));
  assert.ok(markup.indexOf(URL_) < markup.indexOf(second.url), 'provider order is preserved');
});

/* ═════════════════════════════════════════════════════════  no leakage */

test('rendering a visual leaks no answer key and no provider field name', () => {
  for (const [name, render] of SURFACES) {
    const markup = render(question());
    for (const leaked of ['correctAnswer', 'imageUrl', 'examType', 'provenance', 'X-API-Key']) {
      assert.equal(markup.includes(leaked), false, `${name} must not render "${leaked}"`);
    }
  }
});

test('a visual loads directly in the browser and is never proxied through the app', () => {
  // The URL goes straight into <img src>, so nothing is fetched server-side and
  // the app is not an open image proxy.
  const markup = renderPractice(question());
  const src = /<img[^>]+src="([^"]+)"/.exec(markup)[1];
  assert.equal(src, URL_, 'the provider URL must be used verbatim, not rewritten through a proxy route');
  assert.equal(markup.includes('/_next/image'), false, 'the visual must not be routed through the optimizer');
});
