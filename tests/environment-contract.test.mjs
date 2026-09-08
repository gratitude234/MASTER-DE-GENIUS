import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The contract between `.env.example` and the code that reads it.
 *
 * Two production incidents came from this template drifting: `QUESTION_PROVIDER`
 * was declared twice with different values, so the loader took one and the value
 * copied into the deployment was the other; and `AI_EXPLANATIONS_DAILY_LIMIT`
 * stayed documented for a release after the code stopped reading it, so setting
 * it looked like it would do something.
 *
 * These tests read the committed template only. `.env.local` is git-ignored and
 * absent in CI, and a test must never depend on somebody's secrets.
 */

const TEMPLATE = '.env.example';

/** Variables the template documents deliberately without reading them yet. */
const RESERVED = new Set([
  // Documented as "Future provider — NOT implemented", so its presence in the
  // template is the point. Remove from here the moment it is wired up.
  'SDASH_API_KEY',
]);

/** Without these the app cannot boot or take a payment, so they must be documented. */
const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'NEXT_PUBLIC_APP_URL',
  'QUESTION_PROVIDER',
  'PAYSTACK_SECRET_KEY',
  'NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY',
];

function templateEntries() {
  return readFileSync(TEMPLATE, 'utf8')
    .split(/\r?\n/)
    .map((line, index) => {
      const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      return match ? { line: index + 1, key: match[1], value: match[2] } : null;
    })
    .filter(Boolean);
}

/** Every `process.env.X` the application source reads. */
function environmentReadsInSource() {
  const found = new Set();
  const skip = new Set(['node_modules', '.next', '.git', 'out', 'design-reference']);

  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (!/\.(ts|tsx|mjs)$/.test(name)) continue;
      for (const match of readFileSync(path, 'utf8').matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        found.add(match[1]);
      }
    }
  };

  for (const dir of ['app', 'features', 'lib', 'components', 'scripts', 'types']) walk(dir);
  return found;
}

test('the template never declares a key twice', () => {
  /*
   * The exact shape of the WAEC outage: QUESTION_PROVIDER appeared as both
   * `aloc` and `aloc_station`. Locally the last won and everything looked fine;
   * the deployment got the other one and a whole exam body went dark.
   */
  const seen = new Map();
  const duplicates = [];
  for (const entry of templateEntries()) {
    if (seen.has(entry.key)) duplicates.push(`${entry.key} (lines ${seen.get(entry.key)} and ${entry.line})`);
    else seen.set(entry.key, entry.line);
  }
  assert.deepEqual(duplicates, [], `${TEMPLATE} declares a key more than once`);
});

test('every documented variable is actually read by the code', () => {
  const reads = environmentReadsInSource();
  const orphans = templateEntries()
    .map((entry) => entry.key)
    .filter((key) => !reads.has(key) && !RESERVED.has(key));

  assert.deepEqual(orphans, [],
    'these are documented but nothing reads them — either wire them up, delete them, or add them to RESERVED');
});

test('every variable the app cannot run without is documented', () => {
  const documented = new Set(templateEntries().map((entry) => entry.key));
  const missing = REQUIRED.filter((key) => !documented.has(key));

  assert.deepEqual(missing, [],
    `${TEMPLATE} must document every variable a deployment has to set`);
});

test('no secret is documented under a browser-visible name', () => {
  /*
   * Anything prefixed NEXT_PUBLIC_ is inlined into the client bundle. A secret
   * placed there is published, not configured — and the template is where that
   * mistake would be copied from.
   */
  for (const entry of templateEntries()) {
    if (!entry.key.startsWith('NEXT_PUBLIC_')) continue;
    assert.ok(!/(^|_)(SECRET|SERVICE_ROLE|PRIVATE)(_|$)/.test(entry.key),
      `${entry.key} is browser-visible but named like a secret`);
    assert.ok(!/^(sk_|sb_secret_)/.test(entry.value.trim()),
      `${entry.key} is browser-visible but its example value looks like a secret`);
  }
});

test('the template pins a question provider that can serve every live exam body', () => {
  const provider = templateEntries().find((entry) => entry.key === 'QUESTION_PROVIDER')?.value.trim();
  // `aloc` is JAMB-only, so shipping it as the template default is what put
  // WAEC behind an "unavailable" card. `internal` serves the demo seed only.
  assert.equal(provider, 'aloc_station',
    'the documented default must be the provider that serves both JAMB and WAEC');
});
