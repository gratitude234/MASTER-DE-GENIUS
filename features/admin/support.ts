import "server-only";

import { displayName, loadDirectory, searchUserIds, type DirectoryEntry } from "@/features/admin/directory";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

export const SUPPORT_PAGE_SIZE = 30;
export const SUPPORT_STATUSES = ["open", "in_progress", "resolved"] as const;
export const SUPPORT_CATEGORIES = ["account", "billing", "academic", "exam_session", "classes", "technical", "other"] as const;
export const SUPPORT_CHANNELS = ["whatsapp", "email", "phone", "in_app", "other"] as const;

export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export type SupportChannel = (typeof SUPPORT_CHANNELS)[number];

export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = { open: "Open", in_progress: "In progress", resolved: "Resolved" };
export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  account: "Account", billing: "Billing / payment", academic: "Academic", exam_session: "Exam or session",
  classes: "Master Classes", technical: "Technical", other: "Other",
};

export interface SupportFilters {
  status?: SupportStatus;
  category?: SupportCategory;
  assignee?: string;
  search?: string;
}

type CaseRow = Database["public"]["Tables"]["support_cases"]["Row"];
export type SupportCaseRow = CaseRow & { student: DirectoryEntry | undefined; assignee: DirectoryEntry | undefined };

export async function listSupportCases(actorId: string, filters: SupportFilters, page: number) {
  let query = createAdminClient()
    .from("support_cases")
    .select("*", { count: "exact" })
    .order("status", { ascending: true })
    .order("created_at", { ascending: false });

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.assignee === "unassigned") query = query.is("assigned_to", null);
  else if (filters.assignee) query = query.eq("assigned_to", filters.assignee);
  if (filters.search) {
    const safe = filters.search.replace(/[%_,()"\\]/g, "").slice(0, 80);
    if (safe) {
      const ids = await searchUserIds(actorId, safe);
      query = ids.length ? query.or(`subject.ilike.%${safe}%,user_id.in.(${ids.join(",")})`) : query.ilike("subject", `%${safe}%`);
    }
  }

  const start = (page - 1) * SUPPORT_PAGE_SIZE;
  const { data, error, count } = await query.range(start, start + SUPPORT_PAGE_SIZE - 1);
  if (error) throw new Error("Could not load support cases.");

  const directory = await loadDirectory(actorId, (data ?? []).flatMap((row) => [row.user_id, row.assigned_to]));
  const total = count ?? 0;
  return {
    rows: (data ?? []).map((row) => ({
      ...row,
      student: row.user_id ? directory.get(row.user_id) : undefined,
      assignee: row.assigned_to ? directory.get(row.assigned_to) : undefined,
    })) as SupportCaseRow[],
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / SUPPORT_PAGE_SIZE)),
  };
}

export async function loadSupportCase(actorId: string, id: string) {
  const { data, error } = await createAdminClient().from("support_cases").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("Could not load the support case.");
  if (!data) return null;
  const directory = await loadDirectory(actorId, [data.user_id, data.assigned_to, data.created_by]);
  return {
    ...data,
    student: data.user_id ? directory.get(data.user_id) : undefined,
    assigneeName: data.assigned_to ? displayName(directory.get(data.assigned_to), "Former admin") : null,
    createdByName: data.created_by ? displayName(directory.get(data.created_by), "Former admin") : null,
  };
}
