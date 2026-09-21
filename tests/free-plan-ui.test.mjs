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
const { PracticeSetup, allowedQuestionCounts } = await import('../components/practice/practice-setup.tsx');
const { PracticeSessionRunner } = await import('../components/practice/practice-session-runner.tsx');
const { MockExamSetup } = await import('../components/exam/mock-exam-setup.tsx');
const { AiQuestionExplanation } = await import('../components/ai/question-explanation.tsx');
const { AiAllowanceProvider } = await import('../components/billing/ai-allowance.tsx');
const { UpgradeLink } = await import('../components/billing/upgrade-link.tsx');
const { freeUsage, MASTER_USAGE } = await import('./stubs/billing-usage.mjs');
const copy = await import('../features/billing/copy.ts');
const upgrade = await import('../features/billing/upgrade.ts');
const plans = await import('../features/billing/plans.ts');

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
  for (const pathname of ['/home', '/practice', '/mock', '/progress', '/progress/mistakes', '/me', '/classes']) {
    globalThis.__pathname = pathname;
    const markup = html(h(PlanStrip, { plan: FREE_BADGE }));
    assert.ok(markup.includes('lg:hidden'), `${pathname}: phone-only, the rail covers desktop`);
    assert.deepEqual(upgradeHrefs(markup), ['/pricing?source=nav_mobile#plans'], pathname);
    assert.ok(markup.includes('min-h-11'), `${pathname}: a comfortable touch target`);
    assert.ok(!/fixed|absolute/.test(markup), `${pathname}: in the flow, not an overlay`);
  }
  for (const pathname of ['/practice/session/abc', '/pricing', '/billing', '/billing/callback']) {
    globalThis.__pathname = pathname;
    assert.equal(html(h(PlanStrip, { plan: FREE_BADGE })), '', `${pathname}: not during a session or on the plan pages`);
  }
  globalThis.__pathname = '/home';
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

test('43. the dashboard Free card shows the server’s counts, in the plain words specified', () => {
  const usage = freeUsage({ practice: { used: 1 }, mocks: { used: 1 }, ai: { used: 0 } });
  const markup = html(h(FreePlanCard, { usage }));

  assert.ok(markup.includes('Free Plan'));
  assert.ok(markup.includes('3 of 4 questions remaining today'));
  assert.ok(markup.includes('1 of 2 remaining this month'));
  assert.ok(markup.includes('2 of 2 explanations remaining today'));
  assert.deepEqual(upgradeHrefs(markup), ['/pricing?source=dashboard#plans']);
  assert.ok(markup.includes('Daily allowances reset at midnight (WAT).'), 'the reset is stated, not counted down');
  assert.ok(!/quota|ledger|reservation|entitlement/i.test(markup), 'no internal vocabulary');
});

test('53. the dashboard price comes from the billing catalogue, not a copy of it', () => {
  const cheapest = [...plans.purchasablePlans()].sort((a, b) => a.priceKobo - b.priceKobo)[0];
  const markup = html(h(FreePlanCard, { usage: freeUsage() }));
  assert.ok(markup.includes(`Master from ${plans.formatNaira(cheapest.priceKobo)} for ${cheapest.durationDays} days`));
  assert.ok(markup.includes('1,500'), 'currently ₦1,500 for 30 days');
});

test('the dashboard card never guesses a count it could not read', () => {
  const usage = freeUsage();
  usage.mocks = { ...usage.mocks, used: null, remaining: null };
  const markup = html(h(FreePlanCard, { usage }));
  assert.ok(markup.includes('Up to 2 mocks a month'));
  assert.ok(!markup.includes('NaN') && !markup.includes('null'));
});

test('questions waiting in an unfinished session are named on the dashboard, with correct grammar', () => {
  assert.ok(html(h(FreePlanCard, { usage: freeUsage({ practice: { used: 1, waiting: 1 } }) })).includes('1 question waiting in an unfinished session'));
  assert.ok(html(h(FreePlanCard, { usage: freeUsage({ practice: { used: 0, waiting: 3 } }) })).includes('3 questions waiting in an unfinished session'));
});

// ─────────────────────────────────────────────────────── practice setup

const setupProps = (practiceAllowance) => ({
  tab: 'practice', examCode: 'jamb', examName: 'JAMB', examYear: 2027,
  subjects: [{ id: 's1', slug: 'physics', name: 'Physics', topics: [] }],
  capabilities: { years: false, topics: false, difficulty: false },
  unavailableSubjects: [], recommendation: { kind: 'start', hasHistory: false },
  prefillFromRecommendation: false, resumeSession: null, practiceAllowance,
});
const countButtons = (markup) => {
  const group = markup.slice(markup.indexOf('aria-labelledby="practice-count-label"'), markup.indexOf('id="practice-mode-label"'));
  return [...group.matchAll(/aria-pressed="(?:true|false)"[^>]*>(\d+)</g)].map((m) => Number(m[1]));
};

test('7. a new Free student is offered 1–4 questions, never the 10/20/30/40 sizes', () => {
  const markup = html(h(PracticeSetup, setupProps(freeUsage().practice)));
  assert.deepEqual(countButtons(markup), [1, 2, 3, 4]);
  assert.ok(markup.includes('Start 4-question session'));
  assert.ok(markup.includes('4 of 4 practice questions remaining today'));
  assert.ok(markup.includes('Free plan: up to 4 questions right now'));
});

test('7b. with 2 left the choice is 1–2; Master keeps the full sizes', () => {
  assert.deepEqual(countButtons(html(h(PracticeSetup, setupProps(freeUsage({ practice: { used: 2 } }).practice)))), [1, 2]);
  assert.deepEqual(countButtons(html(h(PracticeSetup, setupProps(null)))), [10, 20, 30, 40]);
  assert.deepEqual(allowedQuestionCounts(0), []);
  assert.deepEqual(allowedQuestionCounts(1), [1]);
});

test('44. one practice question left gets the exact one-remaining line and a quiet upgrade link', () => {
  const markup = html(h(PracticeSetup, setupProps(freeUsage({ practice: { used: 3 } }).practice)));
  assert.ok(markup.includes('You have 1 free practice question remaining today.'));
  assert.ok(upgradeHrefs(markup).includes('/pricing?source=practice_one_remaining#plans'));
  assert.ok(markup.includes('Start 1-question session'));
});

test('45. none left: the exhausted message, a real Upgrade button, and no way to start', () => {
  const markup = html(h(PracticeSetup, setupProps(freeUsage({ practice: { used: 4 } }).practice)));
  assert.ok(markup.includes('You’ve used today’s 4 free practice questions.'));
  assert.ok(markup.includes('Upgrade to Master to keep practising today.'));
  assert.ok(upgradeHrefs(markup).includes('/pricing?source=practice_exhausted#plans'));
  assert.ok(markup.includes('No free questions left to start today'));
  assert.match(markup, /<button[^>]*disabled=""[^>]*>[\s\S]*?No free questions left to start today/);
  assert.ok(markup.includes('Your results, answers and mistake bank stay available.'));
});

test('questions waiting in an unfinished session are described as waiting, not used', () => {
  const markup = html(h(PracticeSetup, setupProps(freeUsage({ practice: { used: 1, waiting: 3 } }).practice)));
  assert.ok(markup.includes('Your 3 remaining questions are waiting in a session you haven’t finished.'));
  assert.ok(!markup.includes('You’ve used today’s'));
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
  receipt: null, pendingCount: 0, resolveConflict() {}, retryStorage() {}, allowance: null, limited: false, ...overrides,
});

test('a locked question shows why and what unlocks it — and has nothing to reveal', () => {
  const locked = { revision: 0, id: 'pq-1', position: 1, locked: true, question: { ...question('1', ''), options: [] } };
  globalThis.__sync = sync({
    answers: { 'pq-1': { selectedOptionKey: null, isFlagged: false, revision: 0 } },
    allowance: { limit: 4, used: 4, waiting: 0, remaining: 0, available: 0 },
  });
  const markup = html(h(PracticeSessionRunner, { initialSession: session([locked]) }));

  assert.ok(markup.includes('This question is locked for today'));
  assert.ok(markup.includes('It unlocks when your free questions reset at midnight (WAT), or straight away with Master.'));
  assert.ok(upgradeHrefs(markup).includes('/pricing?source=practice_exhausted#plans'));
  assert.ok(!markup.includes('Option A'), 'no answer choices exist for a locked question');
});

test('the runner says when one free question is left, from the server’s count', () => {
  globalThis.__sync = sync({
    answers: { 'pq-1': { selectedOptionKey: null, isFlagged: false, revision: 0 } },
    allowance: { limit: 4, used: 3, waiting: 1, remaining: 1, available: 0 },
  });
  const markup = html(h(PracticeSessionRunner, { initialSession: session([{ revision: 0, id: 'pq-1', position: 1, held: true, question: question('1', 'Q') }]) }));
  assert.ok(markup.includes('You have 1 free practice question remaining today.'));
});

test('finishing early is explained before the tap: unanswered held questions still count', () => {
  const questions = [1, 2].map((n) => ({ revision: 0, id: `pq-${n}`, position: n, held: true, question: question(String(n), `Q${n}`) }));
  globalThis.__sync = sync({
    answers: { 'pq-1': { selectedOptionKey: null, isFlagged: false, revision: 0 }, 'pq-2': { selectedOptionKey: null, isFlagged: false, revision: 0 } },
    cursor: { subject: 0, question: 1 },
    allowance: { limit: 4, used: 0, waiting: 2, remaining: 4, available: 2 },
  });
  const markup = html(h(PracticeSessionRunner, { initialSession: session(questions) }));
  assert.ok(markup.includes('2 unanswered questions still count toward'));
});

test('Master runners carry no Free prompts at all', () => {
  globalThis.__sync = sync({ answers: { 'pq-1': { selectedOptionKey: null, isFlagged: false, revision: 0 } } });
  const markup = html(h(PracticeSessionRunner, { initialSession: session([{ revision: 0, id: 'pq-1', position: 1, question: question('1', 'Q') }]) }));
  assert.ok(!markup.includes('Upgrade to Master'));
  assert.ok(!markup.includes('free practice question'));
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

test('no hard-coded Upgrade destination bypasses the shared link', () => {
  const files = [
    'components/billing/free-plan-card.tsx', 'components/billing/plan-status.tsx', 'components/practice/practice-setup.tsx',
    'components/practice/practice-session-runner.tsx', 'components/exam/mock-exam-setup.tsx', 'components/ai/question-explanation.tsx',
    'app/(student)/progress/results/[kind]/[id]/page.tsx', 'app/(student)/progress/mistakes/page.tsx', 'app/(student)/me/page.tsx',
  ];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.ok(!/href="\/pricing/.test(source), `${file} must use UpgradeLink, not a literal /pricing link`);
    assert.ok(!/[^\w]4 free|2 free mocks|2 free MASTER/.test(source), `${file} must not hard-code an allowance`);
  }
});

test('54. singular and plural copy is correct at every count', () => {
  assert.equal(copy.countNoun(1, 'question'), '1 question');
  assert.equal(copy.countNoun(2, 'question'), '2 questions');
  assert.equal(copy.countNoun(1, 'mock'), '1 mock');
  assert.equal(copy.countNoun(2, 'explanation'), '2 explanations');
  assert.equal(copy.remainingLine(1, 4, 'question', 'day'), '1 of 4 questions remaining today');
  assert.equal(copy.remainingLine(1, 2, null, 'month'), '1 of 2 remaining this month');
  assert.equal(copy.practiceExhausted(1).message, 'You’ve used today’s 1 free practice question.');
  assert.equal(copy.practiceExhausted(4).message, 'You’ve used today’s 4 free practice questions.');
  assert.equal(copy.mockExhausted(1).message, 'You’ve used your 1 free mock for this month.');
  assert.equal(copy.aiExhausted(2).message, 'You’ve used today’s 2 free MASTER AI explanations.');
});

test('the specified sentences are written once, word for word', () => {
  assert.equal(copy.PRACTICE_ONE_REMAINING, 'You have 1 free practice question remaining today.');
  assert.equal(copy.practiceExhausted(4).upgrade, 'Upgrade to Master to keep practising today.');
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

test('configuration rollback: a session-counted Free plan takes the old path and reads as sessions', async () => {
  const { practiceMeterFor } = await import('../features/billing/quota.ts');
  const rolledBack = { practice: { unit: 'session', perDay: 20 }, mockAttempts: 1, mockAttemptWindow: 'month', aiExplanationsPerDay: 3 };
  assert.equal(practiceMeterFor({ tier: 'free', limits: rolledBack }), null, 'no question metering, no gating');

  const usage = freeUsage();
  usage.practice = { ...usage.practice, unit: 'session', limit: 20, used: 2, remaining: 18, waiting: null, available: null };
  const markup = html(h(FreePlanCard, { usage }));
  assert.ok(markup.includes('18 of 20 sessions remaining today'));
  assert.ok(!markup.includes('waiting in an unfinished session'));
});
