import "server-only";

import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { CLASS_LEAD_STATUSES, type ClassLeadInput, type ClassLeadStatus, type ClassType } from "@/features/classes/types";

export interface ClassCatalogueSubject { id: string; slug: string; name: string; topics: { slug: string; name: string }[] }

export async function loadClassCatalogue(examCode?: string | null): Promise<ClassCatalogueSubject[]> {
  const db = createAdminClient();
  let examId: string | null = null;
  if (examCode) {
    const { data } = await db.from("exam_bodies").select("id").eq("code", examCode).eq("is_active", true).maybeSingle();
    examId = data?.id ?? null;
  }
  let subjectIds: string[] | null = null;
  if (examId) {
    const { data, error } = await db.from("exam_subjects").select("subject_id").eq("exam_body_id", examId).order("display_order");
    if (error) throw new Error("Could not load class subjects.");
    subjectIds = data.map((row) => row.subject_id);
  }
  const subjectQuery = db.from("subjects").select("id, slug, name").eq("is_active", true).order("name");
  const { data: subjects, error } = subjectIds ? await subjectQuery.in("id", subjectIds) : await subjectQuery;
  if (error) throw new Error("Could not load class subjects.");
  if (!subjects?.length) return [];
  const { data: topics, error: topicError } = await db.from("topics").select("subject_id, slug, name, display_order").in("subject_id", subjects.map((row) => row.id)).eq("is_active", true).order("display_order");
  if (topicError) throw new Error("Could not load class topics.");
  return subjects.map((subject) => ({ ...subject, topics: (topics ?? []).filter((topic) => topic.subject_id === subject.id).map(({ slug, name }) => ({ slug, name })) }));
}

async function authoritativeSubject(examType: "jamb" | "waec", slug: string) {
  const db = createAdminClient();
  const { data, error } = await db.from("subjects").select("id, slug, name").eq("slug", slug).eq("is_active", true).maybeSingle();
  if (error || !data) throw new Error("That subject is not available for classes.");
  const { data: exam } = await db.from("exam_bodies").select("id").eq("code", examType).eq("is_active", true).maybeSingle();
  if (!exam) throw new Error("That exam is not currently available.");
  const { data: link } = await db.from("exam_subjects").select("subject_id").eq("exam_body_id", exam.id).eq("subject_id", data.id).maybeSingle();
  if (!link) throw new Error("That subject is not available for the selected exam.");
  return data;
}

export async function createClassLead(userId: string, input: ClassLeadInput) {
  const subject = await authoritativeSubject(input.examType, input.subjectSlug);
  const fingerprint = createHash("sha256").update(JSON.stringify([input.examType, subject.slug, input.topic?.toLowerCase() ?? null, input.classType, input.phone])).digest("hex");
  const db = createAdminClient();
  const { data, error } = await db.rpc("create_premium_class_lead", {
    p_user_id: userId, p_student_name: input.studentName, p_exam_type: input.examType,
    p_subject_slug: subject.slug, p_subject_name: subject.name, p_topic: input.topic,
    p_class_type: input.classType, p_phone: input.phone, p_email: input.email,
    p_preferred_contact_method: input.preferredContactMethod, p_preferred_schedule: input.preferredSchedule,
    p_message: input.message, p_source: input.source, p_recommendation_reason: input.recommendationReason,
    p_recent_accuracy: input.recentAccuracy, p_fingerprint: fingerprint,
  });
  if (error || !data?.[0]) throw new Error("We could not save your class request. Please try again.");
  const result = data[0];

  if (!result.deduplicated) {
    const channels = [input.promotionalWhatsappConsent ? "whatsapp" : null, input.promotionalEmailConsent ? "email" : null].filter((value): value is "whatsapp" | "email" => Boolean(value));
    for (const channel of channels) {
      await db.from("marketing_consents").upsert({ user_id: userId, channel, purpose: "classes_and_study_support", source_lead_id: result.lead_id, granted_at: new Date().toISOString(), revoked_at: null }, { onConflict: "user_id,channel,purpose" });
    }
  }
  return { id: result.lead_id, deduplicated: result.deduplicated };
}

export async function listStudentLeads(userId: string, limit = 8) {
  const db = createAdminClient();
  const { data, error } = await db.from("premium_class_leads")
    .select("id, exam_type, subject_name, topic, class_type, status, created_at")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error("Could not load your class requests.");
  return data;
}

/**
 * The number a student last asked us to call. No profile table stores a phone,
 * so their most recent request is the only record of it, and reusing it saves
 * them retyping the one field that matters most on every later enquiry.
 */
export async function latestLeadPhone(userId: string) {
  const db = createAdminClient();
  const { data } = await db.from("premium_class_leads")
    .select("phone").eq("user_id", userId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.phone ?? "";
}

export async function isAppAdmin(userId: string) {
  const db = createAdminClient();
  const { data } = await db.from("app_admins").select("user_id").eq("user_id", userId).maybeSingle();
  return Boolean(data);
}

export interface AdminLeadFilters { status?: string; exam?: string; subject?: string; classType?: string; search?: string; from?: string }

export const ADMIN_LEADS_PAGE_SIZE = 50;

/**
 * One round trip returns both the requested page and the exact filtered total,
 * so the list can never silently truncate without saying so.
 */
export async function listAdminLeads(filters: AdminLeadFilters, page = 1) {
  const db = createAdminClient();
  const current = Math.max(1, Math.trunc(page) || 1);
  const start = (current - 1) * ADMIN_LEADS_PAGE_SIZE;
  let query = db.from("premium_class_leads").select("*", { count: "exact" }).order("created_at", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status as ClassLeadStatus);
  if (filters.exam === "jamb" || filters.exam === "waec") query = query.eq("exam_type", filters.exam);
  if (filters.subject) query = query.eq("subject_slug", filters.subject);
  if (filters.classType) query = query.eq("class_type", filters.classType as ClassType);
  if (filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from)) query = query.gte("created_at", `${filters.from}T00:00:00.000Z`);
  if (filters.search) {
    const safe = filters.search.replace(/[%_,()]/g, "").slice(0, 80);
    if (safe) query = query.or(`student_name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%`);
  }
  const { data, error, count } = await query.range(start, start + ADMIN_LEADS_PAGE_SIZE - 1);
  if (error) throw new Error("Could not load class leads.");
  const total = count ?? 0;
  return { leads: data, total, page: current, pageCount: Math.max(1, Math.ceil(total / ADMIN_LEADS_PAGE_SIZE)) };
}

/**
 * Exact totals for the CRM summary. These are `head` counts, so the dashboard
 * never pulls student contact details just to render a number, and the figures
 * stay correct however many leads exist.
 */
export async function countLeadsByStatus(): Promise<Record<ClassLeadStatus, number>> {
  const db = createAdminClient();
  const entries = await Promise.all(CLASS_LEAD_STATUSES.map(async (status) => {
    const { count, error } = await db.from("premium_class_leads").select("id", { count: "exact", head: true }).eq("status", status);
    if (error) throw new Error("Could not load class lead totals.");
    return [status, count ?? 0] as const;
  }));
  return Object.fromEntries(entries) as Record<ClassLeadStatus, number>;
}

export async function updateAdminLead(id: string, input: { status: ClassLeadStatus; notes: string | null }, adminId: string) {
  const db = createAdminClient();
  const now = new Date().toISOString();
  const timestamps = input.status === "contacted" ? { contacted_at: now } : input.status === "enrolled" ? { enrolled_at: now } : ["closed", "not_interested"].includes(input.status) ? { closed_at: now } : {};
  const { data, error } = await db.from("premium_class_leads").update({ status: input.status, admin_notes: input.notes, assigned_to: adminId, updated_at: now, ...timestamps }).eq("id", id).select("id, status").maybeSingle();
  if (error || !data) throw new Error("Class lead not found.");
  return data;
}
