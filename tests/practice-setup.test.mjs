import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { registerTsxHook } from '../scripts/tsx-hook.mjs';

registerAliasHook();
registerTsxHook();

// The real ALOC provider is used for capability and availability decisions, so
// these tests assert what a student is actually offered. No request is made:
// capabilities and subject mapping are pure lookups.
process.env.QUESTION_PROVIDER = 'aloc';
process.env.ALOC_ACCESS_TOKEN = 'test-token-never-logged';
process.env.ALOC_BASE_URL = 'https://questions.aloc.test/api/v2';

const stub = (source) => ({ url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true });

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/link') {
      return { url: new URL('./stubs/next-link.mjs', import.meta.url).href, shortCircuit: true };
    }
    if (specifier === 'next/navigation') {
      return stub(`export function useRouter(){ return { push(){} }; }`);
    }
    if (specifier === '@/lib/auth') {
      return stub(`export async function requireOnboardedUser(){ return { user: { id: 'user-1' } }; }`);
    }
    if (specifier === '@/features/questions/catalog') {
      return stub(`export async function getPracticeCatalog(){ return globalThis.__catalog; }`);
    }
    if (specifier === '@/features/practice/service') {
      return stub(`export async function getLatestActivePracticeSessionForUser(){ return globalThis.__resume ?? null; }`);
    }
    if (specifier === '@/features/results/service') {
      return stub(`export async function loadHistory(){ globalThis.__historyReads = (globalThis.__historyReads ?? 0) + 1; return globalThis.__history ?? []; }`);
    }
    return next(specifier, context);
  },
});

const React = (await import('react')).default;
const { prerenderToNodeStream } = await import('react-dom/static');

const PracticePage = (await import('../app/(student)/practice/page.tsx')).default;
const { practiceModeSummary } = await import('../components/practice/practice-setup.tsx');
const { TIMED_SECONDS_PER_QUESTION } = await import('../features/practice/types.ts');
const { getPracticeFilterCapabilities, unavailableSubjectSlugs } = await import(
  '../features/questions/service.ts'
);
const { navClearance } = await import('../components/ui/variants.ts');

const EXAM_BODY = 'jamb-id';

const subject = (slug, name, topics = []) => ({
  id: slug, slug, name, isCompulsory: false, displayOrder: 1,
  topics: topics.map((t) => ({ id: `${slug}-${t}`, subjectId: slug, slug: t, name: t.replace(/^./, (c) => c.toUpperCase()), displayOrder: 1 })),
});

globalThis.__catalog = {
  examCode: 'jamb',
  examBodyId: EXAM_BODY,
  examName: 'JAMB',
  examYear: 2027,
  subjects: [
    subject('physics', 'Physics', ['waves']),
    subject('chemistry', 'Chemistry', ['moles']),
    // Quarantined upstream — the real provider decides, not this fixture.
    subject('agricultural-science', 'Agricultural Science'),
  ],
};

function item(id, subjectSlug, subjectName, topicSlug, topicName, outcome) {
  return {
    id, position: 1,
    question: {
      examBody: 'jamb',
      subject: { id: subjectSlug, slug: subjectSlug, name: subjectName },
      topic: topicSlug ? { slug: topicSlug, name: topicName } : null,
      source: { provider: 'aloc', providerQuestionId: id },
      prompt: 'Q', options: [], assets: [],
    },
    selected: 'A', correct: outcome === 'correct' ? 'A' : 'B', explanation: null, outcome, flagged: false,
  };
}

function result(id, items) {
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
  return {
    id, kind: 'practice', examBodyId: EXAM_BODY, title: 'Attempt',
    completedAt: '2026-05-01T09:00:00Z', startedAt: '2026-05-01T09:00:00Z', elapsedSeconds: 60,
    total: items.length, correct: 0, incorrect: 0, unanswered: 0, accuracy: 25,
    score: 1, maximum: items.length, scaled: false,
    subjects: group(false), topics: group(true), items,
  };
}

const weakWaves = result('r1', [
  item('a', 'physics', 'Physics', 'waves', 'Waves', 'correct'),
  item('b', 'physics', 'Physics', 'waves', 'Waves', 'incorrect'),
  item('c', 'physics', 'Physics', 'waves', 'Waves', 'incorrect'),
  item('d', 'physics', 'Physics', 'waves', 'Waves', 'incorrect'),
]);

const weakUncategorised = result('r2', [
  item('e', 'chemistry', 'Chemistry', null, null, 'correct'),
  item('f', 'chemistry', 'Chemistry', null, null, 'incorrect'),
  item('g', 'chemistry', 'Chemistry', null, null, 'incorrect'),
  item('h', 'chemistry', 'Chemistry', null, null, 'incorrect'),
]);

async function renderPractice(searchParams = {}, { history = [], resume = null } = {}) {
  globalThis.__history = history;
  globalThis.__resume = resume;
  const { prelude } = await prerenderToNodeStream(
    React.createElement(PracticePage, { searchParams: Promise.resolve(searchParams) }),
  );
  let markup = '';
  for await (const chunk of prelude) markup += chunk;
  return markup.replace(/<!--.*?-->/g, '');
}

test('Practice is the default tab and Past questions is offered beside it', async () => {
  const markup = await renderPractice();
  assert.ok(markup.includes('Build a focused session'));
  assert.ok(markup.includes('href="/practice?mode=past"'));
  assert.ok(markup.includes('aria-label="Practice mode"'), 'the switch is a navigation landmark');
  // Exactly one entry may claim to be the current page.
  assert.equal((markup.match(/aria-current="page"/g) ?? []).length, 1);
});

test('?mode=past opens Past questions directly, with the year filter', async () => {
  const markup = await renderPractice({ mode: 'past' });
  assert.ok(markup.includes('Practise by exam year'));
  assert.ok(markup.includes('Exam year'));
  assert.ok(markup.includes('All years'));
  assert.ok(markup.includes('>2027<') && markup.includes('>2018<'), 'ten years back from the exam year');
  assert.ok(markup.includes('href="/practice"'), 'the way back to Practice stays visible');
  assert.equal((markup.match(/aria-current="page"/g) ?? []).length, 1);
});

test('?timed=1 preselects timed mode without starting a session', async () => {
  const markup = await renderPractice({ timed: '1' });
  assert.ok(markup.includes('<strong class="font-bold text-slate-950">Timed:</strong>'));
  assert.ok(markup.includes('Start 20-question session'));
  assert.ok(!markup.includes('/practice/session/'));
});

test('Past questions does not read history it has nothing to do with', async () => {
  globalThis.__historyReads = 0;
  await renderPractice({ mode: 'past' }, { history: [weakWaves] });
  assert.equal(globalThis.__historyReads, 0);

  await renderPractice({}, { history: [weakWaves] });
  assert.equal(globalThis.__historyReads, 1, 'the Practice tab still resolves a recommendation');
});

test('quick practice names the weakest topic from the shared recommendation', async () => {
  const markup = await renderPractice({}, { history: [weakWaves] });
  assert.ok(markup.includes('Quick practice'));
  assert.ok(markup.includes('1 of 4 correct (25%) in your latest attempt'));
  // ALOC cannot filter by topic, so the topic name is shown but never applied
  // as a filter — the shortcut falls back to the whole subject.
  assert.ok(markup.includes('Physics'));
  assert.ok(!markup.includes('Waves'), 'a topic the provider cannot serve is not offered as one');
});

test('quick practice falls back to the subject when no topic is usable', async () => {
  const markup = await renderPractice({}, { history: [weakUncategorised] });
  assert.ok(markup.includes('Chemistry'));
  assert.ok(markup.includes('1 of 4 correct (25%) in your latest attempt'));
});

test('quick practice claims nothing when there is no history', async () => {
  const markup = await renderPractice();
  assert.ok(markup.includes('Start a practice session'));
  assert.ok(markup.includes('Once you finish a session, this shortcut targets whatever needs the most work.'));
  assert.ok(!markup.includes('in your latest attempt'), 'no weakness is invented');
});

test('?quick=1 preselects the recommended subject without starting anything', async () => {
  const markup = await renderPractice({ quick: '1' }, { history: [weakUncategorised] });

  // Chemistry is second in the catalogue, so a preselection is visible: it, not
  // the first subject, carries the pressed state.
  const pressed = [...markup.matchAll(/aria-pressed="true"[^>]*>([^<]+)/g)].map((m) => m[1].trim());
  assert.ok(pressed.includes('Chemistry'), `expected Chemistry preselected, got ${pressed.join(', ')}`);
  assert.ok(!pressed.includes('Physics'));

  // Prefilling is not starting: the student still has to press the button.
  assert.ok(markup.includes('Start 20-question session'));
  assert.ok(!markup.includes('/practice/session/'));
});

test('unsupported provider filters are absent, with the reason shown instead', async () => {
  const capabilities = getPracticeFilterCapabilities();
  assert.equal(capabilities.topics, false, 'ALOC cannot filter by topic');
  assert.equal(capabilities.difficulty, false, 'ALOC cannot filter by difficulty');
  assert.equal(capabilities.years, true);

  const markup = await renderPractice();
  assert.ok(!markup.includes('id="practice-topic"'), 'no dead topic control');
  assert.ok(!markup.includes('id="practice-difficulty"'), 'no dead difficulty control');
  assert.ok(markup.includes('Whole-subject practice'));
  assert.ok(markup.includes('Topic filtering will be available with an expanded question source.'));
});

test('the year control appears only on the tab that can use it', async () => {
  assert.ok(!(await renderPractice()).includes('id="practice-year"'));
  assert.ok((await renderPractice({ mode: 'past' })).includes('id="practice-year"'));
});

test('Agricultural Science is offered as unavailable, in student language', async () => {
  // The quarantine decision comes from the provider, not from this test.
  assert.deepEqual(
    unavailableSubjectSlugs('jamb', ['physics', 'chemistry', 'agricultural-science']),
    ['agricultural-science'],
  );

  const markup = await renderPractice();
  const button = markup.match(/<button[^>]*>(?:(?!<\/button>).)*Agricultural Science(?:(?!<\/button>).)*<\/button>/s)?.[0];
  assert.ok(button, 'the subject is still listed');
  assert.ok(button.includes('disabled'), 'but cannot be selected');
  assert.ok(button.includes('Not available yet'));
  assert.ok(button.includes('not in our current question source'), 'the reason is available to a screen reader');
  assert.ok(!button.includes('aria-pressed'), 'an unselectable subject is not a toggle');
});

test('timed mode states its question count, time limit and when answers appear', () => {
  const timed = practiceModeSummary('timed', 20);
  assert.equal(timed.label, 'Timed');
  assert.ok(timed.detail.includes('20 questions in 20 minutes'));
  assert.ok(timed.detail.includes('not marked as you go'));
  assert.ok(timed.detail.includes('when the session ends or time runs out'));

  // Derived from the server's own rule rather than restated.
  assert.equal(TIMED_SECONDS_PER_QUESTION, 60);
  assert.ok(practiceModeSummary('timed', 40).detail.includes('40 questions in 40 minutes'));

  const practice = practiceModeSummary('practice', 10);
  assert.equal(practice.label, 'Practice');
  assert.ok(practice.detail.includes('no time limit'));
  assert.ok(practice.detail.includes('marked immediately'));
});

test('the setup screen explains the selected mode before the student commits', async () => {
  const markup = await renderPractice();
  assert.ok(markup.includes('no time limit'), 'the default mode explains itself');
  assert.ok(markup.includes('aria-live="polite"'), 'and re-announces when the mode changes');
});

test('the sticky CTA clears the tab bar through the shared token', async () => {
  const markup = await renderPractice();
  assert.ok(markup.includes(navClearance.bottom));
  // The 4.5rem/4.25rem split is exactly what the token exists to prevent.
  assert.ok(!markup.includes('4.5rem'));
  assert.ok(!markup.includes('bottom-[calc('));
});

test('practice surfaces carry no raw product blue', async () => {
  for (const params of [{}, { mode: 'past' }]) {
    const markup = await renderPractice(params, { history: [weakWaves], resume: { id: 's1', subjectName: 'Physics', mode: 'practice', answeredCount: 3, questionCount: 20 } });
    assert.ok(!/\b(?:bg|text|border|ring)-(?:blue|indigo)-\d/.test(markup));
  }
});

test('the capability gate follows the provider rather than being hardcoded off', async () => {
  // Same screen, a provider that can filter by topic: the control comes back.
  process.env.QUESTION_PROVIDER = 'internal';
  try {
    assert.equal(getPracticeFilterCapabilities().topics, true);

    const markup = await renderPractice();
    assert.ok(markup.includes('id="practice-topic"'), 'a supported filter is offered');
    assert.ok(markup.includes('All topics'));
    assert.ok(!markup.includes('Whole-subject practice'), 'and the explanation for its absence is gone');
  } finally {
    process.env.QUESTION_PROVIDER = 'aloc';
  }
});
