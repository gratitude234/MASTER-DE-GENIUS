import "server-only";

import { displayName, loadDirectory, searchUserIds, type DirectoryEntry } from "@/features/admin/directory";
import { BILLING_PLANS } from "@/features/billing/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

export const PAYMENT_PAGE_SIZE = 30;
export const PAYMENT_STATUSES = ["success", "pending", "failed", "abandoned", "reversed"] as const;
export const PAYMENT_ENVIRONMENTS = ["live", "test"] as const;
export const PAYMENT_PLAN_SLUGS = BILLING_PLANS.filter((plan) => plan.tier !== "free").map((plan) => plan.slug);

export interface PaymentFilters {
  status?: (typeof PAYMENT_STATUSES)[number];
  environment?: (typeof PAYMENT_ENVIRONMENTS)[number];
  plan?: string;
  search?: string;
  from?: string;
  to?: string;
}

export type PaymentRow = Database["public"]["Tables"]["payment_transactions"]["Row"] & { student: DirectoryEntry | undefined };

/**
 * The payment ledger, read-only. Amounts stay in kobo until they are rendered,
 * and nothing in the admin workspace writes to this table — a correction to a
 * student's access is a manual grant, recorded separately.
 */
export async function listPayments(actorId: string, filters: PaymentFilters, page: number) {
  const db = createAdminClient();
  let query = db
    .from("payment_transactions")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.environment) query = query.eq("environment", filters.environment);
  if (filters.plan) query = query.eq("plan_slug", filters.plan);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lt("created_at", filters.to);

  if (filters.search) {
    const safe = filters.search.replace(/[%_,()"\\]/g, "").slice(0, 80);
    if (safe) {
      // A reference is matched directly; a name or email is resolved to account
      // ids first, since the ledger stores only the id.
      const ids = await searchUserIds(actorId, safe);
      query = ids.length
        ? query.or(`reference.ilike.%${safe}%,user_id.in.(${ids.join(",")})`)
        : query.ilike("reference", `%${safe}%`);
    }
  }

  const start = (page - 1) * PAYMENT_PAGE_SIZE;
  const { data, error, count } = await query.range(start, start + PAYMENT_PAGE_SIZE - 1);
  if (error) throw new Error("Could not load payments.");

  const directory = await loadDirectory(actorId, (data ?? []).map((row) => row.user_id));
  const rows: PaymentRow[] = (data ?? []).map((row) => ({ ...row, student: directory.get(row.user_id) }));
  const total = count ?? 0;
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / PAYMENT_PAGE_SIZE)) };
}

export interface ManualGrantRow {
  id: number;
  userId: string;
  student: string;
  eventType: string;
  actor: string;
  reason: string | null;
  previousExpiresAt: string | null;
  newExpiresAt: string | null;
  createdAt: string;
}

/** Access given by hand, listed apart from purchases so the two never blur. */
export async function listManualGrants(actorId: string, limit = 15): Promise<ManualGrantRow[]> {
  const { data, error } = await createAdminClient()
    .from("entitlement_events")
    .select("id, user_id, event_type, actor_id, reason, previous_expires_at, new_expires_at, created_at")
    .eq("source", "admin")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("Could not load manual grants.");

  const directory = await loadDirectory(actorId, (data ?? []).flatMap((row) => [row.user_id, row.actor_id]));
  return (data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    student: displayName(directory.get(row.user_id)),
    eventType: row.event_type,
    actor: row.actor_id ? displayName(directory.get(row.actor_id), "Former admin") : "Unknown",
    reason: row.reason,
    previousExpiresAt: row.previous_expires_at,
    newExpiresAt: row.new_expires_at,
    createdAt: row.created_at,
  }));
}
