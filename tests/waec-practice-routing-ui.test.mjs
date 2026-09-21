import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { registerTsxHook } from '../scripts/tsx-hook.mjs';

registerAliasHook();
registerTsxHook();

/**
 * The Practice screen for a WAEC student whose subjects span two providers.
 *
 * Filter capabilities used to be a property of the deployment, and that stops
 * being true the moment one screen lists WAEC Mathematics (ALOC Station, which
 * can filter by year) beside WAEC Physics (Sdash, which on the Sandbox plan
 * cannot). A single set of controls would either hide a filter that works or
 * advertise one that does not — and the second is worse, because an
 * unhonourable filter fails session creation.
 *
 * The real providers make these decisions; nothing here is stubbed except the
 * data layer. No request is made: capabilities and subject mapping are pure
 * lookups.
 */

process.env.QUESTION_PROVIDER = 'aloc_station';
process.env.ALOC_STATION_API_KEY = 'station-test-key';
process.env.ALOC_STATION_BASE_URL = 'https://station.aloc.test/api/v1';
process.env.SDASH_API_KEY = 'sdash-test-key';
process.env.SDASH_SANDBOX = 'true';

const stub = (source) => ({ url: 'data:text/javascript,' + encodeURIComponent(source), shortCircuit: true });

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/link') {
      return { url: new URL('./stubs/next-link.mjs', import.meta.url).href, shortCircuit: true };
    }
    if (specifier === 'next/navigation') return stub(`export function useRouter(){ return { push(){} }; }`);
    if (specifier === '@/lib/auth') return stub(`export async function requireOnboardedUser(){ return { user: { id: 'user-1' } }; }`);
    if (specifier === '@/features/questions/catalog') return stub(`export async function getPracticeCatalog(){ return globalThis.__catalog; }`);
    if (specifier === '@/features/practice/service') return stub(`export async function getLatestActivePracticeSessionForUser(){ return null; }`);
    if (specifier === '@/features/results/service') return stub(`export async function loadHistory(){ return []; }`);
    if (specifier === "@/features/billing/usage") return { url: new URL("./stubs/billing-usage.mjs", import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
});

const React = (await import('react')).default;
const { prerenderToNodeStream } = await import('react-dom/static');
const PracticePage = (await import('../app/(student)/practice/page.tsx')).default;

const subject = (slug, name) => ({ id: slug, slug, name, isCompulsory: false, displayOrder: 1, topics: [] });

/** A realistic post-migration WAEC selection: three Station, two Sdash. */
globalThis.__catalog = {
  examCode: 'waec',
  examBodyId: 'waec-id',
  examName: 'WAEC',
  examYear: 2027,
  subjects: [
    subject('mathematics', 'Mathematics'),
    subject('biology', 'Biology'),
    subject('physics', 'Physics'),
    subject('government', 'Government'),
    subject('economics', 'Economics'),
  ],
};

async function render(params = {}) {
  const { prelude } = await prerenderToNodeStream(
    React.createElement(PracticePage, { searchParams: Promise.resolve(params) }),
  );
  let markup = '';
  for await (const chunk of prelude) markup += chunk;
  return markup;
}

test('every WAEC subject in the catalogue is offered, whichever provider serves it', async () => {
  const markup = await render();

  for (const name of ['Mathematics', 'Biology', 'Physics', 'Government', 'Economics']) {
    assert.ok(markup.includes(name), `${name} must be selectable`);
  }
  assert.ok(!markup.includes('Not available yet'), 'no WAEC subject is offered as dead');
});

test('the year control follows the selected subject, not the deployment', async () => {
  // Mathematics is first in the catalogue, so the Past Questions tab opens on
  // an ALOC Station subject: the year control is present.
  const markup = await render({ mode: 'past' });
  assert.ok(markup.includes('id="practice-year"'), 'ALOC Station can filter WAEC Mathematics by year');
  assert.ok(markup.includes('Pick one year'));
});

test('the same screen hides the year control when the selected subject is Sdash-backed', async () => {
  // Identical page, identical deployment — only which subject opens selected
  // differs. That is the whole point: the control follows the provider behind
  // the subject, not the value of QUESTION_PROVIDER.
  const original = globalThis.__catalog;
  globalThis.__catalog = {
    ...original,
    subjects: [
      subject('physics', 'Physics'),
      subject('mathematics', 'Mathematics'),
      subject('government', 'Government'),
    ],
  };
  try {
    const markup = await render({ mode: 'past' });
    assert.ok(!markup.includes('id="practice-year"'),
      'Sdash Sandbox stocks one year per subject, so the control must not be offered');
    assert.ok(markup.includes('Year filtering is not available from the current question source.'),
      'and the student is told why, in their own terms');
  } finally {
    globalThis.__catalog = original;
  }
});

test('the year control returns for the same student on an ALOC Station subject', async () => {
  const markup = await render({ mode: 'past' });
  assert.ok(markup.includes('id="practice-year"'));
  assert.ok(!markup.includes('Year filtering is not available'));
});

test('no Sdash credential turns the science subjects off rather than advertising them', async () => {
  const previous = process.env.SDASH_API_KEY;
  delete process.env.SDASH_API_KEY;
  try {
    const markup = await render();
    // Both Sdash subjects are still listed, but as unselectable, with the
    // student-facing reason rather than a provider name.
    const button = (name) =>
      markup.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${name}(?:(?!</button>).)*</button>`, 's'))?.[0];

    for (const name of ['Biology', 'Physics']) {
      const element = button(name);
      assert.ok(element, `${name} is still listed`);
      assert.ok(element.includes('disabled'), `${name} cannot be selected without a credential`);
      assert.ok(element.includes('not in our current question source'));
    }
    assert.ok(!button('Mathematics').includes('disabled'), 'ALOC Station subjects are unaffected');
    assert.equal(/sdash|SDASH|sdashapi/.test(markup), false, 'no provider name or URL reaches the browser');
  } finally {
    process.env.SDASH_API_KEY = previous;
  }
});

test('no credential ever reaches the rendered page', async () => {
  const markup = await render({ mode: 'past' });
  assert.equal(markup.includes('sdash-test-key'), false);
  assert.equal(markup.includes('station-test-key'), false);
  assert.equal(markup.includes('AccessToken'), false);
  assert.equal(markup.includes('SDASH'), false);
});
