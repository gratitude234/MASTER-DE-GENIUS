import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { registerTsxHook } from '../scripts/tsx-hook.mjs';

registerAliasHook();
registerTsxHook();

const stub = (source) => ({ url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true });

/*
 * Home is an async Server Component. Everything it renders is real — only the
 * three data reads and the Next.js runtime are replaced, so these tests cover
 * the page's own branching rather than a re-implementation of it.
 */
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/link') {
      return { url: new URL('./stubs/next-link.mjs', import.meta.url).href, shortCircuit: true };
    }
    if (specifier === 'next/navigation') {
      return stub(`export function useRouter(){ return { push(){} }; }`);
    }
    if (specifier === '@/lib/supabase/server') return stub('export async function createClient(){ return {}; }');
    if (specifier === '@/features/exam-context/service') return stub('export async function getStudentExamPreferences(){ return []; }');
    if (specifier === '@/features/profile/queries') {
      return stub(`export async function getStudentProfile(){ return globalThis.__profile; }`);
    }
    if (specifier === '@/features/exams/service') {
      return stub(`export async function getActiveExamAttemptSummaryForUser(){ return globalThis.__activeExam ?? null; }`);
    }
    if (specifier === '@/features/results/service') {
      return stub(`export async function loadHistory(){ return globalThis.__history ?? []; }`);
    }
    if (specifier === "@/features/billing/usage") return { url: new URL("./stubs/billing-usage.mjs", import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
});

const React = (await import('react')).default;
const { prerenderToNodeStream } = await import('react-dom/static');

const HomePage = (await import('../app/(student)/home/page.tsx')).default;
const { recommendPractice, latestMockSummary, WEAK_ACCURACY_THRESHOLD } = await import(
  '../features/home/recommendation.ts'
);

const EXAM_BODY = 'jamb-id';

globalThis.__profile = {
  user: { id: 'user-1', email: 'ada@example.com' },
  profile: { full_name: 'Ada Nwosu' },
  preference: { exam_body_id: EXAM_BODY, exam_year: 2027 },
  examBody: { code: 'jamb', short_name: 'JAMB', name: 'JAMB' },
};

/** One graded question, shaped the way `mistakeBank` and `breakdown` read it. */
function item(id, subjectSlug, subjectName, topicSlug, topicName, outcome) {
  return {
    id,
    position: 1,
    question: {
      examBody: 'jamb',
      subject: { id: subjectSlug, slug: subjectSlug, name: subjectName },
      topic: topicSlug ? { slug: topicSlug, name: topicName } : null,
      source: { provider: 'internal', providerQuestionId: id },
      prompt: 'Q',
      options: [],
      assets: [],
    },
    selected: outcome === 'unanswered' ? null : 'A',
    correct: outcome === 'correct' ? 'A' : 'B',
    explanation: null,
    outcome,
    flagged: false,
  };
}

/** Builds the breakdowns the page reads, from a list of graded items. */
function result({ id, kind = 'exam', completedAt, items, score, maximum, scaled = false }) {
  const group = (byTopic) => {
    const rows = new Map();
    for (const entry of items) {
      const { subject, topic } = entry.question;
      const key = JSON.stringify([subject.slug, byTopic ? topic?.slug ?? null : null]);
      const row = rows.get(key) ?? {
        key,
        name: byTopic ? topic?.name ?? 'Uncategorised' : subject.name,
        subjectSlug: subject.slug,
        topicSlug: byTopic ? topic?.slug ?? null : null,
        total: 0, correct: 0, incorrect: 0, unanswered: 0, accuracy: 0,
      };
      row.total++;
      row[entry.outcome]++;
      row.accuracy = Math.round((100 * row.correct) / row.total);
      rows.set(key, row);
    }
    return [...rows.values()];
  };

  return {
    id, kind, examBodyId: EXAM_BODY, title: 'Attempt', completedAt, startedAt: completedAt,
    elapsedSeconds: 60, total: items.length,
    correct: items.filter((i) => i.outcome === 'correct').length,
    incorrect: items.filter((i) => i.outcome === 'incorrect').length,
    unanswered: items.filter((i) => i.outcome === 'unanswered').length,
    accuracy: 50, score, maximum, scaled,
    subjects: group(false), topics: group(true), items,
  };
}

async function renderHome() {
  const { prelude } = await prerenderToNodeStream(React.createElement(HomePage));
  let markup = '';
  for await (const chunk of prelude) markup += chunk;
  // React SSR separates adjacent text nodes with empty comments; drop them so
  // assertions can read the copy the way a student does.
  return markup.replace(/<!--.*?-->/g, '');
}

function setState({ history = [], activeExam = null } = {}) {
  globalThis.__history = history;
  globalThis.__activeExam = activeExam;
}

// One weak topic (1/4 = 25%) and one strong one, inside a single mock.
const weakItems = [
  item('p1', 'physics', 'Physics', 'waves', 'Waves', 'correct'),
  item('p2', 'physics', 'Physics', 'waves', 'Waves', 'incorrect'),
  item('p3', 'physics', 'Physics', 'waves', 'Waves', 'incorrect'),
  item('p4', 'physics', 'Physics', 'waves', 'Waves', 'incorrect'),
  item('c1', 'chemistry', 'Chemistry', 'moles', 'Moles', 'correct'),
  item('c2', 'chemistry', 'Chemistry', 'moles', 'Moles', 'correct'),
];

const previousMock = result({ id: 'mock-old', completedAt: '2026-01-01T09:00:00Z', items: weakItems, score: 180, maximum: 400, scaled: true });
const latestMock = result({ id: 'mock-new', completedAt: '2026-02-01T09:00:00Z', items: weakItems, score: 240, maximum: 400, scaled: true });

test('cold-start Home welcomes the student and offers one dominant first action', async () => {
  setState();
  const markup = await renderHome();

  assert.ok(markup.includes('Welcome back, Ada.'), 'greeting uses the first name');
  assert.ok(markup.includes('JAMB 2027 Preparation'), 'exam context is shown');
  assert.ok(markup.includes('Your first practice session'));
  assert.ok(markup.includes('Start practice'));
  assert.ok(markup.includes('Quick actions'), 'quick actions survive the cold start');
  assert.ok(markup.includes('Your progress will appear here'), 'the analytics space explains itself');
});

test('cold-start Home shows no zeroed analytics dressed up as progress', async () => {
  setState();
  const markup = await renderHome();

  assert.ok(!markup.includes('Latest mock'));
  assert.ok(!markup.includes('Subject performance'));
  assert.ok(!markup.includes('Weak areas'));
  assert.ok(!markup.includes('ready for review'), 'no 0-mistake counter');
  assert.ok(!markup.includes('Continue learning'), 'nothing is claimed to be weak');
});

test('WAEC Home offers timed subject practice instead of a JAMB full mock', async () => {
  const original = globalThis.__profile;
  globalThis.__profile = {
    ...original,
    examBody: { code: 'waec', short_name: 'WAEC', name: 'WAEC' },
    preference: { ...original.preference, exam_year: 2027 },
  };
  setState();
  const markup = await renderHome();
  assert.ok(markup.includes('Timed Subject'));
  assert.ok(markup.includes('href="/practice?timed=1"'));
  assert.ok(!markup.includes('JAMB conditions'));
  globalThis.__profile = original;
});

test('Home never renders a readiness score or a days-to-exam countdown', async () => {
  for (const state of [{}, { history: [latestMock] }]) {
    setState(state);
    const markup = await renderHome();
    // Neither has an agreed formula or a real source, so neither may appear.
    assert.ok(!markup.includes('Readiness'), 'no readiness chip');
    assert.ok(!markup.includes('days to'), 'no exam countdown');
    assert.ok(!markup.includes('this month'), 'no invented trend');
  }
});

test('Home exposes exactly one page-level heading', async () => {
  setState({ history: [previousMock, latestMock] });
  const markup = await renderHome();
  assert.equal((markup.match(/<h1/g) ?? []).length, 1);
  assert.ok((markup.match(/<h2/g) ?? []).length >= 2, 'sections are h2s beneath it');
});

test('36. an active exam is surfaced at the top with a prominent resume control', async () => {
  setState({
    activeExam: {
      id: 'attempt-9', examName: 'JAMB', status: 'in_progress',
      answeredCount: 12, flaggedCount: 2, totalQuestions: 180,
      startedAt: '2026-02-02T09:00:00Z',
      expiresAt: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
    },
  });
  const markup = await renderHome();

  assert.ok(markup.includes('Exam in progress'));
  assert.ok(markup.includes('12/180 answered'));
  assert.ok(markup.includes('Resume exam'));
  assert.ok(markup.includes('href="/exam/attempt-9"'), 'resume routing is unchanged');
  // Full control height, not a text-sized link.
  assert.ok(markup.includes('h-11'));
  // It outranks every suggestion the product might make.
  assert.ok(
    markup.indexOf('Exam in progress') < markup.indexOf('Quick actions'),
    'unfinished work comes before the shortcuts',
  );
  assert.equal((markup.match(/Resume exam/g) ?? []).length, 1, 'never two resume cards for one attempt');
});

test('44. one progress card carries the mock, the mistakes and the weakest subject', async () => {
  setState({ history: [previousMock, latestMock] });
  const markup = await renderHome();

  assert.ok(markup.includes('Your progress'));
  assert.ok(markup.includes('Latest mock'));
  assert.ok(markup.includes('240/400'), 'the latest mock score');
  assert.ok(markup.includes('Estimated JAMB score'), 'scaled scores are labelled as estimates');
  assert.ok(markup.includes('href="/progress/results/exam/mock-new"'));

  assert.ok(markup.includes('Mistakes to review'));
  assert.ok(markup.includes('Physics'), 'the weakest subject in the latest attempt');
  assert.ok(markup.includes('View progress'));

  /*
   * The three cards this replaced. Their absence is the deliverable: Latest
   * Mock, Mistakes Ready and Subject Performance each had their own full-width
   * panel, which is what made the dashboard unreadable on a phone.
   */
  assert.ok(!markup.includes('Subject performance'), 'no separate subject card');
  assert.ok(!markup.includes('ready for review'), 'no separate mistakes card');
  assert.ok(!markup.includes('Weak areas'), 'no separate weak-areas card');
  assert.ok(!markup.includes('your previous mock'), 'the delta lives on the progress page now');
});

test('37. one recommendation card targets the weakest topic and starts a revision session', async () => {
  setState({ history: [latestMock] });
  const markup = await renderHome();

  assert.ok(markup.includes('Continue learning'));
  assert.ok(markup.includes('Continue Waves'));
  assert.ok(markup.includes('Practise Waves'));
  assert.ok(markup.includes('1 of 4 correct on your latest attempt'));
  assert.equal((markup.match(/Continue learning/g) ?? []).length, 1, 'one card, never a stack');
  // Real accuracy from the attempt, and no hardcoded subject anywhere.
  // The shortcut tile carries ?quick=1, which Practice Setup now reads to
  // preselect this same recommendation. Nothing links to a parameter that is
  // ignored: ?quick=waves, the old hardcoded target, is gone for good.
  assert.ok(!markup.includes('quick=waves'));
});

test('recommendation prefers the weakest topic in the most recent attempt', () => {
  const recommendation = recommendPractice([previousMock, latestMock], EXAM_BODY);
  assert.equal(recommendation.kind, 'topic');
  assert.equal(recommendation.topicSlug, 'waves');
  assert.equal(recommendation.subjectSlug, 'physics');
  assert.equal(recommendation.subjectName, 'Physics');
  assert.equal(recommendation.accuracy, 25);
  assert.equal(recommendation.resultId, 'mock-new', 'the newest attempt wins');
});

test('recommendation falls back to a weak subject when no topic is categorised', () => {
  const uncategorised = result({
    id: 'r1', kind: 'practice', completedAt: '2026-03-01T09:00:00Z', score: 1, maximum: 4,
    items: [
      item('u1', 'biology', 'Biology', null, null, 'correct'),
      item('u2', 'biology', 'Biology', null, null, 'incorrect'),
      item('u3', 'biology', 'Biology', null, null, 'incorrect'),
      item('u4', 'biology', 'Biology', null, null, 'incorrect'),
    ],
  });

  const recommendation = recommendPractice([uncategorised], EXAM_BODY);
  assert.equal(recommendation.kind, 'subject');
  assert.equal(recommendation.subjectSlug, 'biology');
  assert.equal(recommendation.accuracy, 25);
});

test('recommendation refuses to invent a weakness when nothing is weak', () => {
  const strong = result({
    id: 'r2', kind: 'practice', completedAt: '2026-03-02T09:00:00Z', score: 2, maximum: 2,
    items: [
      item('s1', 'physics', 'Physics', 'waves', 'Waves', 'correct'),
      item('s2', 'physics', 'Physics', 'waves', 'Waves', 'correct'),
    ],
  });

  assert.deepEqual(recommendPractice([strong], EXAM_BODY), { kind: 'start', hasHistory: true });
  assert.deepEqual(recommendPractice([], EXAM_BODY), { kind: 'start', hasHistory: false });
  // A different exam body's history must not leak into this one's advice.
  assert.deepEqual(recommendPractice([strong], 'other-exam'), { kind: 'start', hasHistory: false });
});

test('the weakness threshold is the same 70% the results page uses', () => {
  assert.equal(WEAK_ACCURACY_THRESHOLD, 70);
});

test('latest mock summary ignores practice sessions and reports a null first delta', () => {
  const practice = result({ id: 'p', kind: 'practice', completedAt: '2026-04-01T09:00:00Z', items: weakItems, score: 2, maximum: 6 });

  assert.equal(latestMockSummary([practice], EXAM_BODY), null, 'a practice session is not a mock');
  assert.equal(latestMockSummary([latestMock, practice], EXAM_BODY).delta, null);
  assert.equal(latestMockSummary([previousMock, latestMock], EXAM_BODY).id, 'mock-new');
  assert.equal(latestMockSummary([previousMock, latestMock], EXAM_BODY).delta, 60);
});

// ───────────────────────────────── the Free plan card, and the page ordering

const { ACTIVE_PRACTICE, freeUsage } = await import('./stubs/billing-usage.mjs');

async function renderFreeHome(usage, state = {}) {
  setState(state);
  globalThis.__usage = usage;
  try {
    return await renderHome();
  } finally {
    globalThis.__usage = undefined;
  }
}

test('39/42/43. a Free student sees today’s real counts in the compact card', async () => {
  const markup = await renderFreeHome(freeUsage({ practice: { used: 0 }, mocks: { used: 1 } }));

  assert.ok(markup.includes('Free plan'));
  assert.ok(markup.includes('1 practice session available today'));
  assert.ok(markup.includes('1 of 2 remaining this month'));
  assert.ok(markup.includes('2 of 2 remaining today'));
  assert.ok(markup.includes('href="/pricing?source=dashboard#plans"'));
});

test('40/41. the practice row follows the session: in progress, then used', async () => {
  const running = await renderFreeHome(freeUsage({ practice: { used: 1, activeSession: ACTIVE_PRACTICE } }));
  assert.ok(running.includes('Session in progress'));
  assert.ok(running.includes('href="/practice/session/session-1"'), 'and it can be resumed');

  const finished = await renderFreeHome(freeUsage({ practice: { used: 1 } }));
  assert.ok(finished.includes('Today’s session used'));
  assert.ok(!finished.includes('Session in progress'));
});

test('34/35. the dashboard carries one upgrade CTA above the fold and one in the card', async () => {
  const markup = await renderFreeHome(freeUsage());
  const ctas = [...markup.matchAll(/href="\/pricing\?source=([a-z_]+)#plans"/g)].map((match) => match[1]);

  assert.deepEqual(ctas, ['dashboard', 'dashboard'], 'the header button and the plan card — nothing else');
  assert.ok(!markup.includes('nav_mobile'), 'no strip: the header already carries it');
  assert.ok(!markup.includes('Master from'), 'no price line competing with the study surface');
});

test('47. the page reads in the agreed priority order', async () => {
  const markup = await renderFreeHome(
    freeUsage({ practice: { used: 1, activeSession: ACTIVE_PRACTICE } }),
    { history: [previousMock, latestMock] },
  );

  // The plan card is matched by its own heading id: "Free plan" also appears as
  // the small badge beside the student's name, which is deliberate and earlier.
  const order = [
    'Welcome back, Ada.', 'Practice in progress', 'Continue learning',
    'Quick actions', 'id="free-plan-heading"', 'Your progress',
  ];
  const positions = order.map((label) => markup.indexOf(label));
  for (const [index, position] of positions.entries()) {
    assert.ok(position > 0, order[index] + ' is missing');
    if (index > 0) {
      assert.ok(position > positions[index - 1], order[index] + ' must come after ' + order[index - 1]);
    }
  }
});

test('45. the tutoring recommendation sits below everything a student studies with', async () => {
  const markup = await renderFreeHome(freeUsage(), { history: [previousMock, latestMock] });
  const tutor = markup.indexOf('Get Tutor Help');

  if (tutor > 0) {
    assert.ok(tutor > markup.indexOf('Quick actions'), 'never above Practice and Mock');
    assert.ok(tutor > markup.indexOf('Your progress'), 'never above Progress');
  }
});

test('46. an active Master student sees no Free card and no sales copy', async () => {
  setState();
  const markup = await renderHome();
  assert.ok(!markup.includes('Free plan'));
  assert.ok(!markup.includes('Upgrade to Master'));
  assert.ok(markup.includes('Master'), 'their plan status is still shown');
});
