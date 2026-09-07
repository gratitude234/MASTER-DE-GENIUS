import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('./engine-manifest.json', import.meta.url), 'utf8'));

/**
 * The session engine is production-critical: frozen question sets, answer
 * persistence, the offline queue and IndexedDB, the Web-Locks single-editor
 * guard, the monotonic clock, the server-authoritative timer, auto-submit,
 * grading and every route that writes them.
 *
 * UI work must not reach into any of it. This guard fails loudly if one of
 * those files changes, so an engine edit can only ever be deliberate: the fix
 * is to re-record the manifest in the same commit as the reviewed change, never
 * to weaken this test.
 *
 *   node -e "…"  or: npm run test  (see the report for the regeneration snippet)
 */
test('the session engine is untouched by presentation work', () => {
  const changed = [];
  const missing = [];

  for (const [file, expected] of Object.entries(manifest)) {
    let contents;
    try {
      contents = readFileSync(new URL(`../${file}`, import.meta.url));
    } catch {
      missing.push(file);
      continue;
    }
    const actual = createHash('sha256').update(contents).digest('hex');
    if (actual !== expected) changed.push(file);
  }

  assert.deepEqual(missing, [], 'an engine file was moved or deleted');
  assert.deepEqual(
    changed,
    [],
    'engine files changed — re-record tests/engine-manifest.json only alongside a reviewed engine change',
  );
});

test('the guard covers every engine surface it claims to', () => {
  const covered = Object.keys(manifest);
  for (const required of [
    'features/offline/use-session.ts',
    'features/offline/queue.ts',
    'features/offline/storage.ts',
    'features/offline/clock.ts',
    'features/exams/service.ts',
    'features/practice/service.ts',
    'features/results/grading.ts',
    'app/api/exam/attempts/[attemptId]/submit/route.ts',
  ]) {
    assert.ok(covered.includes(required), `${required} must be guarded`);
  }
  assert.ok(covered.length >= 30, 'the manifest should cover the whole engine, not a sample');
});
