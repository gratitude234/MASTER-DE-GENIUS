import "server-only";

import { displayName, loadDirectory, searchUserIds } from "@/features/admin/directory";
import { createAdminClient } from "@/lib/supabase/admin";

export const AUDIT_PAGE_SIZE = 40;

export const AUDIT_ENTITY_TYPES = ["admin", "student", "question", "question_block", "class_lead", "support_case", "exam_attempt", "practice_session"] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "admin.bootstrap": "First super admin established",
  "admin.grant": "Admin access granted",
  "admin.role_change": "Admin role changed",
  "admin.activate": "Admin reactivated",
  "admin.deactivate": "Admin deactivated",
  "admin.update": "Admin role and status changed",
  "student.suspend": "Student suspended",
  "student.reactivate": "Student reactivated",
  "entitlement.grant": "Master access granted",
  "entitlement.extend": "Master access extended",
  "class_lead.status_change": "Lead status changed",
  "class_lead.assign": "Lead assigned",
  "class_lead.note_add": "Lead note added",
  "support_case.create": "Support case opened",
  "support_case.status_change": "Support case status changed",
  "support_case.assign": "Support case assigned",
  "support_case.note_add": "Support note added",
  "question.create": "Question created",
  "question.update": "Question edited",
  "question.status_change": "Question status changed",
  "question.block": "External question blocked",
  "question.unblock": "Question block lifted",
  "session.finalize_overdue": "Overdue session finalised",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export interface AuditFilters {
  entityType?: AuditEntityType;
  entityId?: string;
  actor?: string;
  from?: string;
  to?: string;
}

/** Read-only by construction: the table refuses every update and delete. */
export async function listAuditLog(actorId: string, filters: AuditFilters, page: number) {
  let query = createAdminClient()
    .from("admin_audit_log")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (filters.entityType) query = query.eq("entity_type", filters.entityType);
  if (filters.entityId) query = query.eq("entity_id", filters.entityId.slice(0, 200));
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lt("created_at", filters.to);
  if (filters.actor) {
    const ids = await searchUserIds(actorId, filters.actor, 20);
    if (!ids.length) return { rows: [], total: 0, page, pageCount: 1 };
    query = query.in("actor_id", ids);
  }

  const start = (page - 1) * AUDIT_PAGE_SIZE;
  const { data, error, count } = await query.range(start, start + AUDIT_PAGE_SIZE - 1);
  if (error) throw new Error("Could not load the audit log.");

  const subjectIds = (data ?? [])
    .filter((row) => row.entity_type === "student" || row.entity_type === "admin")
    .map((row) => row.entity_id);
  const directory = await loadDirectory(actorId, [...(data ?? []).map((row) => row.actor_id), ...subjectIds]);
  const total = count ?? 0;
  return {
    rows: (data ?? []).map((row) => ({
      ...row,
      actorName: row.actor_id ? displayName(directory.get(row.actor_id), "Former admin") : "Database console",
      entityName: row.entity_type === "student" || row.entity_type === "admin" ? directory.get(row.entity_id)?.email ?? null : null,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
  };
}
