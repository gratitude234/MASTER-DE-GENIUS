import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { registerTsxHook } from '../scripts/tsx-hook.mjs';

registerAliasHook();
registerTsxHook();

const stub = (source) => ({ url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true });

// Next.js runtime pieces these client components read from, plus the server
// actions they bind to — none of which a plain render needs to be real.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/navigation') {
      return stub(
        `export function usePathname(){ return globalThis.__pathname ?? '/home'; }
         export function useSearchParams(){ return new URLSearchParams(globalThis.__search ?? ''); }`,
      );
    }
    if (specifier === 'next/link') {
      return { url: new URL('./stubs/next-link.mjs', import.meta.url).href, shortCircuit: true };
    }
    if (specifier === '@/features/onboarding/actions') {
      return stub(`export async function completeOnboardingAction(){ return {}; }`);
    }
    return next(specifier, context);
  },
});

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');

const { StudentNavigation } = await import('../components/app-shell/student-navigation.tsx');
const { OnboardingFlow } = await import('../components/onboarding/onboarding-flow.tsx');

const html = (element) => renderToStaticMarkup(element);
const h = React.createElement;

const subjects = [
  { id: 'eng', slug: 'use-of-english', name: 'Use of English', isCompulsory: true, displayOrder: 1 },
  { id: 'mth', slug: 'mathematics', name: 'Mathematics', isCompulsory: false, displayOrder: 2 },
  { id: 'phy', slug: 'physics', name: 'Physics', isCompulsory: false, displayOrder: 3 },
  { id: 'chm', slug: 'chemistry', name: 'Chemistry', isCompulsory: false, displayOrder: 4 },
  { id: 'bio', slug: 'biology', name: 'Biology', isCompulsory: false, displayOrder: 5 },
];
const exams = [
  { id: 'jamb-id', code: 'jamb', name: 'JAMB', shortName: 'JAMB', description: null, available: true, subjects },
  {
    id: 'waec-id', code: 'waec', name: 'WAEC', shortName: 'WAEC', description: null, available: true,
    subjects: [
      { id: 'waec-mth', slug: 'mathematics', name: 'Mathematics', isCompulsory: false, displayOrder: 1 },
      { id: 'waec-gov', slug: 'government', name: 'Government', isCompulsory: false, displayOrder: 2 },
    ],
  },
];
const onboardingProps = { exams, initialSelection: null };

test('sidebar shows the student’s own exam and year, not a hardcoded one', () => {
  const markup = html(h(StudentNavigation, { examLabel: { shortName: 'JAMB', year: 2029 } }));
  assert.ok(markup.includes('JAMB 2029'));
  assert.ok(!markup.includes('JAMB 2027'), 'the hardcoded label is gone');
});

test('WAEC navigation replaces the JAMB full mock with timed subject practice', () => {
  const markup = html(h(StudentNavigation, { examLabel: { shortName: 'WAEC', year: 2027 } }));
  assert.ok(markup.includes('Timed Subject'));
  assert.ok(markup.includes('href="/practice?timed=1"'));
  assert.ok(!markup.includes('Mock Exams'));
});

test('sidebar degrades to a neutral label when no preference is readable', () => {
  const markup = html(h(StudentNavigation, { examLabel: null }));
  assert.ok(markup.includes('Your exam'));
  assert.ok(!markup.includes('undefined'));
  assert.ok(!markup.includes('null'));
});

test('the dead Bookmarks entry is gone from navigation', () => {
  const markup = html(h(StudentNavigation, { examLabel: null }));
  assert.ok(!markup.includes('Bookmarks'));
  assert.ok(!markup.includes('tab=bookmarks'));
  // The rest of the Personal group survives.
  assert.ok(markup.includes('Profile'));
});

test('navigation links are keyboard-visible in both rails', () => {
  const markup = html(h(StudentNavigation, { examLabel: null }));
  // White ring on the slate-950 sidebar, brand ring on the light tab bar.
  assert.ok(markup.includes('focus-visible:ring-white/80'));
  assert.ok(markup.includes('focus-visible:ring-brand-500'));
});

test('onboarding marks the current step and names every step for screen readers', () => {
  const markup = html(h(OnboardingFlow, onboardingProps));
  assert.ok(markup.includes('aria-label="Onboarding progress"'));
  assert.equal((markup.match(/aria-current="step"/g) ?? []).length, 1, 'exactly one current step');
  assert.ok(markup.includes('Step 1 of 3: Choose your exam — current step'));
  assert.ok(markup.includes('Step 3 of 3: Set your goal'));
});

test('onboarding offers real JAMB and WAEC choices while later exams stay honest', () => {
  const markup = html(h(OnboardingFlow, onboardingProps));
  assert.ok(markup.includes('JAMB / UTME'));
  assert.ok(markup.includes('WAEC / WASSCE'));
  assert.ok(markup.includes('Timed subject sessions') || markup.includes('timed subject sessions'));
  assert.ok(markup.includes('Limited question coverage — not available yet'));
  assert.ok(markup.includes('Selected'), 'the live exam body is marked as chosen');
  assert.ok(markup.includes('Coming in a later phase'), 'scope stays honest about what is not live');
  assert.equal((markup.match(/<button/g) ?? []).length, 3, 'two exam choices plus the advance control');
  assert.ok(markup.includes('Choose subjects'));
});

test('onboarding advance control is a non-submitting button', () => {
  const markup = html(h(OnboardingFlow, onboardingProps));
  // A stray submit inside the onboarding <form> would post a half-built profile.
  assert.ok(markup.includes('type="button"'));
});

test('Mistakes navigates straight to its real page, not a query flag', () => {
  const markup = html(h(StudentNavigation, { examLabel: null }));
  assert.ok(markup.includes('href="/progress/mistakes"'));
  assert.ok(!markup.includes('tab=mistakes'), 'the ignored query parameter is gone');
});

test('only the most specific navigation route is marked current', () => {
  globalThis.__pathname = '/progress/mistakes';
  const markup = html(h(StudentNavigation, { examLabel: null }));

  // Both /progress and /progress/mistakes prefix-match this path; only the
  // longer one may present as active, or the sidebar highlights two rows.
  const active = markup.match(/bg-white\/10 text-white/g) ?? [];
  assert.equal(active.length, 1);

  const [, label] = markup.match(/bg-white\/10 text-white[^>]*>.*?<span>([^<]+)<\/span>/s) ?? [];
  assert.equal(label, 'Mistakes');
  globalThis.__pathname = '/home';
});

test('a section route still marks its parent current in the mobile bar', () => {
  globalThis.__pathname = '/progress/mistakes';
  const markup = html(h(StudentNavigation, { examLabel: null }));
  // The tab bar has no Mistakes entry, so Progress must stay lit there.
  assert.ok(markup.includes('text-slate-950'), 'a mobile tab is active');
  globalThis.__pathname = '/home';
});

/** The label of every desktop sidebar row currently rendered as active. */
function activeSidebarLabels(markup) {
  return [...markup.matchAll(/bg-white\/10 text-white[^>]*>.*?<span>([^<]+)<\/span>/gs)].map((m) => m[1]);
}

test('Practice is current on the plain practice route', () => {
  globalThis.__pathname = '/practice';
  globalThis.__search = '';
  assert.deepEqual(activeSidebarLabels(html(h(StudentNavigation, { examLabel: null }))), ['Practice']);
  globalThis.__pathname = '/home';
});

test('Past Questions is current on ?mode=past, and Practice is not', () => {
  globalThis.__pathname = '/practice';
  globalThis.__search = 'mode=past';
  // Both rows share the /practice route; only the one whose query matches wins.
  assert.deepEqual(activeSidebarLabels(html(h(StudentNavigation, { examLabel: null }))), ['Past Questions']);
  globalThis.__pathname = '/home';
  globalThis.__search = '';
});

test('a query-scoped nav entry never activates without its query', () => {
  globalThis.__pathname = '/practice';
  globalThis.__search = '';
  // Past Questions is scoped to ?mode=past, so on the bare route it must not
  // claim /practice — only the unscoped Practice row may.
  assert.deepEqual(activeSidebarLabels(html(h(StudentNavigation, { examLabel: null }))), ['Practice']);
  globalThis.__pathname = '/home';
});

test('the mobile bar keeps one Practice tab across both practice states', () => {
  for (const search of ['', 'mode=past']) {
    globalThis.__pathname = '/practice';
    globalThis.__search = search;
    // The tab bar is the second nav; it has no Past Questions entry, so
    // Practice must stay lit whichever practice view is open.
    const bar = html(h(StudentNavigation, { examLabel: null })).split('aria-label="Primary"')[1];
    const current = [...bar.matchAll(/aria-current="page".*?<span[^>]*>([^<]+)<\/span>/gs)].map((m) => m[1]);
    assert.deepEqual(current, ['Practice'], `one active mobile tab for "${search}"`);
  }
  globalThis.__pathname = '/home';
  globalThis.__search = '';
});

test('the active navigation link is announced, not only coloured', () => {
  globalThis.__pathname = '/me';
  const markup = html(h(StudentNavigation, { examLabel: null }));
  // One per rail: the sidebar row and the tab bar tab.
  assert.equal((markup.match(/aria-current="page"/g) ?? []).length, 2);
  globalThis.__pathname = '/home';
});

test('Performance points at a real in-page destination, not a dead flag', () => {
  const markup = html(h(StudentNavigation, { examLabel: null }));
  assert.ok(markup.includes('href="/progress#performance"'));
  assert.ok(!markup.includes('tab=performance'), 'the ignored query parameter is gone');
  // Mistakes keeps its own page.
  assert.ok(markup.includes('href="/progress/mistakes"'));
});

test('an in-page fragment link never competes for the active state', () => {
  globalThis.__pathname = '/progress';
  globalThis.__search = '';
  // A fragment is never sent to the server, so Performance cannot know whether
  // the student is looking at it. Results owns the route; exactly one row wins.
  assert.deepEqual(activeSidebarLabels(html(h(StudentNavigation, { examLabel: null }))), ['Results']);

  globalThis.__pathname = '/progress/mistakes';
  assert.deepEqual(activeSidebarLabels(html(h(StudentNavigation, { examLabel: null }))), ['Mistakes']);
  globalThis.__pathname = '/home';
});
