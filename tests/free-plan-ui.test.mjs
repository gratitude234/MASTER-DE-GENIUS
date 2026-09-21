import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { registerHooks } from 'node:module';

import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { registerTsxHook } from '../scripts/tsx-hook.mjs';

registerAliasHook();
registerTsxHook();

/**
 * Free plan v2 — what a student sees.
 *
 * Every count rendered here is supplied by the test in the shape the server's
 * usage summary produces; the components only draw it. The assertions are on
 * real markup: the exact sentences, where each "Upgrade to Master" goes, what a
 * Master student does *not* see, and the singular/plural grammar.
 */

const stub = (source) => ({ url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true });

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/link') {
      return { url: new URL('./stubs/next-link.mjs', import.meta.url).href, shortCircuit: true };
    }
    if (specifier === 'next/image') {
      return { url: new URL('./stubs/next-image.mjs', import.meta.url).href, shortCircuit: true };
    }
    if (specifier === 'next/navigation') {
      return stub(`export function usePathname(){ return globalThis.__pathname ?? '/home'; }
        export function useSearchParams(){ return new URLSearchParams(''); }
        export function useRouter(){ return { push(){}, refresh(){} }; }`);
    }
    if (specifier === '@/features/offline/use-session') {
      return stub('export function useOfflineSession(){ return globalThis.__sync; }');
    }
    return next(specifier, context);
  },
});

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const h = React.createElement;
const html = (element) => renderToStaticMarkup(element).replace(/<!--.*?-->/g, '').replace(/&#x27;/g, "'");

const { StudentNavigation } = await import('../components/app-shell/student-navigation.tsx');
const { PlanStrip } = await import('../components/billing/plan-status.tsx');
const { FreePlanCard } = await import('../components/billing/free-plan-card.tsx');
const { HomeHeader } = await import('../components/home/home-header.tsx');
const { ResumeCard } = await import('../components/home/resume-card.tsx');
const { ProgressSummaryCard } = await import('../components/home/progress-summary-card.tsx');
const { ContinueLearningCard } = await import('../components/home/continue-learning-card.tsx');
const { QuickActions } = await import('../components/home/quick-actions.tsx');
const { resumeItem } = await import('../features/home/resume.ts');
const { PracticeSetup, allowedQuestionCounts } = await import('../components/practice/practice-setup.tsx');
const { PracticeSessionRunner } = await import('../components/practice/practice-session-runner.tsx');
const { MockExamSetup } = await import('../components/exam/mock-exam-setup.tsx');
const { AiQuestionExplanation } = await import('../components/ai/question-explanation.tsx');
const { AiAllowanceProvider } = await import('../components/billing/ai-allowance.tsx');
const { UpgradeLink } = await import('../components/billing/upgrade-link.tsx');
const { ACTIVE_PRACTICE, freeUsage, MASTER_USAGE } = await import('./stubs/billing-usage.mjs');
const copy = await import('../features/billing/copy.ts');
const upgrade = await import('../features/billing/upgrade.ts');

const FREE_BADGE = { tier: 'free', masterUntil: null };
const MASTER_BADGE = { tier: 'master', masterUntil: '2026-12-31T00:00:00.000Z' };
const hrefs = (markup) => [...markup.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
const upgradeHrefs = (markup) => hrefs(markup).filter((href) => href.startsWith('/pricing'));

// ───────────────────────────────────────────────── the persistent shell

test('41. the Free navigation carries Upgrade to Master, one click from anywhere', () => {
  const markup = html(h(StudentNavigation, { examLabel: { shortName: 'JAMB', year: 2027 }, plan: FREE_BADGE }));
  assert.ok(markup.includes('Free plan'));
  assert.ok(markup.includes('>Upgrade to Master</a>'), 'a link with a meaningful accessible name');
  assert.deepEqual(upgradeHrefs(markup), ['/pricing?source=nav#plans']);
});

test('42. Master navigation shows the plan and its end date, and never an upgrade prompt', () => {
  const markup = html(h(StudentNavigation, { examLabel: { shortName: 'JAMB', year: 2027 }, plan: MASTER_BADGE }));
  assert.ok(!markup.includes('Upgrade to Master'));
  assert.ok(markup.includes('Master plan'));
  assert.ok(markup.includes('Access until 31 Dec 2026'));
  assert.deepEqual(upgradeHrefs(markup), []);
});

test('52. phones get the upgrade action above every major page, never covering it', () => {
  for (const pathname of ['/practice', '/mock', '/progress', '/progress/mistakes', '/me', '/classes']) {
    globalThis.__pathname = pathname;
    const markup = html(h(PlanStrip, { plan: FREE_BADGE }));
    assert.ok(markup.includes('lg:hidden'), `${pathname}: phone-only, the rail covers desktop`);
    assert.deepEqual(upgradeHrefs(markup), ['/pricing?source=nav_mobile#plans'], pathname);
    assert.ok(markup.includes('min-h-11'), `${pathname}: a comfortable touch target`);
    assert.ok(!/fixed|absolute/.test(markup), `${pathname}: in the flow, not an overlay`);
  }
  for (const pathname of ['/home', '/practice/session/abc', '/pricing', '/billing', '/billing/callback']) {
    globalThis.__pathname = pathname;
    assert.equal(html(h(PlanStrip, { plan: FREE_BADGE })), '', `${pathname}: not during a session or on the plan pages`);
  }
  globalThis.__pathname = '/practice';
  assert.equal(html(h(PlanStrip, { plan: MASTER_BADGE })), '', 'Master students never see it');
  globalThis.__pathname = undefined;
});

test('the shell renders the plan indicator once, from the server-resolved entitlement', () => {
  const shell = readFileSync('components/app-shell/student-shell.tsx', 'utf8');
  assert.equal((shell.match(/<PlanStrip /g) ?? []).length, 1);
  const layout = readFileSync('app/(student)/layout.tsx', 'utf8');
  assert.ok(layout.includes('getPlanBadge(user.id)'), 'the tier comes from the server, not the browser');
});

// ─────────────────────────────────────────────────────────── dashboard

test('39/42/43. the compact Free card shows the server counts in the specified words', () => {
  const usage = freeUsage({ practice: { used: 0 }, mocks: { used: 1 }, ai: { used: 0 } });
  const markup = html(h(FreePlanCard, { usage }));

  assert.ok(markup.includes('Free plan'));
  assert.ok(markup.includes('1 practice session available today'), 'a state, not a fraction');
  assert.ok(markup.includes('1 of 2 remaining this month'));
  assert.ok(markup.includes('2 of 2 remaining today'));
  assert.deepEqual(upgradeHrefs(markup), ['/pricing?source=dashboard#plans']);
  assert.ok(markup.includes('Resets at midnight (WAT)'), 'the reset is stated, not counted down');
  assert.ok(!/quota|ledger|reservation|entitlement/i.test(markup), 'no internal vocabulary');
  assert.ok(!/question(s)? remaining/i.test(markup), 'the cancelled per-question model is gone');
});

test('40. an unfinished session reads as in progress, and offers Resume', () => {
  const usage = freeUsage({ practice: { used: 1, activeSession: ACTIVE_PRACTICE } });
  const markup = html(h(FreePlanCard, { usage }));

  assert.ok(markup.includes('Session in progress'));
  assert.ok(!markup.includes('Today’s session used'), 'nothing has been lost, so nothing says it has');
  assert.ok(markup.includes('href="/practice/session/session-1"'), 'Resume is one tap, from the card');
  assert.ok(markup.includes('Resume session'));
});

test('41. once today’s session is finished the card says so plainly', () => {
  const markup = html(h(FreePlanCard, { usage: freeUsage({ practice: { used: 1 } }) }));

  assert.ok(markup.includes('Today’s session used'));
  assert.ok(!markup.includes('Resume session'), 'there is nothing to resume');
  assert.deepEqual(upgradeHrefs(markup), ['/pricing?source=dashboard#plans']);
});

test('the dashboard card never guesses a count it could not read', () => {
  const usage = freeUsage();
  usage.mocks = { ...usage.mocks, used: null, remaining: null };
  usage.practice = { ...usage.practice, used: null, remaining: null };
  const markup = html(h(FreePlanCard, { usage }));

  assert.ok(markup.includes('Up to 2 mocks a month'));
  assert.ok(markup.includes('Up to 1 session a day'));
  assert.ok(!markup.includes('NaN') && !markup.includes('null'));
});

test('34/35. the dashboard header carries exactly one upgrade action, and no second banner', () => {
  const markup = html(h(HomeHeader, { name: 'Ada', examLabel: 'JAMB 2027 Preparation', tier: 'free' }));

  assert.deepEqual(upgradeHrefs(markup), ['/pricing?source=dashboard#plans'], 'one, and only one');
  assert.ok(markup.includes('Welcome back, Ada.'));
  assert.ok(markup.includes('Free plan'), 'a small badge, not a panel');
  assert.ok(!/Upgrade to Master[\s\S]*Upgrade to Master/.test(markup), 'never two CTAs in the header');
});

test('46. a Master student sees their status in the header, and no sales copy anywhere', () => {
  const markup = html(h(HomeHeader, {
    name: 'Ada', examLabel: 'JAMB 2027 Preparation', tier: 'master', masterUntil: '2026-12-31T00:00:00.000Z',
  }));

  assert.deepEqual(upgradeHrefs(markup), [], 'nothing is being sold to a paying student');
  assert.ok(markup.includes('Master'));
  assert.ok(markup.includes('31 Dec'), 'the date access runs to');
  assert.ok(!markup.includes('Free plan'));
});

test('35. the mobile upgrade strip stands down on the dashboard, which has its own', () => {
  globalThis.__pathname = '/home';
  assert.equal(html(h(PlanStrip, { plan: FREE_BADGE })), '', 'no strip above a page that already has a header CTA');
  globalThis.__pathname = undefined;
});

// ────────────────────────────────────────────── dashboard: resume & progress

test('36. unfinished work appears at the top, and a mock outranks a practice session', () => {
  // `now` is injected so the time chip is exact rather than a rounding race.
  const now = Date.UTC(2026, 8, 21, 9, 0, 0);
  const activeExam = {
    id: 'attempt-1', examName: 'JAMB', totalQuestions: 180, answeredCount: 3,
    flaggedCount: 0, expiresAt: new Date(now + 76 * 60_000).toISOString(),
  };

  const both = resumeItem({ activeExam, activePractice: ACTIVE_PRACTICE, now });
  assert.equal(both.href, '/exam/attempt-1', 'the timed paper that expires wins');
  assert.equal(both.title, 'JAMB Mock in progress');
  assert.deepEqual(both.facts, ['3/180 answered', '1h 16m left']);
  assert.equal(both.actionLabel, 'Resume exam');

  const practiceOnly = resumeItem({ activeExam: null, activePractice: ACTIVE_PRACTICE, now });
  assert.equal(practiceOnly.href, '/practice/session/session-1');
  assert.deepEqual(practiceOnly.facts, ['6/20 answered']);

  assert.equal(resumeItem({ activeExam: null, activePractice: null }), null, 'nothing to resume, nothing shown');
});

test('36b. the resume card renders one item — never two competing cards', () => {
  const markup = html(h(ResumeCard, { item: resumeItem({ activeExam: null, activePractice: ACTIVE_PRACTICE }) }));
  assert.equal((markup.match(/Resume session/g) ?? []).length, 1);
  assert.ok(markup.includes('Mathematics practice in progress'));
  assert.ok(markup.includes('href="/practice/session/session-1"'));
});

test('44. progress is one card combining the mock, the mistakes and the subject', () => {
  const markup = html(h(ProgressSummaryCard, {
    metrics: [
      { key: 'mock', label: 'Latest mock', value: '31/80', href: '/progress/results/exam/e1' },
      { key: 'mistakes', label: 'Mistakes to review', value: '20', href: '/progress/mistakes' },
      { key: 'subject', label: 'Mathematics', value: '6/20' },
    ],
  }));

  assert.ok(markup.includes('Your progress'));
  assert.ok(markup.includes('31/80') && markup.includes('20') && markup.includes('6/20'));
  assert.ok(markup.includes('View progress'));
  assert.equal((markup.match(/<section/g) ?? []).length, 1, 'one card, not three');
});

test('44b. a metric with no data is omitted, never shown as a zero', () => {
  const markup = html(h(ProgressSummaryCard, { metrics: [{ key: 'mistakes', label: 'Mistakes to review', value: '4' }] }));
  assert.ok(!markup.includes('Latest mock'));
  assert.equal(html(h(ProgressSummaryCard, { metrics: [] })), '', 'no data at all renders nothing');
});

test('37. Continue Learning shows one recommendation, or nothing', () => {
  const markup = html(h(ContinueLearningCard, {
    recommendation: {
      kind: 'subject', resultId: 'r1', resultKind: 'practice', subjectSlug: 'mathematics',
      subjectName: 'Mathematics', accuracy: 30, correct: 6, total: 20,
    },
  }));

  assert.ok(markup.includes('Continue Mathematics'));
  assert.ok(markup.includes('6 of 20 correct on your latest attempt'));
  assert.equal((markup.match(/<section/g) ?? []).length, 1, 'exactly one card');
  assert.equal(
    html(h(ContinueLearningCard, { recommendation: { kind: 'start', hasHistory: true } })),
    '',
    'nothing to recommend means nothing is rendered',
  );
});

test('38. quick actions are Practice, the exam session, Past Questions and Mistakes', () => {
  const jamb = html(h(QuickActions, { examCode: 'jamb' }));
  const hrefs = [...jamb.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(hrefs, ['/practice', '/mock', '/practice?mode=past', '/progress/mistakes']);
  assert.ok(jamb.includes('Practice') && jamb.includes('Full Mock'));
  assert.ok(jamb.includes('Past Questions') && jamb.includes('Mistakes'));
  assert.ok(jamb.includes('grid-cols-2'), '2x2 on a phone');

  const waec = html(h(QuickActions, { examCode: 'waec' }));
  assert.ok(waec.includes('Timed Subject'), 'WAEC has no full mock, so it is offered its own session');
});

// ─────────────────────────────────────────────────────── practice setup

const setupProps = (practiceUsage, tier = 'free') => ({
  tab: 'practice', examCode: 'jamb', examName: 'JAMB', examYear: 2027,
  subjects: [{ id: 's1', slug: 'physics', name: 'Physics', topics: [] }],
  capabilities: { years: false, topics: false, difficulty: false },
  unavailableSubjects: [], recommendation: { kind: 'start', hasHistory: false },
  prefillFromRecommendation: false, resumeSession: null, practiceUsage, tier,
});
const countButtons = (markup) => {
  const group = markup.slice(markup.indexOf('aria-labelledby="practice-count-label"'), markup.indexOf('id="practice-mode-label"'));
  return [...group.matchAll(/aria-pressed="(?:true|false)"[^>]*>(\d+)</g)].map((m) => Number(m[1]));
};

test('3/4. a Free student is offered up to 20 questions, never 30 or 40', () => {
  const markup = html(h(PracticeSetup, setupProps(freeUsage().practice)));

  assert.deepEqual(countButtons(markup), [10, 20]);
  assert.ok(markup.includes('Start 20-question session'), 'the default is the full 20');
  assert.ok(markup.includes('1 practice session available today'));
  assert.ok(markup.includes('Free plan: up to 20 questions in a session'));
});

test('13. Master keeps the full 10/20/30/40 sizes and sees no Free copy', () => {
  const markup = html(h(PracticeSetup, setupProps(MASTER_USAGE.practice, 'master')));

  assert.deepEqual(countButtons(markup), [10, 20, 30, 40]);
  assert.ok(!markup.includes('Free plan'));
  assert.deepEqual(upgradeHrefs(markup), []);
});

test('the offered sizes are derived from the plan ceiling, never hard-coded', () => {
  assert.deepEqual(allowedQuestionCounts(20), [10, 20]);
  assert.deepEqual(allowedQuestionCounts(40), [10, 20, 30, 40]);
  assert.deepEqual(allowedQuestionCounts(5), [5], 'a ceiling below every standard size is still offerable');
  assert.deepEqual(allowedQuestionCounts(25), [10, 20, 25], 'the ceiling is always reachable');
});

test('8. a session already in progress offers Resume, and does not claim a loss', () => {
  const usage = freeUsage({ practice: { used: 1, activeSession: ACTIVE_PRACTICE } }).practice;
  const markup = html(h(PracticeSetup, setupProps(usage)));

  assert.ok(markup.includes('Today’s practice session is already in progress'));
  // The way back in is on the screen, whichever exam the session belongs to.
  assert.ok(markup.includes('href="/practice/session/session-1"'));
  assert.ok(markup.includes('Resume Mathematics'));
  assert.ok(markup.includes('6 of 20 answered · resuming never uses another session'));
  assert.ok(upgradeHrefs(markup).includes('/pricing?source=practice_session_in_progress#plans'));
  assert.ok(!markup.includes('has been used'), 'nothing is lost, so nothing says it is');
});

test('5. none left: the exhausted message, a real Upgrade button, and no way to start', () => {
  const markup = html(h(PracticeSetup, setupProps(freeUsage({ practice: { used: 1 } }).practice)));

  assert.ok(markup.includes('You’ve used today’s free practice session.'));
  assert.ok(markup.includes('Upgrade to Master to start more practice sessions today.'));
  assert.ok(upgradeHrefs(markup).includes('/pricing?source=practice_exhausted#plans'));
  assert.ok(markup.includes('Today’s free practice session has been used'));
  assert.match(markup, /<button[^>]*disabled=""[^>]*>[\s\S]*?Today’s free practice session has been used/);
  assert.ok(markup.includes('Your results, answers and mistake bank stay available.'));
});

test('an unreadable allowance is an outage, not a used-up day', () => {
  const usage = freeUsage().practice;
  const markup = html(h(PracticeSetup, setupProps({ ...usage, used: null, remaining: null })));

  assert.ok(markup.includes('We couldn’t check today’s free practice session just now.'));
  assert.ok(!markup.includes('has been used'), 'a student is never told they spent a session they did not');
});

// ────────────────────────────────────────────────────── practice runner

const question = (id, prompt) => ({
  id: `q-${id}`, examBody: 'jamb', subject: { id: 'physics', slug: 'physics', name: 'Physics' },
  topic: null, source: { provider: 'internal', providerQuestionId: id }, prompt, passage: null, assets: [],
  difficulty: null, year: null, options: [{ id: `${id}-a`, key: 'A', text: 'Option A' }, { id: `${id}-b`, key: 'B', text: 'Option B' }],
});
const session = (questions) => ({
  userId: 'u1', serverNow: Date.now(), id: 'sess-1', mode: 'practice', status: 'in_progress',
  subjectName: 'Physics', subjectSlug: 'physics', requestedCount: questions.length, questionCount: questions.length,
  answeredCount: 0, correctCount: 0, sourceProvider: 'internal', startedAt: new Date().toISOString(), questions,
});
const sync = (overrides = {}) => ({
  answers: {}, ready: true, state: 'saved', online: true, error: '', code: '', secondsLeft: null,
  cursor: { subject: 0, question: 0 }, select() {}, setCursor() {}, flush() {}, finish() {}, finishing: false,
  receipt: null, pendingCount: 0, resolveConflict() {}, retryStorage() {}, limited: false, ...overrides,
});

test('8/9. a running session carries no allowance copy and no upgrade prompt, on any tier', () => {
  /*
   * The session was paid for when it was created. Interrupting the student
   * mid-paper to sell them something — or to count down what is left — is
   * exactly what counting sessions at creation exists to avoid.
   */
  for (const tier of ['free', 'master']) {
    globalThis.__sync = sync({ answers: { 'pq-1': { selectedOptionKey: null, isFlagged: false, revision: 0 } } });
    const markup = html(h(PracticeSessionRunner, {
      initialSession: session([{ revision: 0, id: 'pq-1', position: 1, question: question('1', 'Q') }]),
    }));

    assert.ok(!markup.includes('Upgrade to Master'), tier);
    assert.ok(!/practice question|session available|locked for today/i.test(markup), tier);
    assert.ok(markup.includes('Option A'), tier + ': every question is answerable');
  }
});

test('8b. every question in the session is delivered — nothing is locked mid-paper', () => {
  const questions = [1, 2, 3].map((n) => ({ revision: 0, id: `pq-${n}`, position: n, question: question(String(n), `Q${n}`) }));
  globalThis.__sync = sync({
    answers: Object.fromEntries(questions.map((q) => [q.id, { selectedOptionKey: null, isFlagged: false, revision: 0 }])),
  });
  const markup = html(h(PracticeSessionRunner, { initialSession: session(questions) }));

  assert.ok(!markup.includes('This question is locked'));
  assert.ok(!markup.includes('unanswered question') || !markup.includes('still count toward'));
});

// ─────────────────────────────────────────────────────────── mock setup

const mockSetup = (overrides = {}) => ({
  blueprintId: 'b1', blueprintCode: 'full_mock', blueprintName: 'JAMB Full Mock',
  examBodyId: 'jamb-id', examBody: 'jamb', examName: 'JAMB', examYear: 2027,
  durationSeconds: 7200, totalQuestions: 180, activeAttempt: null,
  subjects: [{ id: 's1', slug: 'physics', name: 'Physics', displayOrder: 1, questionCount: 40, available: true }],
  ...overrides,
});

test('46. one free mock left: the exact message and an Upgrade to Master, before the start', () => {
  const markup = html(h(MockExamSetup, { setup: mockSetup(), mockAllowance: freeUsage({ mocks: { used: 1 } }).mocks }));
  const notice = markup.indexOf('You have 1 free mock remaining this month.');
  assert.ok(notice > 0);
  assert.ok(markup.includes('Upgrade to Master to unlock more mocks and keep preparing without waiting.'));
  assert.ok(upgradeHrefs(markup).includes('/pricing?source=mock_one_remaining#plans'));
  assert.ok(notice < markup.indexOf('Begin Full Mock'), 'shown before the final mock is started');
});

test('47. no free mocks left: the exact message, the CTA, and a disabled start', () => {
  const markup = html(h(MockExamSetup, { setup: mockSetup(), mockAllowance: freeUsage({ mocks: { used: 2 } }).mocks }));
  assert.ok(markup.includes('You’ve used your 2 free mocks for this month.'));
  assert.ok(markup.includes('Upgrade to Master to continue taking mock exams now.'));
  assert.ok(upgradeHrefs(markup).includes('/pricing?source=mock_exhausted#plans'));
  assert.match(markup, /disabled=""[^>]*>[\s\S]*?No free mocks left this month/);
  assert.ok(markup.includes('Your free mocks reset on 1 October.'));
});

test('two free mocks left is a quiet line; Master sees nothing; a live paper is always resumable', () => {
  assert.ok(html(h(MockExamSetup, { setup: mockSetup(), mockAllowance: freeUsage().mocks })).includes('2 of 2 free mocks remaining this month'));
  assert.ok(!html(h(MockExamSetup, { setup: mockSetup(), mockAllowance: null })).includes('Upgrade to Master'));

  const active = { id: 'a1', examName: 'JAMB', status: 'in_progress', answeredCount: 3, flaggedCount: 0, totalQuestions: 180,
    startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
  const markup = html(h(MockExamSetup, { setup: mockSetup({ activeAttempt: active }), mockAllowance: freeUsage({ mocks: { used: 2 } }).mocks }));
  assert.ok(markup.includes('Resume exam'));
  assert.ok(!markup.includes('You’ve used your 2 free mocks'), 'a resume is not a new mock');
});

// ──────────────────────────────────────────────────────────── MASTER AI

const aiPanel = (initial) => html(h(AiAllowanceProvider, { initial },
  h(AiQuestionExplanation, { enabled: true, targetKind: 'practice', sessionId: 's1', questionId: 'q1', isCorrect: false, hasVisual: false })));

test('48. one MASTER AI explanation left: the exact line, with a subtle upgrade link', () => {
  const markup = aiPanel({ tier: 'free', meter: freeUsage({ ai: { used: 1 } }).aiExplanations });
  assert.ok(markup.includes('You have 1 MASTER AI explanation remaining today.'));
  assert.ok(upgradeHrefs(markup).includes('/pricing?source=ai_one_remaining#plans'));
});

test('49. none left: the exact message — and the buttons stay, because reopening is free', () => {
  const markup = aiPanel({ tier: 'free', meter: freeUsage({ ai: { used: 2 } }).aiExplanations });
  assert.ok(markup.includes('You’ve used today’s 2 free MASTER AI explanations.'));
  assert.ok(markup.includes('>Upgrade to Master for more explanations.</a>'));
  assert.ok(upgradeHrefs(markup).includes('/pricing?source=ai_exhausted#plans'));
  assert.ok(markup.includes('Explain better'), 'previously generated explanations can still be opened');
  assert.ok(markup.includes('Explanations you’ve already opened stay available'));
});

test('Master and two-left panels carry no AI prompt', () => {
  assert.ok(!aiPanel({ tier: 'master', meter: MASTER_USAGE.aiExplanations }).includes('Upgrade'));
  assert.ok(!aiPanel({ tier: 'free', meter: freeUsage().aiExplanations }).includes('Upgrade'));
  assert.ok(!aiPanel(null).includes('Upgrade'), 'no provider, no prompt — the panel behaves as before');
});

// ─────────────────────────────────────────── destinations and copy

test('51. every upgrade source reaches the plan cards on /pricing, and nothing else', () => {
  for (const source of upgrade.UPGRADE_SOURCES) {
    const markup = html(h(UpgradeLink, { source }));
    assert.deepEqual(hrefs(markup), [`/pricing?source=${source}#plans`], source);
    assert.ok(markup.includes('>Upgrade to Master</a>'));
  }
  const pricing = readFileSync('components/billing/pricing-plans.tsx', 'utf8');
  assert.ok(pricing.includes('id={PLANS_ANCHOR}'), 'the #plans anchor exists on the plan cards');
  assert.equal(upgrade.parseUpgradeSource('practice_exhausted'), 'practice_exhausted');
  for (const junk of ['', 'javascript:alert(1)', 'nav?x=1', 42, null, 'student@example.com']) {
    assert.equal(upgrade.parseUpgradeSource(junk), null, `${String(junk)} is dropped`);
  }
});

test('48. no hard-coded Upgrade destination bypasses the shared link', () => {
  const files = [
    'components/billing/free-plan-card.tsx', 'components/billing/plan-status.tsx', 'components/billing/upgrade-prompt.tsx',
    'components/practice/practice-setup.tsx', 'components/practice/practice-session-runner.tsx',
    'components/exam/mock-exam-setup.tsx', 'components/ai/question-explanation.tsx',
    'components/home/home-header.tsx', 'components/home/resume-card.tsx', 'components/home/progress-summary-card.tsx',
    'components/home/continue-learning-card.tsx', 'components/home/quick-actions.tsx', 'app/(student)/home/page.tsx',
    'app/(student)/progress/results/[kind]/[id]/page.tsx', 'app/(student)/progress/mistakes/page.tsx', 'app/(student)/me/page.tsx',
  ];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.ok(!/href="\/pricing/.test(source), file + ' must use UpgradeLink, not a literal /pricing link');
    assert.ok(!/[^\w]1 free practice|2 free mocks|2 free MASTER/.test(source), file + ' must not hard-code an allowance');
  }

  // The shared link is the only thing that knows the destination.
  assert.equal(upgrade.upgradeHref('dashboard'), '/pricing?source=dashboard#plans');
  assert.equal(upgrade.PLANS_PATH, '/pricing');
  assert.equal(upgrade.PLANS_ANCHOR, 'plans');
  assert.equal(upgrade.parseUpgradeSource('practice_one_remaining'), null, 'the cancelled source is gone');
  assert.ok(upgrade.UPGRADE_SOURCES.includes('practice_session_in_progress'));
});

test('54. singular and plural copy is correct at every count', () => {
  assert.equal(copy.countNoun(1, 'question'), '1 question');
  assert.equal(copy.countNoun(2, 'question'), '2 questions');
  assert.equal(copy.countNoun(1, 'mock'), '1 mock');
  assert.equal(copy.countNoun(2, 'explanation'), '2 explanations');
  assert.equal(copy.remainingLine(1, 4, 'question', 'day'), '1 of 4 questions remaining today');
  assert.equal(copy.remainingLine(1, 2, null, 'month'), '1 of 2 remaining this month');
  assert.equal(copy.practiceAvailableLine(1), '1 practice session available today');
  assert.equal(copy.practiceAvailableLine(3), '3 practice sessions available today');
  assert.equal(copy.practiceExhausted(1).message, 'You’ve used today’s free practice session.');
  assert.equal(copy.practiceExhausted(3).message, 'You’ve used today’s 3 free practice sessions.');
  assert.equal(copy.practiceAllowanceLabel({ sessionsPerDay: 1, maxQuestionsPerSession: 20 }), '1 practice session a day, up to 20 questions');
  assert.equal(copy.mockExhausted(1).message, 'You’ve used your 1 free mock for this month.');
  assert.equal(copy.aiExhausted(2).message, 'You’ve used today’s 2 free MASTER AI explanations.');
});

test('the specified sentences are written once, word for word', () => {
  assert.deepEqual(copy.PRACTICE_SESSION_IN_PROGRESS, {
    message: 'Today’s practice session is already in progress.',
    upgrade: 'Upgrade to Master to start more practice sessions today.',
  });
  assert.equal(copy.practiceExhausted(1).upgrade, 'Upgrade to Master to start more practice sessions today.');
  assert.equal(copy.PRACTICE_SESSION_IN_PROGRESS_SHORT, 'Session in progress');
  assert.equal(copy.PRACTICE_SESSION_USED_SHORT, 'Today’s session used');
  assert.deepEqual(copy.MOCK_ONE_REMAINING, {
    message: 'You have 1 free mock remaining this month.',
    upgrade: 'Upgrade to Master to unlock more mocks and keep preparing without waiting.',
  });
  assert.equal(copy.mockExhausted(2).upgrade, 'Upgrade to Master to continue taking mock exams now.');
  assert.equal(copy.AI_ONE_REMAINING, 'You have 1 MASTER AI explanation remaining today.');
  assert.equal(copy.aiExhausted(2).upgrade, 'Upgrade to Master for more explanations.');
  assert.deepEqual(copy.RESULTS_UPGRADE, {
    message: 'Want more practice on your weak areas?',
    upgrade: 'Upgrade to Master for more practice, mocks and MASTER AI.',
  });
});

// ─────────────────────────────────────────────────────────── SECURITY

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(tsx?|mjs)$/.test(name) ? [path] : [];
  });
}

test('60. no browser module can reach the service-role client or the server-side quota code', () => {
  const SERVER_ONLY = new Set([
    '@/lib/supabase/admin', '@/features/billing/usage', '@/features/billing/quota', '@/features/billing/entitlements',
  ]);
  const clientFiles = [...walk('components'), ...walk('features'), ...walk('app')]
    .filter((file) => /^\s*["']use client["']/.test(readFileSync(file, 'utf8')));
  assert.ok(clientFiles.length > 10);

  for (const file of clientFiles) {
    const source = readFileSync(file, 'utf8');
    // Value imports only: `import type` is erased and never reaches a bundle.
    const valueImports = [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    for (const specifier of valueImports) {
      assert.ok(!SERVER_ONLY.has(specifier), `${file} imports server-only ${specifier}`);
    }
    assert.ok(!/SUPABASE_SERVICE_ROLE_KEY|PAYSTACK_SECRET_KEY/.test(source), `${file} names a server secret`);
  }
  for (const serverModule of ['features/billing/usage.ts', 'features/billing/quota.ts', 'features/billing/entitlements.ts']) {
    assert.match(readFileSync(serverModule, 'utf8'), /^import "server-only";/m, `${serverModule} is marked server-only`);
  }
});

test('55. the browser can neither send nor forge a count: the routes read no usage from the request', () => {
  for (const route of [
    'app/api/practice/sessions/route.ts',
    'app/api/practice/sessions/[sessionId]/answers/route.ts',
    'app/api/progress/practice/route.ts',
    'app/api/exam/attempts/route.ts',
  ]) {
    const source = readFileSync(route, 'utf8');
    assert.ok(!/(body|record|input|x)\.(remaining|used|limit|allowance|tier|available)\b/.test(source), `${route} must not trust client-supplied usage`);
  }
});

// ───────────────────────────────────────────────────────────── ROLLBACK

test('configuration rollback: raising the Free numbers needs no code change', async () => {
  /*
   * The documented rollback is a change to TIER_LIMITS alone. Nothing branches
   * on the tier name or on a counting "unit" any more, so a more generous Free
   * plan must read correctly everywhere without touching a component.
   */
  const { capabilityLimit } = await import('../features/billing/quota.ts');
  const rolledBack = { practice: { sessionsPerDay: 3, maxQuestionsPerSession: 40 }, mockAttempts: 1, mockAttemptWindow: 'month', aiExplanationsPerDay: 3 };
  assert.deepEqual(capabilityLimit('practice_session', rolledBack), { limit: 3, windowKind: 'day' });

  const usage = freeUsage();
  usage.practice = { ...usage.practice, limit: 3, used: 1, remaining: 2, maxQuestionsPerSession: 40 };
  const markup = html(h(FreePlanCard, { usage }));
  assert.ok(markup.includes('2 practice sessions available today'), 'plural, from the same one line of copy');

  const setup = html(h(PracticeSetup, setupProps(usage.practice)));
  assert.ok(setup.includes('Free plan: up to 40 questions in a session'));
});
