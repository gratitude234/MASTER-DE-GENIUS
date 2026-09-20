import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

/**
 * Which provider serves which exam and subject.
 *
 * MASTER had exactly one provider per deployment until WAEC science coverage
 * needed two: ALOC Station holds no verified WAEC Biology, Chemistry, Physics
 * or Agricultural Science, and SdashAPI holds all four. The risk of a routing
 * layer is that provider selection quietly drifts — one answer on the screen
 * that offers a subject, another in the service that builds its session — so
 * these tests pin the single authority and, just as importantly, pin the
 * subjects and exams that must NOT move.
 */

process.env.ALOC_STATION_API_KEY = 'station-test-key';
process.env.ALOC_STATION_BASE_URL = 'https://station.aloc.test/api/v1';
process.env.ALOC_ACCESS_TOKEN = 'aloc-test-token';
process.env.SDASH_API_KEY = 'sdash-test-key';
process.env.SDASH_SANDBOX = 'true';
process.env.QUESTION_PROVIDER = 'aloc_station';

const {
  resolveQuestionProviderId, routedQuestionProvider, configuredQuestionProvider, verifiedRouteEntries,
} = await import('../features/questions/routing.ts');
const {
  isSubjectAvailable, unavailableSubjectSlugs,
  getPracticeFilterCapabilities, getPracticeFilterCapabilitiesBySubject,
} = await import('../features/questions/service.ts');

console.info = () => {};

/** The eleven WAEC subjects ALOC Station has served since WAEC activation. */
const STATION_WAEC = [
  'mathematics', 'economics', 'government', 'commerce', 'literature-in-english',
  'principles-of-accounts', 'geography', 'christian-religious-studies',
  'civic-education', 'history', 'insurance',
];

const SDASH_WAEC = ['biology', 'chemistry', 'physics', 'agricultural-science'];

/* ──────────────────────────────────────────  A/C. the verified routing table */

test('A/C: the four WAEC sciences route to Sdash', () => {
  for (const slug of SDASH_WAEC) {
    assert.equal(routedQuestionProvider('waec', slug), 'sdash', `WAEC ${slug} must route to Sdash`);
    assert.equal(resolveQuestionProviderId('waec', slug), 'sdash');
  }

  assert.deepEqual(
    verifiedRouteEntries().map((route) => `${route.examBody}/${route.subjectSlug}=${route.provider}`).sort(),
    SDASH_WAEC.map((slug) => `waec/${slug}=sdash`).sort(),
    'the routing table holds exactly these four rules and nothing else',
  );
});

test('T: all eleven original WAEC subjects still resolve to the configured provider', () => {
  for (const slug of STATION_WAEC) {
    assert.equal(routedQuestionProvider('waec', slug), null, `${slug} must have no routing rule`);
    assert.equal(resolveQuestionProviderId('waec', slug), 'aloc_station');
  }
});

test('U: JAMB routing is untouched, including the science subjects', () => {
  for (const slug of [...SDASH_WAEC, 'use-of-english', 'mathematics', 'economics', 'history']) {
    assert.equal(routedQuestionProvider('jamb', slug), null, `JAMB ${slug} must have no routing rule`);
    assert.equal(resolveQuestionProviderId('jamb', slug), 'aloc_station',
      `JAMB ${slug} must keep using the configured provider`);
  }
});

test('B: no other exam body routes to Sdash', () => {
  for (const examBody of ['jamb', 'neco', 'post_utme', 'school']) {
    for (const slug of SDASH_WAEC) {
      assert.notEqual(resolveQuestionProviderId(examBody, slug), 'sdash',
        `${examBody} ${slug} must not reach Sdash in this milestone`);
    }
  }
});

test('B: WAEC English and Further Mathematics have no routing rule at all', () => {
  for (const slug of ['use-of-english', 'english-language', 'further-mathematics']) {
    assert.equal(routedQuestionProvider('waec', slug), null);
    assert.equal(resolveQuestionProviderId('waec', slug), 'aloc_station',
      'they fall through to the default, which does not map them either');
    assert.equal(isSubjectAvailable('waec', slug), false, 'so they are never offered');
  }
});

/* ────────────────────────────────────────────────────────────  precedence */

test('precedence: an explicit override wins over a routing rule', () => {
  // The admin panel and the probes must keep being able to ask "what would
  // ALOC Station do with WAEC Biology?" and get an honest answer.
  assert.equal(resolveQuestionProviderId('waec', 'biology', 'aloc_station'), 'aloc_station');
  assert.equal(resolveQuestionProviderId('waec', 'biology', 'internal'), 'internal');
  assert.equal(isSubjectAvailable('waec', 'biology', 'aloc_station'), false,
    'Station genuinely has no WAEC Biology, and the override must say so');
});

test('precedence: a routing rule wins over the global default', () => {
  const previous = process.env.QUESTION_PROVIDER;
  try {
    for (const configured of ['internal', 'aloc', 'aloc_station']) {
      process.env.QUESTION_PROVIDER = configured;
      assert.equal(resolveQuestionProviderId('waec', 'physics'), 'sdash',
        `a verified rule must outrank QUESTION_PROVIDER=${configured}`);
      assert.equal(resolveQuestionProviderId('waec', 'mathematics'), configured);
    }
  } finally {
    process.env.QUESTION_PROVIDER = previous;
  }
});

test('precedence: the global default is the floor, and an unset variable still means internal', () => {
  const previous = process.env.QUESTION_PROVIDER;
  try {
    delete process.env.QUESTION_PROVIDER;
    assert.equal(configuredQuestionProvider(), 'internal');
    assert.equal(resolveQuestionProviderId('jamb', 'physics'), 'internal');
    // A whitespace-only value must not become a provider id.
    process.env.QUESTION_PROVIDER = '   ';
    assert.equal(configuredQuestionProvider(), 'internal');
    // An override of only whitespace is not an override.
    assert.equal(resolveQuestionProviderId('waec', 'biology', '  '), 'sdash');
  } finally {
    process.env.QUESTION_PROVIDER = previous;
  }
});

/* ─────────────────────────────────────  availability and onboarding gating */

test('WAEC now offers fifteen subjects, split across two providers', () => {
  const catalogue = [...STATION_WAEC, ...SDASH_WAEC];
  assert.equal(catalogue.length, 15);
  assert.deepEqual(unavailableSubjectSlugs('waec', catalogue), [],
    'every subject in the WAEC catalogue must resolve to a provider that serves it');
});

test('S: without SDASH_API_KEY the four Sdash subjects are hidden, not advertised', () => {
  const previous = process.env.SDASH_API_KEY;
  delete process.env.SDASH_API_KEY;
  try {
    assert.deepEqual(
      unavailableSubjectSlugs('waec', [...STATION_WAEC, ...SDASH_WAEC]).sort(),
      [...SDASH_WAEC].sort(),
      'onboarding must not advertise a subject whose session would necessarily fail',
    );
    // The eleven Station subjects are unaffected by a missing Sdash key.
    assert.deepEqual(unavailableSubjectSlugs('waec', STATION_WAEC), []);
    // And JAMB is untouched.
    assert.deepEqual(unavailableSubjectSlugs('jamb', ['physics', 'chemistry', 'biology', 'use-of-english']), []);
  } finally {
    process.env.SDASH_API_KEY = previous;
  }
});

test('a missing credential for a provider nobody routes to changes nothing', () => {
  // ALOC Station declares no isConfigured, preserving how it has always
  // behaved: a deployment that names it and forgets its key gets a loud session
  // failure, not a silently empty catalogue.
  const previous = process.env.ALOC_STATION_API_KEY;
  delete process.env.ALOC_STATION_API_KEY;
  try {
    assert.deepEqual(unavailableSubjectSlugs('waec', STATION_WAEC), []);
  } finally {
    process.env.ALOC_STATION_API_KEY = previous;
  }
});

/* ────────────────────────────────────────────  route-aware filter gating */

test('capabilities follow the subject, not the deployment', () => {
  const catalogue = [...STATION_WAEC, ...SDASH_WAEC];
  const { fallback, bySubject } = getPracticeFilterCapabilitiesBySubject('waec', catalogue);

  // ALOC Station can filter WAEC Mathematics by year.
  assert.equal(bySubject.mathematics.years, true);
  assert.equal(bySubject.government.years, true);

  // Sdash on a Sandbox credential cannot, so the control must not be offered.
  for (const slug of SDASH_WAEC) {
    assert.equal(bySubject[slug].years, false, `${slug} must not advertise year selection on Sandbox`);
    assert.equal(bySubject[slug].topics, false);
    assert.equal(bySubject[slug].difficulty, false);
  }

  assert.deepEqual(fallback, getPracticeFilterCapabilities(), 'the fallback is the deployment default');
  assert.deepEqual(Object.keys(bySubject).sort(), [...catalogue].sort());
});

test('declaring production Sdash access restores the year control for those subjects only', () => {
  process.env.SDASH_SANDBOX = 'false';
  try {
    const { bySubject } = getPracticeFilterCapabilitiesBySubject('waec', ['mathematics', 'physics']);
    assert.equal(bySubject.physics.years, true);
    assert.equal(bySubject.mathematics.years, true);
  } finally {
    process.env.SDASH_SANDBOX = 'true';
  }
});

test('JAMB capabilities are unchanged by the routing layer', () => {
  const { bySubject } = getPracticeFilterCapabilitiesBySubject('jamb', ['physics', 'biology', 'use-of-english']);
  const station = getPracticeFilterCapabilities('aloc_station');
  for (const slug of ['physics', 'biology', 'use-of-english']) {
    assert.deepEqual(bySubject[slug], station, `JAMB ${slug} must keep the configured provider's capabilities`);
  }
});

/* ──────────────────────────────────────────────  one provider per session */

test('there is exactly one authoritative routing mechanism', async () => {
  const { readFileSync } = await import('node:fs');
  const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

  // Provider selection must not be re-derived anywhere a session is built or a
  // subject is offered: those call sites read the routing layer or nothing.
  for (const path of [
    'features/practice/service.ts',
    'features/onboarding/queries.ts',
    'app/(student)/practice/page.tsx',
  ]) {
    assert.doesNotMatch(source(path), /process\.env\.QUESTION_PROVIDER/,
      `${path} must not re-derive the provider itself`);
  }

  // And the routing table itself lives in exactly one file.
  assert.match(source('features/questions/routing.ts'), /"agricultural-science": "sdash"/);
  for (const path of ['features/questions/service.ts', 'features/practice/service.ts', 'features/exams/service.ts']) {
    assert.doesNotMatch(source(path), /"sdash"/, `${path} must not name a provider for a subject`);
  }
});
