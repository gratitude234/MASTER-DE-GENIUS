import "server-only";

import type { AdminPermission } from "@/features/admin/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

export interface DirectoryEntry {
  userId: string;
  email: string | null;
  fullName: string;
}

export function displayName(entry: DirectoryEntry | undefined, fallback = "Unknown account"): string {
  if (!entry) return fallback;
  return entry.fullName.trim() || entry.email || fallback;
}

/** Names and emails for a page of rows, in one query rather than one per row. */
export async function loadDirectory(actorId: string, ids: (string | null | undefined)[]): Promise<Map<string, DirectoryEntry>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const { data, error } = await createAdminClient().rpc("admin_user_directory", { p_actor_id: actorId, p_user_ids: unique.slice(0, 500) });
  if (error) throw new Error("Could not load account names.");
  return new Map((data ?? []).map((row) => [row.user_id, { userId: row.user_id, email: row.email, fullName: row.full_name }]));
}

export async function searchUserIds(actorId: string, search: string, limit = 50): Promise<string[]> {
  const { data, error } = await createAdminClient().rpc("admin_search_users", { p_actor_id: actorId, p_search: search, p_limit: limit });
  if (error) throw new Error("Could not search accounts.");
  return (data ?? []).map((row) => row.user_id);
}

/** Active admins who may be assigned work needing this permission. */
export async function loadAssignees(actorId: string, permission: AdminPermission): Promise<DirectoryEntry[]> {
  const { data, error } = await createAdminClient().rpc("admin_list_assignees", { p_actor_id: actorId, p_permission: permission });
  if (error) throw new Error("Could not load assignable admins.");
  return (data ?? []).map((row) => ({ userId: row.user_id, email: row.email, fullName: row.full_name }));
}

export interface InternalNote {
  id: string;
  body: string;
  createdAt: string;
  author: string;
}

export async function loadInternalNotes(actorId: string, entityType: "class_lead" | "support_case", entityId: string): Promise<InternalNote[]> {
  const { data, error } = await createAdminClient()
    .from("admin_internal_notes")
    .select("id, body, author_id, created_at")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("Could not load internal notes.");
  const directory = await loadDirectory(actorId, (data ?? []).map((note) => note.author_id));
  return (data ?? []).map((note) => ({
    id: note.id,
    body: note.body,
    createdAt: note.created_at,
    author: note.author_id ? displayName(directory.get(note.author_id), "Former admin") : "Former admin",
  }));
}

export interface HistoryEntry {
  id: number;
  action: string;
  actor: string;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * The audit trail for one record, shown where the work happens — a lead's
 * status history, a case's assignments. Reading it here needs only the
 * permission for that record, not the full audit log.
 */
export async function loadEntityHistory(actorId: string, entityType: string, entityId: string, limit = 50): Promise<HistoryEntry[]> {
  const { data, error } = await createAdminClient()
    .from("admin_audit_log")
    .select("id, actor_id, action, reason, before_state, after_state, created_at")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("Could not load history.");
  const directory = await loadDirectory(actorId, (data ?? []).map((row) => row.actor_id));
  return (data ?? []).map((row) => ({
    id: row.id,
    action: row.action,
    actor: row.actor_id ? displayName(directory.get(row.actor_id), "Former admin") : "Database console",
    reason: row.reason,
    before: asObject(row.before_state),
    after: asObject(row.after_state),
    createdAt: row.created_at,
  }));
}
