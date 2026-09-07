import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { registerTsxHook } from '../scripts/tsx-hook.mjs';

registerAliasHook();
registerTsxHook();

const stub = (source) => ({ url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true });

/*
 * The session engine is stubbed, never modified: these tests drive the runners
 * through the exact shape `useOfflineSession` returns, so the presentation can
 * be exercised in every state without the engine being present.
 */
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/link') {
      return { url: new URL('./stubs/next-link.mjs', import.meta.url).href, shortCircuit: true };
    }
    if (specifier === 'next/image') {
      return { url: new URL('./stubs/next-image.mjs', import.meta.url).href, shortCircuit: true };
    }
    if (specifier === 'next/navigation') {
      return stub(`export function useRouter(){ return { push(){} }; }`);
    }
    if (specifier === '@/features/offline/use-session') {
      return stub(`export function useOfflineSession(){ return globalThis.__sync; }`);
    }
    return next(specifier, context);
  },
});

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');

const { ExamAttemptRunner } = await import('../components/exam/exam-attempt-runner.tsx');
const { PracticeSessionRunner } = await import('../components/practice/practice-session-runner.tsx');
const { MockExamSetup } = await import('../components/exam/mock-exam-setup.tsx');
const { SyncNotice } = await import('../components/pwa/sync-notice.tsx');
const { SessionStatus, presentSaveState } = await import('../components/pwa/session-status.tsx');
const { navClearance } = await import('../components/ui/variants.ts');

const h = React.createElement;
const html = (element) => renderToStaticMarkup(element).replace(/<!--.*?-->/g, '');

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const EXAM_SOURCE = source('components/exam/exam-attempt-runner.tsx');
const PRACTICE_SOURCE = source('components/practice/practice-session-runner.tsx');

function sync(overrides = {}) {
  return {
    answers: {}, ready: true, state: 'saved', online: true, error: '', code: '',
    secondsLeft: 3600, cursor: { subject: 0, question: 0 },
    select() {}, setCursor() {}, flush() {}, finish() {}, finishing: false,
    receipt: null, pendingCount: 0, resolveConflict() {}, retryStorage() {},
    ...overrides,
  };
}

const question = (id, prompt, passage = null) => ({
  id: `q-${id}`, slug: id, examBody: 'jamb',
  subject: { id: 'physics', slug: 'physics', name: 'Physics' },
  topic: { slug: 'waves', name: 'Waves' },
  source: { provider: 'aloc', providerQuestionId: id },
  prompt, passage, assets: [], difficulty: null, year: 2024,
  options: [
    { id: `${id}-a`, key: 'A', text: 'Option A' },
    { id: `${id}-b`, key: 'B', text: 'Option B' },
  ],
});

const examAttempt = {
  userId: 'u1', serverNow: Date.now(), id: 'attempt-1', examBody: 'jamb', examName: 'JAMB',
  blueprintName: 'JAMB Full Mock', examYear: 2027, status: 'in_progress', sourceProvider: 'aloc',
  durationSeconds: 7200, totalQuestions: 4, answeredCount: 0, flaggedCount: 0,
  startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3.6e6).toISOString(),
  subjects: [
    {
      id: 'as-1', subjectId: 'physics', slug: 'physics', name: 'Physics', displayOrder: 1,
      questionCount: 2, answeredCount: 0, flaggedCount: 0,
      questions: [
        { revision: 0, id: 'eq-1', subjectId: 'physics', subjectPosition: 1, overallPosition: 1, question: question('1', 'Physics question one'), isFlagged: false },
        { revision: 0, id: 'eq-2', subjectId: 'physics', subjectPosition: 2, overallPosition: 2, question: question('2', 'Physics question two', { title: 'Reading passage', body: 'A long passage.' }), isFlagged: false },
      ],
    },
    {
      id: 'as-2', subjectId: 'chemistry', slug: 'chemistry', name: 'Chemistry', displayOrder: 2,
      questionCount: 2, answeredCount: 0, flaggedCount: 0,
      questions: [
        { revision: 0, id: 'eq-3', subjectId: 'chemistry', subjectPosition: 1, overallPosition: 3, question: question('3', 'Chemistry question one'), isFlagged: false },
        { revision: 0, id: 'eq-4', subjectId: 'chemistry', subjectPosition: 2, overallPosition: 4, question: question('4', 'Chemistry question two'), isFlagged: false },
      ],
    },
  ],
};

const practiceSession = {
  userId: 'u1', serverNow: Date.now(), id: 'sess-1', mode: 'practice', status: 'in_progress',
  subjectName: 'Physics', subjectSlug: 'physics', topicName: 'Waves', topicSlug: 'waves',
  requestedCount: 2, questionCount: 2, answeredCount: 0, correctCount: 0, sourceProvider: 'aloc',
  startedAt: new Date().toISOString(),
  questions: [
    { revision: 0, id: 'pq-1', position: 1, question: question('1', 'Practice question one') },
    { revision: 0, id: 'pq-2', position: 2, question: question('2', 'Practice question two') },
  ],
};

/** The engine seeds a response for every question, so the fixture does too. */
const blank = () => ({ selectedOptionKey: null, isFlagged: false });
const ANSWERS = Object.fromEntries(
  ['eq-1', 'eq-2', 'eq-3', 'eq-4', 'pq-1', 'pq-2'].map((id) => [id, blank()]),
);

const renderExam = (overrides = {}) => {
  globalThis.__sync = sync({ answers: ANSWERS, ...overrides });
  return html(h(ExamAttemptRunner, { initialAttempt: examAttempt }));
};

const renderPractice = (props = {}, overrides = {}) => {
  globalThis.__sync = sync({ answers: ANSWERS, ...overrides });
  return html(h(PracticeSessionRunner, { initialSession: practiceSession, ...props }));
};

const mockSetup = (overrides = {}) => ({
  blueprintId: 'b1', blueprintCode: 'jamb-full', blueprintName: 'JAMB Full Mock',
  examBodyId: 'jamb-id', examBody: 'jamb', examName: 'JAMB', examYear: 2027,
  durationSeconds: 7200, totalQuestions: 180, activeAttempt: null,
  subjects: [
    { id: 's1', slug: 'physics', name: 'Physics', displayOrder: 1, questionCount: 40, available: true },
    { id: 's2', slug: 'agricultural-science', name: 'Agricultural Science', displayOrder: 2, questionCount: 40, available: false },
  ],
  ...overrides,
});

// ---------------------------------------------------------------- Mock Setup

test('Mock Setup states the blocking condition before any reassurance', () => {
  const markup = html(h(MockExamSetup, { setup: mockSetup() }));
  const blocker = markup.indexOf('This mock cannot be built yet');
  const checklist = markup.indexOf('Before you begin');

  assert.ok(blocker > -1, 'the blocker is shown');
  assert.ok(checklist > -1, 'the checklist is shown');
  assert.ok(blocker < checklist, 'a student learns it cannot start before reading what it would do');
  assert.ok(markup.includes('Agricultural Science'));
  assert.ok(markup.includes('temporarily unavailable while we expand the question source'));
});

test('Mock Setup keeps the quarantined subject visible and marked, in student language', () => {
  const markup = html(h(MockExamSetup, { setup: mockSetup() }));
  assert.ok(markup.includes('Not available yet'));
  assert.ok(!markup.includes('quarantine'), 'no internal vocabulary reaches the student');
  assert.ok(!markup.includes('provider'), 'nor the provider name');
});

test('Mock Setup keeps the consent gate in front of an irreversible start', () => {
  const buildable = mockSetup({ subjects: [{ id: 's1', slug: 'physics', name: 'Physics', displayOrder: 1, questionCount: 40, available: true }] });
  const markup = html(h(MockExamSetup, { setup: buildable }));

  assert.ok(markup.includes('I&#x27;m ready to begin.'));
  assert.ok(markup.includes('the final submission is irreversible'));
  assert.ok(markup.includes('type="checkbox"'));
  // Unticked, the start control is inert.
  const start = markup.match(/<button[^>]*>(?:(?!<\/button>).)*Begin Full Mock(?:(?!<\/button>).)*<\/button>/s)?.[0];
  assert.ok(start, 'the start control exists');
  assert.ok(start.includes('disabled'), 'and cannot fire until the student consents');
  assert.ok(start.includes('type="button"'), 'it is never a form submit');
});

test('Mock Setup refuses to offer a start the backend would reject', () => {
  const blocked = html(h(MockExamSetup, { setup: mockSetup() }));
  assert.ok(blocked.includes('Full mock unavailable right now'));
  const start = blocked.match(/<button[^>]*>(?:(?!<\/button>).)*Full mock unavailable(?:(?!<\/button>).)*<\/button>/s)?.[0];
  assert.ok(start.includes('disabled'));
});

// ----------------------------------------------------------- Practice Runner

test('the practice runner names the question as a heading beneath the session', () => {
  const markup = renderPractice();
  assert.equal((markup.match(/<h1/g) ?? []).length, 1, 'one page-level heading');
  assert.ok(/<h2[^>]*>\s*Question 1 of 2/.test(markup), '"Question X of Y" is a real heading');
  assert.ok(markup.includes('Physics'), 'the session is what the h1 names');
});

test('the practice runner exits through a confirmation, not a bare link', () => {
  const markup = renderPractice();
  const exit = markup.match(/<button[^>]*>(?:(?!<\/button>).)*Exit(?:(?!<\/button>).)*<\/button>/s)?.[0];
  assert.ok(exit, 'Exit is a control, not a navigation the student cannot reconsider');
  assert.ok(exit.includes('type="button"'));
  // The confirmation exists in the tree, closed, as a native dialog.
  assert.ok(markup.includes('<dialog'));
  assert.ok(!markup.includes('Leave this practice session?'), 'and is closed until asked for');
});

test('the exit copy never promises a sync that has not happened', () => {
  // The wording is chosen from the live save state, so all three branches must
  // exist and none may claim the account is up to date while offline.
  assert.ok(PRACTICE_SOURCE.includes('never promises a sync that has not happened'));
  assert.ok(PRACTICE_SOURCE.includes('saved on this device and will sync when you are back online'));
  assert.ok(PRACTICE_SOURCE.includes('Every answer you have given is saved to your account'));
  assert.ok(PRACTICE_SOURCE.includes('One answer is still saving'));
});

test('the practice runner clears the student tab bar, and the recovered one does not', () => {
  assert.ok(renderPractice().includes(navClearance.bottom), 'the shell has a tab bar to clear');
  const recovered = renderPractice({ recovered: true });
  assert.ok(!recovered.includes(navClearance.bottom), '/offline has no tab bar');
  assert.ok(recovered.includes('safe-area-bottom'));
});

test('practice answer choices keep their own selection semantics', () => {
  const markup = renderPractice();
  const options = [...markup.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*>/g)];
  assert.ok(options.length >= 2, 'each choice still reports its pressed state');
  assert.ok(markup.includes('Option A') && markup.includes('Option B'));
});

// ---------------------------------------------------------------- CBT Runner

test('the exam runner has one page heading and a real question heading', () => {
  const markup = renderExam();
  assert.equal((markup.match(/<h1/g) ?? []).length, 1);
  // Sentence case, per the approved system: all-caps is reserved for the 10px
  // letter-spaced eyebrow, and this is a 12px bold title.
  assert.ok(/<h1[^>]*>JAMB Mock<\/h1>/.test(markup), 'the paper names the page');
  assert.ok(/<h2[^>]*>\s*Question 1 of 2/.test(markup), '"Question X of Y" is a heading');
});

test('Submit is a prominent danger control that opens the review first', () => {
  const markup = renderExam();
  const submit = markup.match(/<button[^>]*>(?:(?!<\/button>).)*Submit(?:(?!<\/button>).)*<\/button>/s)?.[0];

  assert.ok(submit, 'Submit exists in the header');
  assert.ok(submit.includes('bg-danger-600'), 'it reads as the irreversible action');
  assert.ok(submit.includes('h-11'), 'and clears the 44px touch target');
  assert.ok(submit.includes('type="button"'));

  // The review is closed on arrival, so Submit cannot have submitted anything.
  assert.ok(!markup.includes('Submit exam — this cannot be undone'));
});

test('nothing but the submission review can submit the paper', () => {
  // One call site, and it is the review sheet's own footer button.
  const calls = EXAM_SOURCE.match(/sync\.finish\(/g) ?? [];
  assert.equal(calls.length, 1, 'exactly one submission call site');

  const [, footer] = EXAM_SOURCE.match(/title="Check before you submit"[\s\S]*?footer=\{([\s\S]*?)\n        \}/) ?? [];
  assert.ok(footer?.includes('sync.finish(secondsLeft === 0)'), 'the call lives in the review footer');
  assert.ok(footer.includes('Submit exam — this cannot be undone'));

  // The header control only opens the review.
  assert.ok(EXAM_SOURCE.includes('onClick={() => setSubmissionOpen(true)}'));
  assert.ok(!EXAM_SOURCE.includes('window.confirm'));
});

test('Save & exit is a readable control that navigates rather than submits', () => {
  const markup = renderExam();
  assert.ok(markup.includes('Save &amp; exit') || markup.includes('Save &amp;amp; exit'));
  assert.ok(EXAM_SOURCE.includes('Leaving does not submit your paper.'));
  assert.ok(EXAM_SOURCE.includes('router.push("/mock")'), 'the original destination is preserved');
  assert.ok(!markup.includes('text-[9px]'), 'no longer a 9px afterthought');
});

test('the exam chrome stacks by layout, not by a hardcoded offset', () => {
  const markup = renderExam();
  assert.ok(!markup.includes('top-[88px]'), 'the fragile offset is gone');
  assert.ok(!/top-\[\d+px\]/.test(markup), 'and no pixel offset replaced it');
  // Header, offline banner and subject tabs share one sticky container.
  assert.ok(markup.includes('class="sticky top-0 z-40"'));
  assert.ok(markup.includes('aria-label="Exam subjects"'));
});

test('the exam shell takes no student tab-bar clearance it does not have', () => {
  const markup = renderExam();
  assert.ok(!markup.includes(navClearance.bottom), '/exam is outside the student shell');
  assert.ok(markup.includes('safe-area-bottom fixed inset-x-0 bottom-0'));
});

test('the timer is readable on demand but does not announce every second', () => {
  const markup = renderExam({ secondsLeft: 250 });
  assert.ok(markup.includes('role="timer"'), 'implicitly aria-live off');
  assert.ok(markup.includes('aria-label="Time remaining 00:04:10"'));
  assert.ok(markup.includes('bg-danger-500/25'), 'the low band is visually distinct');
  // Announcements are band changes only, and never on first render.
  assert.ok(EXAM_SOURCE.includes('if (last === null || last === band) return;'));
  assert.ok(EXAM_SOURCE.includes('Five minutes remaining.'));
  assert.ok(EXAM_SOURCE.includes('Ten minutes remaining.'));
});

test('navigator cells carry their state in words, and not in colour alone', () => {
  const markup = renderExam();
  assert.ok(markup.includes('question 1, unanswered'), 'state is in the accessible name');
  assert.ok(markup.includes('min-h-11'), 'cells clear the touch target');
  // Answered adds a dot on top of the fill, so the two are distinguishable
  // without colour.
  assert.ok(EXAM_SOURCE.includes('Answered is not carried by fill alone'));
  assert.ok(markup.includes('Question navigator'), 'the desktop rail keeps its heading');
});

test('the overlays are real dialogs with accessible names', () => {
  const markup = renderExam();
  // Navigator, submission review and exit are Sheets: closed dialogs on
  // arrival, each labelled, each closable by Escape without touching the exam.
  assert.equal((markup.match(/<dialog/g) ?? []).length, 3);
  assert.ok(!markup.includes('data-sheet-panel'), 'every one of them starts closed');

  // The passage reader joins them only for a question that has a passage.
  const withPassage = renderExam({ cursor: { subject: 0, question: 1 } });
  assert.equal((withPassage.match(/<dialog/g) ?? []).length, 4);
  for (const title of ['title="Questions"', 'title={question.passage.title', 'title="Check before you submit"']) {
    assert.ok(EXAM_SOURCE.includes(title), `${title} is passed to a Sheet`);
  }
  assert.ok(EXAM_SOURCE.includes('dismissible={!submitting}'), 'the review locks while submitting');
});

test('the submission review preserves every count and jump action', () => {
  for (const fragment of [
    'Answered', 'Unanswered', 'Flagged',
    'Review unanswered', 'Review flagged',
    'unansweredTotal === 0 || submitting',
    'flaggedTotal === 0 || submitting',
    'Some recent changes are still waiting to sync',
  ]) {
    assert.ok(EXAM_SOURCE.includes(fragment), `${fragment} survives the migration`);
  }
});

test('the submitted view still reports what the server did', () => {
  const markup = renderExam({
    receipt: {
      attemptId: 'attempt-1', status: 'submitted', answeredCount: 3, flaggedCount: 1,
      totalQuestions: 4, submittedAt: new Date().toISOString(), submissionReason: 'time_expired',
    },
  });
  assert.ok(markup.includes('Your answers are locked in.'));
  assert.ok(markup.includes('The server submitted the paper when time expired.'));
  assert.ok(markup.includes('3 of 4 questions were answered'));
});

// ------------------------------------------------------- Conflict and status

test('a revision conflict is decided in a dialog, and never on its own', () => {
  const markup = html(h(SyncNotice, {
    ready: true, error: '', code: 'CONFLICT', online: true, expired: false,
    onConflict() {}, onStorageRetry() {},
  }));

  assert.ok(markup.includes('<dialog'), 'no longer a paragraph mid-page');
  // A Sheet renders its panel only while open, and this one opens itself: a
  // decision this consequential should not be something to scroll past.
  assert.ok(markup.includes('data-sheet-panel'));
  assert.ok(markup.includes('Another device saved a newer answer'));
  assert.ok(markup.includes('Keep this device&#x27;s changes'), 'the existing choice is unchanged');
  assert.ok(markup.includes('Decide later'));
  assert.ok(markup.includes('Nothing changes until you choose.'));
  // Dismissing must leave a way back rather than resolving anything.
  assert.ok(markup.includes('Choose what to keep'));
});

test('a healthy session shows no conflict dialog at all', () => {
  const markup = html(h(SyncNotice, {
    ready: true, error: '', code: '', online: true, expired: false,
    onConflict() {}, onStorageRetry() {},
  }));
  assert.ok(!markup.includes('<dialog'));
  assert.ok(!markup.includes('Keep this device'));
});

test('offline outranks the save state when telling a student where answers are', () => {
  assert.equal(presentSaveState('saved', true).label, 'Saved');
  assert.equal(presentSaveState('saved', true).tone, 'success');
  // "Saved" while offline would read as "saved to my account", which is false.
  assert.equal(presentSaveState('saved', false).band, 'offline');
  assert.equal(presentSaveState('saved', false).label, 'Offline · saved on device');
  assert.equal(presentSaveState('saved_local', true).band, 'device');
  assert.equal(presentSaveState('saving', true).band, 'working');
  assert.equal(presentSaveState('syncing', true).band, 'working');
});

test('autosave churn is never announced, only the transitions that matter', () => {
  const markup = html(h(SessionStatus, { state: 'saving', online: true }));
  assert.ok(markup.includes('aria-live="polite"'));
  assert.ok(markup.includes('<span aria-live="polite" class="sr-only"></span>'), 'silent on first render');

  const STATUS_SOURCE = source('components/pwa/session-status.tsx');
  assert.ok(STATUS_SOURCE.includes('working: null'), 'saving and syncing are deliberately silent');
  assert.ok(STATUS_SOURCE.includes('if (previous === null || previous === band) return;'));
});

test('every non-submit control on the runners is an explicit button', () => {
  for (const [name, code] of [['exam', EXAM_SOURCE], ['practice', PRACTICE_SOURCE]]) {
    const opening = code.match(/<button\b/g) ?? [];
    const typed = code.match(/type="button"/g) ?? [];
    assert.ok(typed.length >= opening.length, `${name}: every raw <button> declares type="button"`);
    assert.ok(!code.includes('type="submit"'), `${name}: nothing here submits a form`);
  }
});
