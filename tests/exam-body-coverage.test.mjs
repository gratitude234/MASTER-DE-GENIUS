import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { registerAliasHook } from '../scripts/alias-hook.mjs';

registerAliasHook();

const { isSubjectAvailable } = await import('../features/questions/service.ts');
const { isStationExamSubjectMapped } = await import('../features/questions/providers/aloc-station/mapping.ts');

/**
 * Which exam bodies each question provider can actually serve.
 *
 * This exists because WAEC went dark in production and nothing said why. The
 * onboarding catalogue marks an exam available only when at least one of its
 * subjects survives `isSubjectAvailable`, so a deployment pointed at a provider
 * that does not map WAEC silently loses a whole exam body — no error, no log,
 * just a greyed-out card reading "not active for the current source".
 *
 * The coupling is legitimate; its invisibility was the problem. These tests
 * make it explicit, and fail loudly if a provider's coverage changes.
 */

const WAEC_MIGRATION = 'supabase/migrations/20260908023000_activate_waec_onboarding.sql';

/**
 * The WAEC subjects the activation migration links in `exam_subjects`, read
 * from the migration itself so this cannot drift from what the database holds.
 */
function waecSubjectsFromMigration() {
  const sql = readFileSync(WAEC_MIGRATION, 'utf8');
  const block = sql.slice(sql.indexOf('ordered_subjects(slug, display_order)'), sql.indexOf('insert into public.exam_subjects'));
  const slugs = [...block.matchAll(/\('([a-z-]+)',\s*\d+\)/g)].map((match) => match[1]);
  assert.ok(slugs.length >= 10, 'the WAEC subject list could not be read from the migration');
  return slugs;
}

test('the provider decides whether WAEC exists at all', () => {
  const waec = waecSubjectsFromMigration();

  // internal serves everything: it declares no supportsSubject, so the service
  // defaults to true.
  assert.equal(waec.every((slug) => isSubjectAvailable('waec', slug, 'internal')), true);

  // The legacy ALOC adapter is JAMB-only, by construction.
  assert.equal(waec.some((slug) => isSubjectAvailable('waec', slug, 'aloc')), false,
    'the legacy aloc provider serves no WAEC subject — this is what darkens the card');

  // ALOC Station is the provider WAEC activation was built on.
  assert.equal(waec.every((slug) => isSubjectAvailable('waec', slug, 'aloc_station')), true,
    'every WAEC subject the migration links must be mapped by the station provider');
});

test('REGRESSION: WAEC onboarding goes dark under the legacy provider', () => {
  const waec = waecSubjectsFromMigration();

  /*
   * `getOnboardingCatalog` computes, for a non-JAMB exam:
   *     available = examSubjects.length > 0
   * where examSubjects is the linked list filtered by isSubjectAvailable. This
   * reproduces that arithmetic against each provider, so the production symptom
   * is reproducible from the test suite rather than from a screenshot.
   */
  const offered = (provider) => waec.filter((slug) => isSubjectAvailable('waec', slug, provider)).length;

  assert.equal(offered('aloc'), 0, 'QUESTION_PROVIDER=aloc renders WAEC unavailable');
  assert.ok(offered('aloc_station') > 0, 'QUESTION_PROVIDER=aloc_station renders WAEC available');
  assert.ok(offered('internal') > 0);
});

test('JAMB stays available on every implemented provider', () => {
  // Whatever happens to WAEC coverage, the JAMB flow must not be collateral.
  // Its onboarding gate additionally requires Use of English plus four subjects.
  for (const provider of ['internal', 'aloc', 'aloc_station']) {
    assert.equal(isSubjectAvailable('jamb', 'use-of-english', provider), true,
      `${provider} must serve Use of English, or JAMB onboarding cannot complete`);
    const core = ['mathematics', 'physics', 'chemistry', 'biology']
      .filter((slug) => isSubjectAvailable('jamb', slug, provider));
    assert.ok(core.length >= 3, `${provider} must serve the core JAMB subjects`);
  }
});

test('the station mapping and the WAEC migration agree on the subject list', () => {
  const migrationSlugs = waecSubjectsFromMigration();

  // A subject linked in the database but unmapped upstream would be offered and
  // then fail at session creation; a mapping with no link is simply unreachable.
  for (const slug of migrationSlugs) {
    assert.equal(isStationExamSubjectMapped('waec', slug), true,
      `${slug} is linked for WAEC but the station provider cannot serve it`);
  }
});

test('NECO stays honestly unavailable rather than half-offered', () => {
  // Station lists NECO inventory for only three subjects, so the product does
  // not offer it. This fails if someone maps more without revisiting the UI.
  const necoMapped = ['civic-education', 'commerce', 'government']
    .every((slug) => isStationExamSubjectMapped('neco', slug));
  assert.equal(necoMapped, true);
  assert.equal(isStationExamSubjectMapped('neco', 'mathematics'), false,
    'if NECO coverage grows, the onboarding copy must be revisited too');
});

test('the WAEC release documents the provider it depends on', () => {
  // The migration alone does not activate WAEC. Anyone applying it needs to
  // know the environment variable is half of the release.
  const notes = readFileSync('WAEC-ACTIVATION-NOTES.md', 'utf8');
  assert.ok(notes.includes('QUESTION_PROVIDER=aloc_station'),
    'the notes must state the provider WAEC requires');
});
