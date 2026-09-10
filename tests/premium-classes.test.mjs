import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { registerTsxHook } from '../scripts/tsx-hook.mjs';

registerAliasHook();
registerTsxHook();

const { recommendClass } = await import('../features/classes/recommendation.ts');
const { parseClassLeadInput } = await import('../features/classes/validation.ts');
const { classRequestHref } = await import('../features/classes/links.ts');
const { shouldShowSupportCta } = await import('../features/support/visibility.ts');
const { whatsappUrl, generalSupportMessage, adminClassMessage } = await import('../features/classes/whatsapp.ts');

const question = (id, topic = { slug: 'stoichiometry', name: 'Stoichiometry' }) => ({
  id, prompt: 'A safe sample question', examBody: 'jamb',
  subject: { slug: 'chemistry', name: 'Chemistry' }, topic,
  options: [{ key: 'A', text: 'One' }, { key: 'B', text: 'Two' }],
  passage: null, assets: [], year: null, difficulty: null,
  source: { provider: 'internal', providerQuestionId: id },
});
const result = ({ id = 'r1', completedAt = '2026-09-10T10:00:00Z', topics = [], subjects = [], items = [], examBodyId = 'jamb-id', examCode = 'jamb' } = {}) => ({
  id, kind: 'practice', examBodyId, examCode, title: 'JAMB Practice', completedAt,
  startedAt: '2026-09-10T09:00:00Z', elapsedSeconds: 60, total: items.length, correct: 0,
  incorrect: items.length, unanswered: 0, accuracy: 0, score: 0, maximum: items.length, scaled: false,
  topics, subjects, items,
});
const review = (id) => ({ id, position: 1, question: question('same-question'), selected: 'B', correct: 'A', explanation: null, outcome: 'incorrect', flagged: false });

test('repeated mistakes outrank a weak-topic percentage', () => {
  const topics = [{ key: 'chem', name: 'Stoichiometry', subjectSlug: 'chemistry', topicSlug: 'stoichiometry', total: 10, correct: 4, incorrect: 6, unanswered: 0, accuracy: 40 }];
  const subjects = [{ key: 's', name: 'Chemistry', subjectSlug: 'chemistry', topicSlug: null, total: 10, correct: 4, incorrect: 6, unanswered: 0, accuracy: 40 }];
  const recommendation = recommendClass([
    result({ id: 'r2', completedAt: '2026-09-10T10:00:00Z', topics, subjects, items: [review('i2')] }),
    result({ id: 'r1', completedAt: '2026-09-09T10:00:00Z', topics, subjects, items: [review('i1')] }),
  ], 'jamb-id');
  assert.equal(recommendation.reason, 'repeated_mistakes');
  assert.equal(recommendation.topic, 'Stoichiometry');
  assert.equal(recommendation.accuracy, null, 'no percentage is invented for mistake counts');
});

test('weakest topic under the existing threshold becomes a class recommendation', () => {
  const topics = [{ key: 'a', name: 'Algebra', subjectSlug: 'mathematics', topicSlug: 'algebra', total: 10, correct: 4, incorrect: 6, unanswered: 0, accuracy: 40 }];
  const subjects = [{ key: 's', name: 'Mathematics', subjectSlug: 'mathematics', topicSlug: null, total: 10, correct: 4, incorrect: 6, unanswered: 0, accuracy: 40 }];
  const recommendation = recommendClass([result({ topics, subjects })]);
  assert.equal(recommendation.reason, 'weak_topic');
  assert.equal(recommendation.accuracy, 40);
});

test('insufficient history creates no fake recommendation', () => assert.equal(recommendClass([]), null));
test('small samples do not create a tutoring claim', () => {
  const topics = [{ key: 'a', name: 'Algebra', subjectSlug: 'mathematics', topicSlug: 'algebra', total: 2, correct: 0, incorrect: 2, unanswered: 0, accuracy: 0 }];
  assert.equal(recommendClass([result({ topics, subjects: [] })]), null);
});

test('a recommendation never mixes exam bodies', () => {
  // The newest attempt is WAEC. A worse JAMB topic sits further back in the
  // history and must not be recommended under a WAEC heading.
  const waec = result({
    id: 'waec-1', completedAt: '2026-09-10T10:00:00Z', examBodyId: 'waec-id', examCode: 'waec',
    topics: [{ key: 'w', name: 'Photosynthesis', subjectSlug: 'biology', topicSlug: 'photosynthesis', total: 10, correct: 6, incorrect: 4, unanswered: 0, accuracy: 60 }],
    subjects: [{ key: 'ws', name: 'Biology', subjectSlug: 'biology', topicSlug: null, total: 10, correct: 6, incorrect: 4, unanswered: 0, accuracy: 60 }],
  });
  const jamb = result({
    id: 'jamb-1', completedAt: '2026-09-09T10:00:00Z', examBodyId: 'jamb-id', examCode: 'jamb',
    topics: [{ key: 'j', name: 'Algebra', subjectSlug: 'mathematics', topicSlug: 'algebra', total: 10, correct: 1, incorrect: 9, unanswered: 0, accuracy: 10 }],
    subjects: [{ key: 'js', name: 'Mathematics', subjectSlug: 'mathematics', topicSlug: null, total: 10, correct: 1, incorrect: 9, unanswered: 0, accuracy: 10 }],
  });
  const latest = recommendClass([waec, jamb]);
  assert.equal(latest.examType, 'waec');
  assert.equal(latest.topic, 'Photosynthesis');

  // An explicit preference selects the workspace instead of the newest attempt.
  const preferred = recommendClass([waec, jamb], 'jamb-id');
  assert.equal(preferred.examType, 'jamb');
  assert.equal(preferred.topic, 'Algebra');
});

test('a repeated-mistake recommendation carries no aggregate leftovers', () => {
  const topics = [{ key: 'chem', name: 'Stoichiometry', subjectSlug: 'chemistry', topicSlug: 'stoichiometry', total: 10, correct: 4, incorrect: 6, unanswered: 0, accuracy: 40 }];
  const recommendation = recommendClass([
    result({ id: 'r2', completedAt: '2026-09-10T10:00:00Z', topics, subjects: [], items: [review('i2')] }),
    result({ id: 'r1', completedAt: '2026-09-09T10:00:00Z', topics, subjects: [], items: [review('i1')] }),
  ]);
  assert.deepEqual(Object.keys(recommendation).sort(), ['accuracy', 'examType', 'reason', 'subjectName', 'subjectSlug', 'topic', 'topicSlug']);
});

test('recommendations depend only on Master De Genius result objects', () => {
  const source = fs.readFileSync(new URL('../features/classes/recommendation.ts', import.meta.url), 'utf8');
  assert.ok(!/aloc|sdash|questions\/providers/i.test(source));
});

test('persistent CTA is available on ordinary student pages and hidden in focus routes', () => {
  assert.equal(shouldShowSupportCta('/home'), true);
  assert.equal(shouldShowSupportCta('/progress/results/practice/id'), true);
  assert.equal(shouldShowSupportCta('/exam/attempt-id'), false);
  assert.equal(shouldShowSupportCta('/practice/session/session-id'), false);
});

test('a Stoichiometry request preserves subject, topic and source', () => {
  const href = classRequestHref({ source: 'persistent_support_cta', examType: 'jamb', subjectSlug: 'chemistry', subjectName: 'Chemistry', topic: 'Stoichiometry' });
  const query = new URL(`https://example.test${href}`).searchParams;
  assert.equal(query.get('source'), 'persistent_support_cta');
  assert.equal(query.get('subjectSlug'), 'chemistry');
  assert.equal(query.get('topic'), 'Stoichiometry');
});

const validLead = { studentName: 'David Student', email: 'david@example.com', phone: '0801 234 5678', examType: 'jamb', subjectSlug: 'chemistry', subjectName: 'Chemistry', topic: 'Stoichiometry', classType: 'private', preferredContactMethod: 'whatsapp', preferredSchedule: 'Weekday evenings', message: '', source: 'persistent_support_cta', recommendationReason: 'student_requested', recentAccuracy: null, promotionalWhatsappConsent: false, promotionalEmailConsent: false };
test('valid lead input is normalised and consent stays opt-in', () => {
  const parsed = parseClassLeadInput(validLead);
  assert.equal(parsed.phone, '08012345678');
  assert.equal(parsed.promotionalWhatsappConsent, false);
  assert.equal(parsed.promotionalEmailConsent, false);
});
test('invalid phone and enums are rejected', () => {
  assert.throws(() => parseClassLeadInput({ ...validLead, phone: '123' }), /valid WhatsApp/);
  assert.throws(() => parseClassLeadInput({ ...validLead, source: 'forged' }), /source/);
});

test('WhatsApp links use the configured number and percent-encode safe copy', () => {
  const url = whatsappUrl(generalSupportMessage('platform'), '2348012345678');
  assert.ok(url.startsWith('https://wa.me/2348012345678?text='));
  assert.ok(decodeURIComponent(url).includes('platform or account issue'));
});
test('a Nigerian local student number becomes a valid wa.me international number', () => {
  assert.ok(whatsappUrl('Hello', '08012345678').startsWith('https://wa.me/2348012345678?'));
});
test('admin WhatsApp copy contains no score, answers or detailed performance', () => {
  const message = adminClassMessage({ studentName: 'David Student', examType: 'jamb', subjectName: 'Physics' });
  assert.ok(message.includes('JAMB Physics'));
  assert.ok(!/accuracy|score|answer|mistake/i.test(message));
});

test('migration locks browser writes, owns RLS and atomically deduplicates', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/202609100001_premium_classes_and_support.sql', import.meta.url), 'utf8');
  assert.match(sql, /premium_class_leads enable row level security/i);
  assert.match(sql, /revoke all on public\.premium_class_leads from public, anon, authenticated/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /interval '24 hours'/i);
  assert.match(sql, /grant execute on function public\.create_premium_class_lead[\s\S]*to service_role/i);
});

test('students receive select-only access and cannot see admin notes through a student query', () => {
  const service = fs.readFileSync(new URL('../features/classes/service.ts', import.meta.url), 'utf8');
  const studentSelect = service.match(/export async function listStudentLeads[\s\S]*?return data;/)?.[0] ?? '';
  assert.ok(studentSelect.includes('id, exam_type, subject_name, topic, class_type, status, created_at'));
  assert.ok(!studentSelect.includes('admin_notes'));
});

test('the browser role is denied CRM columns by the database, not just by the query', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/202609100001_premium_classes_and_support.sql', import.meta.url), 'utf8');
  // A table-wide grant would let a student read their own lead's admin notes
  // straight from PostgREST with the publishable key, whatever the server asks for.
  assert.doesNotMatch(sql, /grant\s+select\s+on\s+public\.premium_class_leads\s+to\s+authenticated/i);
  const grant = sql.match(/grant\s+select\s*\(([\s\S]*?)\)\s*on\s+public\.premium_class_leads\s+to\s+authenticated;/i);
  assert.ok(grant, 'the authenticated grant on premium_class_leads must be column-level');
  const columns = grant[1].split(',').map((column) => column.trim());
  for (const withheld of ['admin_notes', 'assigned_to', 'fingerprint', 'updated_at', 'contacted_at', 'enrolled_at', 'closed_at']) {
    assert.ok(!columns.includes(withheld), `${withheld} must not be granted to the browser role`);
  }
  for (const needed of ['id', 'subject_name', 'topic', 'class_type', 'status', 'created_at']) {
    assert.ok(columns.includes(needed), `${needed} is required for the student request history`);
  }
});

test('the CRM summary counts every lead rather than the current page', () => {
  const service = fs.readFileSync(new URL('../features/classes/service.ts', import.meta.url), 'utf8');
  const counts = service.match(/export async function countLeadsByStatus[\s\S]*?\n}/)?.[0] ?? '';
  assert.match(counts, /head:\s*true/, 'totals must not download student rows');
  assert.match(counts, /count:\s*"exact"/);
  const page = fs.readFileSync(new URL('../app/admin/classes/page.tsx', import.meta.url), 'utf8');
  assert.ok(!/listAdminLeads\(\{\}\)/.test(page), 'the summary must not re-list leads to count them');
  assert.match(page, /countLeadsByStatus\(\)/);
});

test('analytics is a seam, not a vendor, and never throws into the UI', async () => {
  const { track, setAnalyticsSink, ANALYTICS_EVENTS } = await import('../features/analytics/events.ts');
  const seen = [];
  setAnalyticsSink((event, properties) => seen.push([event, properties]));
  track('support_cta_opened', { pathname: '/home' });
  assert.deepEqual(seen, [['support_cta_opened', { pathname: '/home' }]]);

  setAnalyticsSink(() => { throw new Error('sink is down'); });
  assert.doesNotThrow(() => track('class_request_submitted'));

  setAnalyticsSink(null);
  assert.doesNotThrow(() => track('class_request_submitted'));
  for (const required of ['support_cta_viewed', 'support_option_selected', 'class_request_submitted', 'class_lead_enrolled']) {
    assert.ok(ANALYTICS_EVENTS.includes(required));
  }
});

test('no analytics vendor was introduced for this feature', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  assert.ok(!deps.some((name) => /posthog|mixpanel|amplitude|segment|plausible|ga4/i.test(name)));
});

test('admin mutation authenticates and checks the allowlist before update', () => {
  const route = fs.readFileSync(new URL('../app/api/admin/classes/leads/[id]/route.ts', import.meta.url), 'utf8');
  const handler = route.slice(route.indexOf('export async function PATCH'));
  assert.ok(handler.indexOf('supabase.auth.getUser') < handler.indexOf('isAppAdmin'));
  assert.ok(handler.indexOf('isAppAdmin') < handler.indexOf('updateAdminLead'));
  assert.match(route, /status: 403/);
});
