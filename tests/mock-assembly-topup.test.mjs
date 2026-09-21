/**
 * A JAMB full mock must deliver exactly the blueprint count, or refuse.
 *
 * Production showed "Use of English does not yet have enough questions for a
 * full mock (59/60 available)" against a provider holding thousands of clean
 * English questions. The cause was the top-up: every round asked for exactly
 * the shortfall, so the rejection rate that thinned the first fetch thinned the
 * replacements identically and the gap only ever shrank. These tests pin the
 * shape of the fix — request headroom, bounded rounds, no duplicates — and pin
 * the rule it must never be allowed to break: 59 is not a 60-question paper.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

process.env.ALOC_STATION_API_KEY = 'station-test-key';
process.env.ALOC_STATION_BASE_URL = 'https://station.aloc.test/api/v1';

const stub = (source) => ({ url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true });
// The route helper imports "next/server" the way the bundler resolves it.
const NEXT_SERVER_URL = new URL('../node_modules/next/server.js', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/headers') return stub('export async function cookies(){return {get(){return null}}}');
    if (specifier === 'next/server') return { url: NEXT_SERVER_URL, shortCircuit: true };
    if (specifier === '@/lib/supabase/admin') return stub('export const createAdminClient=()=>globalThis.__mockDb');
    return next(specifier, context);
  },
});

const { AlocStationQuestionProvider } = await import('../features/questions/providers/aloc-station/index.ts');
const { assembleDeliverableQuestions, topUpRequestCount, MAX_INTEGRITY_TOPUP_ROUNDS } =
  await import('../features/questions/service.ts');

console.info = () => {};
console.warn = () => {};

const ENGLISH = { examBody: 'jamb', subjectSlug: 'use-of-english', count: 60, requestType: 'mock' };

/** A well-formed Use of English record. */
const valid = (id) => ({
  id: `eng-${id}`,
  text: `Choose the option nearest in meaning to the word in question ${id}.`,
  options: { a: `Alpha${id}`, b: `Beta${id}`, c: `Gamma${id}`, d: `Delta${id}` },
  correctAnswer: 'b',
  examType: 'jamb', subject: 'english-language', year: 2019,
});

/** Points at a comprehension passage that never arrived. */
const danglingPassage = (id) => ({ ...valid(id), text: 'According to the passage above, the narrator was', section: null });
/** Two options a student would read as the same answer. */
const duplicateOptions = (id) => ({ ...valid(id), options: { a: 'Receive', b: 'receive', c: 'Gamma', d: 'Delta' } });
/** The emphasis that identified the word was stripped with the markup. */
const underlined = (id) => ({ ...valid(id), text: 'In the sentence, the underlined word functions as which part of speech?' });

const range = (from, to, make = valid) =>
  Array.from({ length: to - from + 1 }, (_, index) => make(from + index));

/**
 * A Station that serves a fixed inventory: distinct records within one
 * response, drawn in order, and honouring the exclusion list the adapter sends.
 * Records what each upstream request asked for.
 */
function station(inventory) {
  const requests = [];
  const fetchImpl = async (url) => {
    const limit = Number(url.searchParams.get('limit'));
    requests.push({ limit });
    const data = inventory.splice(0, limit);
    return new Response(JSON.stringify({ data, meta: {} }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  return { requests, provider: new AlocStationQuestionProvider(fetchImpl, async () => {}) };
}

// --------------------------------------------------------- 1. the happy path

test('a mock asking for 60 Use of English questions receives exactly 60 valid ones', async () => {
  const { provider } = station(range(1, 200));
  const result = await assembleDeliverableQuestions(provider, ENGLISH);

  assert.equal(result.questions.length, 60, 'a full JAMB English paper is 60 questions');
  assert.equal(result.rejections.length, 0);
  assert.equal(new Set(result.questions.map((q) => q.source.providerQuestionId)).size, 60);
});

// ------------------------------------------------ 2 & 3. rejection and top-up

test('one invalid question triggers a top-up that still delivers 60', async () => {
  // The one defective record sits inside the first batch the assembler reads.
  const inventory = [...range(1, 30), danglingPassage(31), ...range(32, 200)];
  const { provider } = station(inventory);
  const result = await assembleDeliverableQuestions(provider, ENGLISH);

  assert.equal(result.questions.length, 60);
  assert.equal(result.rejections.length, 1);
  assert.equal(result.rejections[0].reason, 'missing_passage_context');
  assert.ok(result.rounds > 1, 'a rejection must cost a top-up round');
  assert.ok(
    !result.questions.some((q) => q.source.providerQuestionId === 'eng-31'),
    'the refused question must never reach the paper',
  );
});

test('three invalid questions are replaced exactly, one for one', async () => {
  const inventory = [
    ...range(1, 10), danglingPassage(11), duplicateOptions(12), underlined(13), ...range(14, 200),
  ];
  const { provider } = station(inventory);
  const result = await assembleDeliverableQuestions(provider, ENGLISH);

  assert.equal(result.questions.length, 60);
  assert.equal(result.rejections.length, 3);
  assert.deepEqual(
    result.rejections.map((r) => r.reason).sort(),
    ['duplicate_option_content', 'missing_passage_context', 'missing_underlined_context'],
  );
  // Replaced, not merely dropped: the delivered count is whole again.
  assert.equal(new Set(result.questions.map((q) => q.source.providerQuestionId)).size, 60);
});

// ------------------------------------------------------ 4. no duplicates ever

test('source ids already seen are excluded from every top-up round', async () => {
  const inventory = [...range(1, 20), danglingPassage(21), ...range(22, 200)];
  /** Every exclusion list the adapter sent upstream, so growth can be asserted. */
  const excluded = [];
  const fetchImpl = async (url) => {
    excluded.push(url.searchParams.get('excludeSourceIds'));
    const data = inventory.splice(0, Number(url.searchParams.get('limit')));
    return new Response(JSON.stringify({ data, meta: {} }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  const provider = new AlocStationQuestionProvider(fetchImpl, async () => {});

  // A source id the caller already used elsewhere must never come back.
  const result = await assembleDeliverableQuestions(
    provider, { ...ENGLISH, excludeSourceIds: ['eng-1', 'eng-2', 'eng-3'] },
  );

  const delivered = result.questions.map((q) => q.source.providerQuestionId);
  assert.equal(delivered.length, 60);
  assert.equal(new Set(delivered).size, 60, 'no question may appear twice in one paper');
  for (const excluded of ['eng-1', 'eng-2', 'eng-3']) {
    assert.ok(!delivered.includes(excluded), `${excluded} was excluded and must not be delivered`);
  }
});

// ------------------------------------------- 5. an honest shortage stays honest

test('a genuinely short inventory ends bounded and reports what it really has', async () => {
  // 40 records and nothing more, so 60 is impossible however many rounds run.
  const { requests, provider } = station(range(1, 40));
  const result = await assembleDeliverableQuestions(provider, ENGLISH);

  assert.equal(result.questions.length, 40, 'it must report what exists, not invent the rest');
  assert.ok(result.rounds <= MAX_INTEGRITY_TOPUP_ROUNDS + 1, 'the round budget must hold');
  assert.ok(requests.length < 60, 'an exhausted pool must not be hammered');
});

test('top-up rounds are bounded even when every candidate is refused', async () => {
  const { provider } = station(range(1, 400, danglingPassage));
  const result = await assembleDeliverableQuestions(provider, ENGLISH);

  assert.equal(result.questions.length, 0);
  assert.ok(result.rounds <= MAX_INTEGRITY_TOPUP_ROUNDS + 1, `rounds must stay bounded, got ${result.rounds}`);
});

// ------------------------------------------------- the arithmetic of the fix

test('a top-up asks for more than the shortfall, scaled by the measured acceptance rate', () => {
  // Nothing measured yet: ask for exactly what is needed.
  assert.equal(topUpRequestCount(60, 0, 0), 60);
  // Everything so far was valid: the shortfall plus the margin is enough.
  assert.equal(topUpRequestCount(10, 60, 0), 12);
  // A quarter were refused, so 15 more valid ones need 20 candidates, plus margin.
  assert.equal(topUpRequestCount(15, 60, 15), 22);
  // Never fewer than the shortfall, and never more than one batch.
  assert.ok(topUpRequestCount(5, 60, 30) >= 5);
  assert.ok(topUpRequestCount(60, 60, 59) <= 100, 'a catastrophic round must not demand an unbounded batch');
  assert.equal(topUpRequestCount(0, 60, 10), 0);
});

test('asking for exactly the shortfall is what left the paper one question short', async () => {
  /*
   * The regression itself. A quarter of this inventory is defective and evenly
   * spread, which is the live JAMB English shape. Requesting only the shortfall
   * converges geometrically on 60 without reaching it; requesting with headroom
   * arrives.
   */
  const inventory = Array.from({ length: 400 }, (_, index) =>
    index % 4 === 3 ? danglingPassage(index + 1) : valid(index + 1));

  const { provider } = station([...inventory]);
  const result = await assembleDeliverableQuestions(provider, ENGLISH);
  assert.equal(result.questions.length, 60, 'the assembler must close the gap, not merely narrow it');
  assert.ok(result.rejections.length > 0, 'the defective records must still have been refused');
});

// ------------------------------------------ 6. 59 is never a 60-question paper

test('a 60-question English paper is refused at 59 rather than shipped short', async () => {
  globalThis.__mockDb = {
    from(table) {
      const filters = [];
      const value = () => {
        const eq = (key) => filters.find(([k]) => k === key)?.[1];
        if (table === 'profiles') return { onboarding_completed: true };
        if (table === 'student_exam_preferences') {
          return [{ id: 'pref', user_id: 'student', exam_body_id: 'jamb-id', exam_year: 2027, is_primary: true, is_active: true }];
        }
        if (table === 'exam_bodies') {
          const exams = [{ id: 'jamb-id', code: 'jamb', short_name: 'JAMB', name: 'JAMB' }];
          return eq('id') ? exams[0] : exams;
        }
        if (table === 'exam_blueprints') {
          return { id: 'bp', code: 'full_mock', name: 'JAMB Full Mock', duration_seconds: 7200, expected_subject_count: 1, default_question_count: 60 };
        }
        if (table === 'student_subject_preferences') return [{ subject_id: 'eng', display_order: 1 }];
        if (table === 'subjects') return [{ id: 'eng', slug: 'use-of-english', name: 'Use of English' }];
        if (table === 'exam_blueprint_subject_overrides') return [{ subject_id: 'eng', question_count: 60 }];
        if (table === 'exam_attempts') return null;
        throw new Error(`Unexpected table ${table}`);
      };
      const chain = {
        select: () => chain, eq: (k, v) => { filters.push([k, v]); return chain; },
        in: () => chain, order: () => chain, limit: () => chain,
        maybeSingle: async () => ({ data: value(), error: null }),
        single: async () => ({ data: value(), error: null }),
        then: (resolve) => Promise.resolve({ data: value(), error: null }).then(resolve),
      };
      return chain;
    },
    rpc: async () => { throw new Error('the attempt must never be created from a short paper'); },
  };

  // A provider whose usable inventory stops one question short of the blueprint.
  const { registerHooks: hooks } = await import('node:module');
  hooks({
    resolve(specifier, context, next) {
      if (specifier === '@/features/questions/service') {
        return stub(`export async function fetchCanonicalQuestions(){return Array.from({length:59},(_,i)=>({id:'q'+i,source:{provider:'aloc_station',providerQuestionId:'eng-'+i},examBody:'jamb',subject:{id:'eng',slug:'use-of-english',name:'Use of English'},prompt:'p',options:[],assets:[],correctOptionKey:'A'}));}
        export function isSubjectAvailable(){return true;}
        export function resolveQuestionProviderId(){return 'aloc_station';}`);
      }
      return next(specifier, context);
    },
  });

  const { createMockExamAttemptForUser: create } = await import('../features/exams/service.ts?short=1');

  await assert.rejects(
    create('student'),
    (error) => {
      assert.match(error.message, /^MOCK_INVENTORY_SHORTAGE\|/);
      const [, subject, needed, available] = error.message.split('|');
      assert.equal(subject, 'Use of English');
      assert.equal(needed, '60');
      assert.equal(available, '59');
      return true;
    },
    '59 deliverable questions must refuse the mock, never become the paper',
  );
});

test('the student-facing shortage message names the real numbers', async () => {
  const { examErrorResponse } = await import('../features/exams/api.ts');
  const response = examErrorResponse(new Error('MOCK_INVENTORY_SHORTAGE|Use of English|60|59'));
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.code, 'INVENTORY_SHORTAGE');
  assert.match(body.error, /Use of English does not yet have enough questions for a full mock \(59\/60 available\)/);
});

// ------------------------------- the assembly progress guard (cost safety)

/*
 * A top-up round that adds no valid question ends the assembly.
 *
 * The exhaustion break only fires when *nothing new* arrives, so an inventory
 * that keeps producing fresh-but-invalid source ids used to look like progress
 * and spend the whole request budget to deliver nothing. These tests fix the
 * line between "mixed inventory, keep going" and "broken inventory, stop".
 */

/** Counts upstream requests as well as serving a scripted inventory. */
function countedStation(inventory) {
  let upstreamRequests = 0;
  const fetchImpl = async (url) => {
    upstreamRequests += 1;
    const data = inventory.splice(0, Number(url.searchParams.get('limit')));
    return new Response(JSON.stringify({ data, meta: {} }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  return {
    provider: new AlocStationQuestionProvider(fetchImpl, async () => {}),
    upstream: () => upstreamRequests,
  };
}

test('guard 1: an entirely bad first batch is still followed by a productive top-up', async () => {
  // The initial round is exempt from the guard on purpose: a first batch that
  // happens to be all bad must still get its replacements.
  const { provider } = countedStation([...range(1, 60, danglingPassage), ...range(61, 200)]);
  const result = await assembleDeliverableQuestions(provider, ENGLISH);

  assert.equal(result.questions.length, 60, 'a bad opening batch must not end the assembly');
  assert.equal(result.rejections.length, 60);
  assert.ok(result.rounds > 1, 'the top-up must have run');
});

test('guard 2: a top-up that adds even one valid question may continue', async () => {
  /*
   * Round 1 delivers 58 of 60. Round 2 is mostly refused but yields one good
   * question, which is productive, so round 3 runs and closes the paper.
   */
  const inventory = [
    // Round 1 consumes the first 60: 58 valid, 2 refused, so 2 are outstanding.
    ...range(1, 58), danglingPassage(59), danglingPassage(60),
    // Round 2 asks for 5 and gets one good question among four refusals. That is
    // productive — one more than it had — so the assembly must not stop here.
    valid(61), ...range(62, 65, danglingPassage),
    // Round 3 closes the paper.
    ...range(66, 120),
  ];
  const { provider } = countedStation(inventory);
  const result = await assembleDeliverableQuestions(provider, ENGLISH);

  assert.equal(result.questions.length, 60, 'a productive round must not be cut short');
  assert.ok(result.rounds >= 3, `the assembly must have continued past the mixed round, spent ${result.rounds}`);
});

test('guard 3: a top-up that adds nothing valid stops immediately', async () => {
  // Round 1 delivers 59. Every later record is fresh and refused.
  const inventory = [...range(1, 59), ...range(60, 400, danglingPassage)];
  const { provider, upstream } = countedStation(inventory);
  const result = await assembleDeliverableQuestions(provider, ENGLISH);

  assert.equal(result.questions.length, 59, 'the honest shortage is still reported');
  assert.equal(result.rounds, 2, `the first unproductive top-up must end it, spent ${result.rounds} rounds`);
  assert.ok(upstream() < 24, `spend must stay well under the old ceiling, spent ${upstream()}`);
});

test('guard 4: all-dirty inventory no longer spends the full request ceiling', async () => {
  const { provider, upstream } = countedStation(range(1, 1000, danglingPassage));
  const result = await assembleDeliverableQuestions(provider, ENGLISH);

  assert.equal(result.questions.length, 0);
  assert.equal(result.rounds, 2, 'one initial round plus one unproductive top-up, then stop');
  assert.ok(
    upstream() <= 24,
    `all-dirty inventory must cost at most two provider calls, spent ${upstream()} upstream requests`,
  );
});

test('guard 5: the 59/60 regression still reaches 60', async () => {
  // The live shape: a quarter defective and evenly spread. Every top-up round
  // here is productive, so the guard must not interfere with it.
  const inventory = Array.from({ length: 400 }, (_, index) =>
    index % 4 === 3 ? danglingPassage(index + 1) : valid(index + 1));
  const { provider } = countedStation(inventory);
  const result = await assembleDeliverableQuestions(provider, ENGLISH);

  assert.equal(result.questions.length, 60, 'mixed inventory must still assemble a full paper');
  assert.ok(result.rejections.length > 0, 'and the defective records must still have been refused');
});

test('guard 6: a genuinely short but clean inventory still reports its shortage honestly', async () => {
  const { provider } = countedStation(range(1, 40));
  const result = await assembleDeliverableQuestions(provider, ENGLISH);

  assert.equal(result.questions.length, 40, 'it reports what exists, never pads the paper');
  assert.ok(result.rounds <= MAX_INTEGRITY_TOPUP_ROUNDS + 1);
});
