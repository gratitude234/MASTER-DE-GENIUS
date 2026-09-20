import { registerAliasHook } from './alias-hook.mjs';
import { registerTsxHook } from './tsx-hook.mjs';
import { pathToFileURL } from 'node:url';

registerAliasHook();
registerTsxHook();

/**
 * One-time operator tool: close out MASTER payments left `pending` before the
 * Paystack secret key is rotated.
 *
 * Why it has to run *before* the rotation. A transaction can only be verified
 * by the business that created it, so a payment opened under the old Paystack
 * business becomes unverifiable the moment MASTER's own key replaces it. Any
 * row still `pending` at that point can never be settled by this application
 * again — it would have to be read out of the old dashboard and handled by
 * hand. This drains that queue while the old key is still configured.
 *
 * It owns no payment logic. Reporting asks Paystack the same read-only
 * question the callback asks, and applying calls `reconcilePayment()` — the
 * same function the student's own "Check this payment" button uses, with the
 * same ownership scoping, the same amount, currency and environment checks and
 * the same `apply_successful_payment`. A second implementation of "did this
 * payment succeed?" is exactly what must not exist.
 *
 * Read-only unless `--apply` is passed. Safe to re-run: payment application is
 * idempotent, and a row that is no longer pending is skipped.
 *
 *   node --experimental-transform-types --env-file=.env.local \
 *     scripts/reconcile-pending-payments.mjs
 *
 *   node --experimental-transform-types --env-file=.env.local \
 *     scripts/reconcile-pending-payments.mjs --apply
 */

const DEFAULTS = { limit: 50, sinceDays: 90 };
const MAX_LIMIT = 200;
const MAX_SINCE_DAYS = 365;

/** Parses the flags, clamping every bound rather than trusting what was typed. */
export function parseOptions(argv = []) {
  const numeric = (flag, fallback, max) => {
    const raw = argv.find((arg) => arg.startsWith(`${flag}=`))?.slice(flag.length + 1);
    if (raw === undefined) return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, max);
  };

  return {
    apply: argv.includes('--apply'),
    limit: numeric('--limit', DEFAULTS.limit, MAX_LIMIT),
    sinceDays: numeric('--since-days', DEFAULTS.sinceDays, MAX_SINCE_DAYS),
  };
}

/**
 * What the operator is told a row would become.
 *
 * Only the four statuses the schema allows a pending payment to move to, plus
 * "still pending" for a transaction Paystack has not decided yet and
 * "unverifiable" for one it could not answer about at all. Nothing here guesses:
 * an unreachable provider is reported as unresolved, never as a failure.
 */
export function classify(verifiedStatus) {
  switch (verifiedStatus) {
    case 'success': return { becomes: 'success', grants: true, resolved: true };
    case 'failed': return { becomes: 'failed', grants: false, resolved: true };
    case 'abandoned': return { becomes: 'abandoned', grants: false, resolved: true };
    case 'reversed': return { becomes: 'reversed', grants: false, resolved: true };
    case 'unverifiable': return { becomes: 'pending', grants: false, resolved: false };
    default: return { becomes: 'pending', grants: false, resolved: false };
  }
}

/** A stable, greppable line per row. No keys, no card data, no customer details. */
export function formatRow(row) {
  return [
    row.reference.padEnd(46),
    String(row.previousStatus).padEnd(10),
    String(row.verifiedStatus).padEnd(13),
    String(row.becomes).padEnd(10),
    row.applied ? 'entitlement applied' : row.appliedAttempted ? 'no entitlement' : 'not applied (report only)',
  ].join(' ');
}

export function summarise(rows) {
  const tally = { total: rows.length, resolved: 0, unresolved: 0, granted: 0 };
  for (const row of rows) {
    if (row.resolved) tally.resolved += 1; else tally.unresolved += 1;
    if (row.applied) tally.granted += 1;
  }
  return tally;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));

  const { createAdminClient } = await import('@/lib/supabase/admin');
  const { paystackConfigured, paystackEnvironment, verifyPaystackTransaction, isMasterPaymentReference } =
    await import('@/features/billing/paystack');
  const { reconcilePayment } = await import('@/features/billing/reconcile');

  if (!paystackConfigured()) {
    console.error('PAYSTACK_SECRET_KEY is not set, so nothing can be verified. Run this while the OLD key is still configured.');
    process.exitCode = 2;
    return;
  }

  // The mode, never the key. Which Paystack world is in use is the one thing
  // the operator must confirm before trusting any line below.
  console.log(`Paystack mode: ${paystackEnvironment()}`);
  console.log(`Mode: ${options.apply ? 'APPLY — payments will be settled' : 'REPORT ONLY — nothing will be changed'}`);
  console.log(`Scope: up to ${options.limit} pending MASTER payments created in the last ${options.sinceDays} days\n`);

  const admin = createAdminClient();
  const since = new Date(Date.now() - options.sinceDays * 86_400_000).toISOString();

  const { data, error } = await admin
    .from('payment_transactions')
    .select('reference, user_id, status, created_at')
    .eq('status', 'pending')
    // Only payments this application created. Every row it has ever written
    // carries the `mdg_` namespace, so this is a belt-and-braces filter over a
    // set that is already only ours.
    .like('reference', 'mdg_%')
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(options.limit);

  if (error) {
    console.error(`Could not list pending payments: ${error.code ?? 'unknown'}`);
    process.exitCode = 1;
    return;
  }

  const pending = (data ?? []).filter((row) => isMasterPaymentReference(row.reference));
  if (pending.length === 0) {
    console.log('No pending MASTER payments in this window. Nothing to do.');
    return;
  }

  console.log('REFERENCE                                      WAS        PAYSTACK SAYS BECOMES    RESULT');
  const results = [];

  for (const row of pending) {
    let verifiedStatus = 'unverifiable';
    try {
      verifiedStatus = (await verifyPaystackTransaction(row.reference)).status;
    } catch {
      // A provider error is not a payment failure. It stays unresolved and is
      // listed at the end for a human.
      verifiedStatus = 'unverifiable';
    }

    const verdict = classify(verifiedStatus);
    const result = {
      reference: row.reference,
      userId: row.user_id,
      previousStatus: row.status,
      verifiedStatus,
      becomes: verdict.becomes,
      resolved: verdict.resolved,
      applied: false,
      appliedAttempted: false,
    };

    if (options.apply && verdict.resolved) {
      result.appliedAttempted = true;
      try {
        // The existing authority, scoped to the row's own owner. It verifies
        // again, re-checks amount, currency and environment, and applies
        // through apply_successful_payment.
        const reconciled = await reconcilePayment(row.user_id, row.reference);
        result.applied = reconciled.activated;

        // reconcilePayment reports a reversal to the student as "failed"; the
        // stored status is the precise one, so it is read back rather than
        // inferred.
        const { data: after } = await admin
          .from('payment_transactions')
          .select('status')
          .eq('reference', row.reference)
          .maybeSingle();
        if (after?.status) result.becomes = after.status;
      } catch {
        result.resolved = false;
        result.becomes = 'pending';
        console.error(`  ! ${row.reference} could not be settled; left pending`);
      }
    }

    results.push(result);
    console.log(formatRow(result));
  }

  const tally = summarise(results);
  console.log(`\n${tally.total} pending payment(s) examined.`);
  console.log(`  resolved:   ${tally.resolved}`);
  console.log(`  unresolved: ${tally.unresolved}`);
  if (options.apply) console.log(`  entitlements applied: ${tally.granted}`);

  const unresolved = results.filter((row) => !row.resolved);
  if (unresolved.length) {
    console.log('\nStill pending — Paystack has not decided these, or could not be reached.');
    console.log('Re-run later. Any that remain when the key is rotated must be settled by hand from the old dashboard:');
    for (const row of unresolved) console.log(`  ${row.reference}  (user ${row.userId})`);
  }

  if (!options.apply) {
    console.log('\nNothing was changed. Re-run with --apply to settle the resolved rows above.');
  }
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  await main().catch((error) => {
    // The message only; a cause can carry a request URL and its headers.
    console.error(`Reconciliation failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });
}
