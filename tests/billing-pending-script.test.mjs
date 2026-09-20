import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { registerAliasHook } from '../scripts/alias-hook.mjs';
import { registerTsxHook } from '../scripts/tsx-hook.mjs';

registerAliasHook();
registerTsxHook();

/**
 * The one-time operator tool that drains stuck pending payments before the
 * Paystack secret key is rotated.
 *
 * A payment can only be verified by the business that opened it, so a row still
 * `pending` when MASTER's own key replaces the old one becomes unverifiable by
 * this application for ever. That makes the bounds and the default below
 * load-bearing rather than cosmetic: the tool must be safe enough that an
 * operator actually runs it, and incapable of inventing a successful payment.
 */

const script = await import('../scripts/reconcile-pending-payments.mjs');

test('R: it reports by default and only settles when explicitly told to', () => {
  assert.equal(script.parseOptions([]).apply, false, 'the default must never change a payment');
  assert.equal(script.parseOptions(['--limit=10']).apply, false);
  assert.equal(script.parseOptions(['--apply']).apply, true);
});

test('R: every bound is clamped rather than trusted', () => {
  assert.deepEqual(script.parseOptions([]), { apply: false, limit: 50, sinceDays: 90 });

  // Explicit, sane values are honoured.
  assert.equal(script.parseOptions(['--limit=25']).limit, 25);
  assert.equal(script.parseOptions(['--since-days=7']).sinceDays, 7);

  // Everything else falls back or is capped. An unbounded sweep over a payment
  // ledger is exactly what this must not become.
  assert.equal(script.parseOptions(['--limit=100000']).limit, 200);
  assert.equal(script.parseOptions(['--since-days=99999']).sinceDays, 365);
  for (const bad of ['--limit=0', '--limit=-5', '--limit=abc', '--limit=']) {
    assert.equal(script.parseOptions([bad]).limit, 50, bad);
  }
});

test('R: only an authoritative Paystack status resolves a row', () => {
  assert.deepEqual(script.classify('success'), { becomes: 'success', grants: true, resolved: true });
  assert.deepEqual(script.classify('failed'), { becomes: 'failed', grants: false, resolved: true });
  assert.deepEqual(script.classify('abandoned'), { becomes: 'abandoned', grants: false, resolved: true });
  assert.deepEqual(script.classify('reversed'), { becomes: 'reversed', grants: false, resolved: true });

  /*
   * Everything else leaves the row pending. A provider that could not be
   * reached, or a transaction Paystack has not decided, must never be guessed
   * into a failure — and certainly never into a success.
   */
  for (const undecided of ['unverifiable', 'ongoing', 'pending', 'queued', 'unknown', '', undefined]) {
    assert.deepEqual(script.classify(undecided), { becomes: 'pending', grants: false, resolved: false },
      String(undecided));
  }

  const grants = ['success', 'failed', 'abandoned', 'reversed', 'unverifiable', 'ongoing']
    .filter((status) => script.classify(status).grants);
  assert.deepEqual(grants, ['success'], 'only a verified success may lead to an entitlement');
});

test('R: the report names the reference, both statuses and what happened', () => {
  const line = script.formatRow({
    reference: 'mdg_abc12345_0123456789abcdef',
    previousStatus: 'pending',
    verifiedStatus: 'success',
    becomes: 'success',
    applied: true,
    appliedAttempted: true,
  });

  assert.ok(line.includes('mdg_abc12345_0123456789abcdef'));
  assert.ok(line.includes('pending'));
  assert.ok(line.includes('success'));
  assert.ok(line.includes('entitlement applied'));

  // Report mode says plainly that nothing was done, so a dry run cannot be
  // mistaken for a completed cutover.
  const dry = script.formatRow({
    reference: 'mdg_x', previousStatus: 'pending', verifiedStatus: 'success',
    becomes: 'success', applied: false, appliedAttempted: false,
  });
  assert.ok(dry.includes('not applied (report only)'));
});

test('R: the summary distinguishes resolved, unresolved and granted', () => {
  const tally = script.summarise([
    { resolved: true, applied: true },
    { resolved: true, applied: false },
    { resolved: false, applied: false },
    { resolved: false, applied: false },
  ]);
  assert.deepEqual(tally, { total: 4, resolved: 2, unresolved: 2, granted: 1 });
});

test('R: it borrows the existing authority instead of reimplementing payment logic', () => {
  const source = readFileSync('scripts/reconcile-pending-payments.mjs', 'utf8');

  // The grant goes through reconcilePayment, which is the same function the
  // student's own re-check uses: ownership scoping, verification, amount,
  // currency, environment and apply_successful_payment all come with it.
  assert.ok(source.includes('reconcilePayment('), 'settlement goes through the existing reconciler');
  assert.ok(!/\.rpc\(/.test(source),
    'the script must not call a billing RPC itself — no second implementation of "did this payment succeed?"');
  assert.ok(!/\.update\(|\.insert\(|\.upsert\(|\.delete\(/.test(source),
    'and must never write to the payment ledger directly');

  /*
   * Report mode must be incapable of mutating anything, not merely unlikely to.
   * `reconcilePayment` is the only call in the file that can change a payment
   * or an entitlement, and it sits behind the `--apply` guard — so a dry run is
   * two SELECTs and a read-only Paystack verification per row, and nothing else.
   */
  const mutations = [...source.matchAll(/await reconcilePayment\(/g)];
  assert.equal(mutations.length, 1, 'there is exactly one call that can change a payment');
  const guard = source.indexOf('if (options.apply && verdict.resolved)');
  assert.ok(guard >= 0, 'and it is guarded by --apply');
  assert.ok(mutations[0].index > guard, 'the guard precedes the only mutating call');

  // Every database touch in the file is a read.
  const tableCalls = [...source.matchAll(/\.from\('([a-z_]+)'\)/g)].map((match) => match[1]);
  assert.deepEqual(tableCalls, ['payment_transactions', 'payment_transactions']);
  assert.equal([...source.matchAll(/\.select\(/g)].length, tableCalls.length,
    'each table access is a select');

  // Scope: only this application's own pending rows, bounded and dated.
  assert.ok(source.includes("eq('status', 'pending')"), 'only pending rows are considered');
  assert.ok(source.includes("like('reference', 'mdg_%')"), 'only rows this application created');
  assert.ok(source.includes('isMasterPaymentReference'), 'and the namespace invariant is re-checked in code');
  assert.ok(source.includes('.limit(options.limit)'), 'the sweep is bounded');
  assert.ok(source.includes('gte(\'created_at\', since)'), 'and dated');

  /*
   * Naming a variable in a message is how the operator learns what to set;
   * printing its value is the mistake. Only interpolation of a sensitive
   * binding fails, which is the same rule the billing modules are held to.
   */
  for (const binding of ['secret', 'secretKey', 'apiKey', 'key', 'authorization']) {
    const interpolated = new RegExp(`console\\.(log|error|warn)\\([^)]*\\$\\{[^}]*\\b${binding}\\b`, 'i');
    assert.ok(!interpolated.test(source), `the script must not interpolate ${binding} into output`);
  }
  assert.ok(!/paystackSecretKey\(\)/.test(source), 'the script never reads the key itself');
  assert.ok(source.includes('paystackEnvironment()'), 'the mode is shown; the key never is');
});
