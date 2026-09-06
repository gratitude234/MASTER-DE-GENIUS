import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

process.env.ALOC_ACCESS_TOKEN = 'test-token-never-logged';
process.env.ALOC_BASE_URL = 'https://questions.aloc.test/api/v2';

const { AlocQuestionProvider } = await import('../features/questions/providers/aloc/index.ts');
const {
  alocSubject, isMappedSubject, isQuarantinedSubject,
  subjectMappingEntries, quarantinedSubjectEntries,
} = await import('../features/questions/providers/aloc/mapping.ts');
const { fetchCanonicalQuestions, isSubjectAvailable, unavailableSubjectSlugs } =
  await import('../features/questions/service.ts');
const { QuestionProviderUnsupportedFilterError } = await import('../features/questions/errors.ts');

console.info = () => {};

const QUARANTINED_SLUG = 'agricultural-science';

/** Fails the test if any upstream request is attempted. */
function forbiddenNetwork() {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ status: 200, data: [] }), { status: 200 });
  };
  return { calls, provider: new AlocQuestionProvider(fetchImpl) };
}

test('REGRESSION: agricultural-science is quarantined, not mapped', () => {
  assert.equal(isMappedSubject(QUARANTINED_SLUG), false, 'must not count as a usable mapping');
  assert.equal(isQuarantinedSubject(QUARANTINED_SLUG), true, 'must be explicitly quarantined');

  const mapped = subjectMappingEntries().map(([slug]) => slug);
  assert.equal(mapped.includes(QUARANTINED_SLUG), false, 'must not appear in the active mapping table');

  // The candidate identifier is retained for probing, but only in quarantine.
  const quarantined = Object.fromEntries(quarantinedSubjectEntries());
  assert.ok(quarantined[QUARANTINED_SLUG], 'the quarantine entry documents why it is held back');
  assert.equal(quarantined[QUARANTINED_SLUG].candidate, 'agriculture');
  assert.match(quarantined[QUARANTINED_SLUG].reason, /unverified/i);
});

test('REGRESSION: resolving the quarantined subject throws and names the reason', () => {
  assert.throws(() => alocSubject(QUARANTINED_SLUG), (error) => {
    assert.ok(error instanceof QuestionProviderUnsupportedFilterError);
    assert.match(error.message, /quarantined/i);
    assert.doesNotMatch(error.studentMessage, /quarantine|aloc|agriculture/i, 'students see no infrastructure detail');
    return true;
  });
});

test('REGRESSION: a quarantined subject never reaches the network', async () => {
  const { calls, provider } = forbiddenNetwork();
  await assert.rejects(
    () => provider.fetchQuestions({ examBody: 'jamb', subjectSlug: QUARANTINED_SLUG, count: 40 }),
    QuestionProviderUnsupportedFilterError,
  );
  assert.deepEqual(calls, [], 'no upstream request may be made for an unverified mapping');
});

test('REGRESSION: the provider reports the quarantined subject as unsupported', () => {
  const provider = new AlocQuestionProvider();
  assert.equal(provider.supportsSubject('jamb', QUARANTINED_SLUG), false);
  assert.equal(provider.supportsSubject('jamb', 'physics'), true);
  assert.equal(provider.supportsSubject('waec', 'physics'), false, 'only JAMB is mapped');
});

test('REGRESSION: the UI gate marks the quarantined subject unavailable', () => {
  assert.equal(isSubjectAvailable('jamb', QUARANTINED_SLUG, 'aloc'), false);
  assert.equal(isSubjectAvailable('jamb', 'physics', 'aloc'), true);

  // A realistic four-subject JAMB selection: only the quarantined one is blocked.
  const selected = ['use-of-english', 'biology', 'chemistry', QUARANTINED_SLUG];
  assert.deepEqual(unavailableSubjectSlugs('jamb', selected, 'aloc'), [QUARANTINED_SLUG]);
  assert.deepEqual(unavailableSubjectSlugs('jamb', ['use-of-english', 'physics'], 'aloc'), []);
});

test('REGRESSION: practice creation is refused before a session exists', async () => {
  await assert.rejects(
    () => fetchCanonicalQuestions({ examBody: 'jamb', subjectSlug: QUARANTINED_SLUG, count: 20 }, 'aloc'),
    (error) => {
      assert.ok(error instanceof QuestionProviderUnsupportedFilterError);
      assert.match(error.studentMessage, /not available from the current question source/i);
      return true;
    },
  );
});

test('REGRESSION: mock generation is refused for the quarantined subject', async () => {
  // The blueprint asks for 40 questions per non-English subject; the provider must
  // refuse rather than build a paper it cannot fill.
  const { calls, provider } = forbiddenNetwork();
  await assert.rejects(
    () => provider.fetchQuestions({ examBody: 'jamb', subjectSlug: QUARANTINED_SLUG, count: 40 }),
    QuestionProviderUnsupportedFilterError,
  );
  assert.deepEqual(calls, []);
});

test('the internal provider is unaffected and still serves the subject', () => {
  // InternalQuestionProvider declares no supportsSubject, so it covers the whole
  // catalogue; quarantine is an ALOC-only concern.
  assert.equal(isSubjectAvailable('jamb', QUARANTINED_SLUG, 'internal'), true);
  assert.equal(isSubjectAvailable('waec', QUARANTINED_SLUG, 'internal'), true);
});

test('every remaining mapped subject is still offered', () => {
  const expected = [
    'use-of-english', 'mathematics', 'physics', 'chemistry', 'biology',
    'economics', 'government', 'commerce', 'literature-in-english',
    'principles-of-accounts', 'geography', 'christian-religious-studies',
    'islamic-studies', 'history',
  ];
  assert.deepEqual(subjectMappingEntries().map(([slug]) => slug).sort(), [...expected].sort());
  assert.equal(subjectMappingEntries().length, 14, 'agricultural-science removed from the mapped set');
  for (const slug of expected) {
    assert.equal(isSubjectAvailable('jamb', slug, 'aloc'), true, `${slug} must remain available`);
  }
});
