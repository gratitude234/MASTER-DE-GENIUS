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
    if (specifier === 'next/link') {
      return { url: new URL('./stubs/next-link.mjs', import.meta.url).href, shortCircuit: true };
    }
    if (specifier === 'next/navigation') {
      return stub(
        `export function useRouter(){ return { push(){} }; }
         export function notFound(){ throw new Error('NEXT_NOT_FOUND'); }`,
      );
    }
    if (specifier === '@/lib/auth') {
      // The target-score lookup is the only query the result page makes itself.
      return stub(
        `const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: globalThis.__preference ?? null }) };
         export async function requireOnboardedUser(){
           return { user: { id: 'user-1' }, supabase: { from: () => chain } };
         }`,
      );
    }
    if (specifier === '@/features/results/service') {
      return stub(
        `export async function loadHistory(){ return globalThis.__history ?? []; }
         export async function loadResult(){ return globalThis.__result ?? null; }`,
      );
    }
    if (specifier === '@/features/offline/storage') {
      return stub(`export async function readRecord(){ return null; } export async function writeRecord(){}`);
    }
    return next(specifier, context);
  },
});

const React = (await import('react')).default;
const { prerenderToNodeStream } = await import('react-dom/static');
const { renderToStaticMarkup } = await import('react-dom/server');

const ProgressPage = (await import('../app/(student)/progress/page.tsx')).default;
const ResultPage = (await import('../app/(student)/progress/results/[kind]/[id]/page.tsx')).default;
const MistakesPage = (await import('../app/(student)/progress/mistakes/page.tsx')).default;
const ProgressLoading = (await import('../app/(student)/progress/loading.tsx')).default;
const ResultLoading = (await import('../app/(student)/progress/results/[kind]/[id]/loading.tsx')).default;
const ExamLoading = (await import('../app/exam/[attemptId]/loading.tsx')).default;
const ProgressError = (await import('../app/(student)/progress/error.tsx')).default;
const ExamError = (await import('../app/exam/[attemptId]/error.tsx')).default;
const { summariseProgress } = await import('../features/progress/summary.ts');

const EXAM_BODY = 'jamb-id';
const h = React.createElement;

function item(id, subjectSlug, subjectName, topicSlug, topicName, outcome) {
  return {
    id, position: 1,
    question: {
      examBody: 'jamb',
      subject: { id: subjectSlug, slug: subjectSlug, name: subjectName },
      topic: topicSlug ? { slug: topicSlug, name: topicName } : null,
      source: { provider: 'aloc', providerQuestionId: id },
      prompt: `Prompt for ${id}`, options: [], assets: [], passage: null, difficulty: null,
    },
    selected: outcome === 'unanswered' ? null : 'A',
    correct: outcome === 'correct' ? 'A' : 'B',
    explanation: null, outcome, flagged: false,
  };
}

function result({ id, kind = 'exam', title, completedAt, items, score, maximum, scaled = false }) {
  const group = (byTopic) => {
    const rows = new Map();
    for (const entry of items) {
      const { subject: s, topic } = entry.question;
      const key = JSON.stringify([s.slug, byTopic ? topic?.slug ?? null : null]);
      const row = rows.get(key) ?? {
        key, name: byTopic ? topic?.name ?? 'Uncategorised' : s.name,
        subjectSlug: s.slug, topicSlug: byTopic ? topic?.slug ?? null : null,
        total: 0, correct: 0, incorrect: 0, unanswered: 0, accuracy: 0,
      };
      row.total++; row[entry.outcome]++;
      row.accuracy = Math.round((100 * row.correct) / row.total);
      rows.set(key, row);
    }
    return [...rows.values()];
  };
  const correct = items.filter((i) => i.outcome === 'correct').length;
  return {
    id, kind, examBodyId: EXAM_BODY, title, completedAt, startedAt: completedAt, elapsedSeconds: 754,
    total: items.length, correct,
    incorrect: items.filter((i) => i.outcome === 'incorrect').length,
    unanswered: items.filter((i) => i.outcome === 'unanswered').length,
    accuracy: Math.round((100 * correct) / items.length),
    score, maximum, scaled, subjects: group(false), topics: group(true), items,
  };
}

const mockItems = [
  item('p1', 'physics', 'Physics', 'waves', 'Waves', 'correct'),
  item('p2', 'physics', 'Physics', 'waves', 'Waves', 'incorrect'),
  item('p3', 'physics', 'Physics', 'waves', 'Waves', 'incorrect'),
  item('p4', 'physics', 'Physics', 'waves', 'Waves', 'unanswered'),
  item('c1', 'chemistry', 'Chemistry', 'moles', 'Moles', 'correct'),
  item('c2', 'chemistry', 'Chemistry', 'moles', 'Moles', 'correct'),
];

const fullMock = result({ id: 'mock-1', title: 'JAMB Mock', completedAt: '2026-05-02T09:00:00Z', items: mockItems, score: 240, maximum: 400, scaled: true });

const sparsePractice = result({
  id: 'prac-1', kind: 'practice', title: 'Physics Practice', completedAt: '2026-05-03T09:00:00Z',
  score: 2, maximum: 2, scaled: false,
  items: [
    item('s1', 'physics', 'Physics', 'waves', 'Waves', 'correct'),
    item('s2', 'physics', 'Physics', 'waves', 'Waves', 'correct'),
  ],
});

async function renderAsync(element) {
  const { prelude } = await prerenderToNodeStream(element);
  let markup = '';
  for await (const chunk of prelude) markup += chunk;
  return markup.replace(/<!--.*?-->/g, '');
}

const renderProgress = (history = [], searchParams = {}) => {
  globalThis.__history = history;
  return renderAsync(h(ProgressPage, { searchParams: Promise.resolve(searchParams) }));
};

const renderResult = (learningResult, preference = null, params = { kind: 'exam', id: 'mock-1' }) => {
  globalThis.__result = learningResult;
  globalThis.__preference = preference;
  return renderAsync(h(ResultPage, { params: Promise.resolve(params) }));
};

const renderMistakes = (history = [], searchParams = {}) => {
  globalThis.__history = history;
  return renderAsync(h(MistakesPage, { searchParams: Promise.resolve(searchParams) }));
};

test('Progress embeds the real subject-performance section at a linkable id', async () => {
  const markup = await renderProgress([fullMock, sparsePractice]);

  assert.ok(markup.includes('id="performance"'), '/progress#performance has somewhere to land');
  assert.ok(markup.includes('Subject performance'));
  // Fed by the shared SubjectPerformance component, with real aggregates.
  assert.ok(markup.includes('role="progressbar"'));
  assert.ok(markup.includes('aria-label="Physics accuracy"'));
  assert.ok(markup.includes('All attempts'), 'the period is stated, not assumed');
  assert.ok(markup.includes('3/6'), 'Physics: 1 of 4 plus 2 of 2 across both attempts');
});

test('Progress aggregates only what it counted, and invents no other metric', () => {
  const summary = summariseProgress([fullMock, sparsePractice]);
  assert.equal(summary.attempts, 2);
  assert.equal(summary.questions, 8);
  assert.equal(summary.correct, 5);
  assert.equal(summary.accuracy, 63);

  // Weakest subject first, so the row that needs work leads.
  assert.deepEqual(summary.subjects.map((s) => [s.name, s.accuracy, s.correct, s.total]), [
    ['Physics', 50, 3, 6],
    ['Chemistry', 100, 2, 2],
  ]);
  assert.deepEqual(Object.keys(summary), ['attempts', 'questions', 'correct', 'accuracy', 'subjects']);
});

test('Progress with no attempts offers guidance instead of zeroed analytics', async () => {
  const markup = await renderProgress([]);
  assert.ok(markup.includes('id="performance"'), 'the destination still exists');
  assert.ok(markup.includes('Once you complete a practice session or a mock'));
  assert.ok(markup.includes('No completed attempts yet'));
  assert.ok(!markup.includes('role="progressbar"'), 'no 0% bars');
  assert.ok(!markup.includes('Questions answered'), 'no zeroed overall row');
});

test('Progress keeps one h1 and its mistake-bank entry point', async () => {
  const markup = await renderProgress([fullMock]);
  assert.equal((markup.match(/<h1/g) ?? []).length, 1);
  assert.ok(markup.includes('href="/progress/mistakes"'));
  assert.ok(markup.includes('mistakes to revisit'));
  assert.ok(markup.includes('href="/progress/results/exam/mock-1"'));
});

test('a full result shows the scaled score, target comparison and breakdowns', async () => {
  const markup = await renderResult(fullMock, { target_score: 280 });

  assert.ok(markup.includes('JAMB Mock'));
  assert.ok(markup.includes('240'));
  assert.ok(markup.includes('/ 400'));
  assert.ok(markup.includes('Estimated mock score'), 'the scaled caveat survives');
  assert.ok(markup.includes('not an official JAMB score'));
  assert.ok(markup.includes('Target 280'));
  assert.ok(markup.includes('40 points away'), '280 - 240');

  assert.ok(markup.includes('Subject breakdown'));
  assert.ok(markup.includes('Topic breakdown'));
  assert.ok(markup.includes('role="progressbar"'), 'accuracy bars keep their value semantics');
  assert.ok(markup.includes('aria-valuenow'), 'and expose the value, not just the fill');
  assert.ok(markup.includes('aria-label="Physics accuracy"'));
  assert.ok(markup.includes('Practise Waves'), 'the weak topic offers a revision session');
  assert.ok(markup.includes('Answer review'));
  assert.equal((markup.match(/<h1/g) ?? []).length, 1);
});

test('a sparse result claims no target, no weakness and no scaling it does not have', async () => {
  const markup = await renderResult(sparsePractice, null, { kind: 'practice', id: 'prac-1' });

  assert.ok(markup.includes('One mark per correct answer'), 'raw scoring is labelled as raw');
  assert.ok(!markup.includes('Estimated mock score'));
  assert.ok(!markup.includes('Target '), 'no target comparison without a target');
  assert.ok(markup.includes('No categorised topic scored below 70%'));
  assert.ok(!markup.includes('Practise Waves'), 'a strong topic is not offered as revision');
  // Nothing beyond what was graded.
  assert.ok(!/readiness|percentile|mastery score|trend/i.test(markup));
});

test('the mistake bank distinguishes never-started from filtered-to-nothing', async () => {
  const empty = await renderMistakes([]);
  assert.ok(empty.includes('Your mistake bank is empty'));
  assert.ok(empty.includes('Complete a practice session or a mock'));
  assert.ok(empty.includes('href="/practice"'));
  assert.ok(!empty.includes('Clear filters'), 'there is nothing to clear');

  const filtered = await renderMistakes([fullMock], { subject: 'chemistry' });
  assert.ok(filtered.includes('No questions match these filters'));
  assert.ok(filtered.includes('Try another subject'));
  assert.ok(filtered.includes('Clear filters'));
  assert.ok(!filtered.includes('Your mistake bank is empty'), 'the two states never collapse');
});

test('the mistake bank keeps its filters, badges, revision actions and rows', async () => {
  const markup = await renderMistakes([fullMock]);

  assert.ok(markup.includes('id="mistakes-subject"'));
  assert.ok(markup.includes('id="mistakes-topic"'));
  assert.ok(markup.includes('id="mistakes-status"'));
  assert.ok(markup.includes('for="mistakes-subject"'), 'every filter is labelled');
  assert.ok(markup.includes('Apply filters'));

  assert.ok(markup.includes('Practise my mistakes'), 'revision entry point survives');
  assert.ok(markup.includes('Streak 0 of 2'), 'mastery progress is stated in words, not colour');
  assert.ok(markup.includes('#answer-review'));
  assert.ok(markup.includes('missed'), 'failure counts are preserved');
});

test('loading screens render skeletons and announce themselves', () => {
  for (const [name, Loading] of [['progress', ProgressLoading], ['result', ResultLoading], ['exam', ExamLoading]]) {
    const markup = renderToStaticMarkup(h(Loading));
    assert.ok(markup.includes('animate-pulse'), `${name} uses the shared Skeleton`);
    assert.ok(markup.includes('motion-reduce:animate-none'), `${name} respects reduced motion`);
    assert.ok(markup.includes('role="status"'), `${name} announces that it is loading`);
    assert.ok(markup.includes('aria-busy="true"'), `${name} marks itself busy`);
  }
});

test('the exam loading screen is presentation only', async () => {
  // A loading screen that could touch the session is a loading screen that can
  // corrupt one. Its module graph must stay free of session and offline code.
  const source = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../app/exam/[attemptId]/loading.tsx', import.meta.url), 'utf8'),
  );
  for (const forbidden of ['features/offline', 'features/exams', 'features/practice', 'use client']) {
    assert.ok(!source.includes(forbidden), `loading.tsx must not reference ${forbidden}`);
  }
  assert.ok(renderToStaticMarkup(h(ExamLoading)).includes('Loading your exam'));
});

test('error screens speak plainly and leak nothing technical', () => {
  const error = Object.assign(
    new Error('PostgresError: relation "public.exam_attempts" does not exist at Object.<anonymous> (/app/lib/supabase.ts:42)'),
    { digest: '3819274012' },
  );

  for (const [name, RouteError] of [['progress', ProgressError], ['exam', ExamError]]) {
    const markup = renderToStaticMarkup(h(RouteError, { error, reset: () => {} }));

    assert.ok(!markup.includes('PostgresError'), `${name} hides the provider`);
    assert.ok(!markup.includes('exam_attempts'), `${name} hides the schema`);
    assert.ok(!markup.includes('supabase'), `${name} hides the backend`);
    assert.ok(!markup.includes('3819274012'), `${name} hides the digest`);
    assert.ok(!markup.includes('/app/lib'), `${name} hides the stack`);

    assert.ok(markup.includes('Try again'), `${name} offers a retry`);
    assert.ok(markup.includes('href='), `${name} offers a way out when retry is not enough`);
    assert.ok(markup.includes('role="status"'), `${name} is announced`);
  }
});

test('the exam error screen reassures without promising anything about state', () => {
  const markup = renderToStaticMarkup(h(ExamError, { error: new Error('boom'), reset: () => {} }));
  assert.ok(markup.includes('every answer already saved are untouched'));
  assert.ok(markup.includes('href="/home"'));
  assert.ok(!markup.includes('boom'));
});
