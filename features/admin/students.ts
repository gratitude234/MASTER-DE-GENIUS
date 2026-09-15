import "server-only";

import { can, type AdminContext } from "@/features/admin/auth";
import { loadDirectory, displayName } from "@/features/admin/directory";
import { summariseStudentAcademics, type StudentAcademicSnapshot } from "@/features/admin/student-academics";
import { getEntitlement, type Entitlement } from "@/features/billing/entitlements";
import { findPlan } from "@/features/billing/plans";
import { loadHistory } from "@/features/results/service";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

export const STUDENT_PAGE_SIZE = 25;
export const STUDENT_PLAN_FILTERS = ["free", "master", "lapsed"] as const;
export const STUDENT_ACTIVITY_FILTERS = ["active_7d", "active_30d", "inactive_30d", "never"] as const;
export const STUDENT_SORTS = ["joined_desc", "joined_asc", "active_desc", "name_asc"] as const;

export interface StudentFilters {
  search?: string;
  exam?: "jamb" | "waec";
  plan?: (typeof STUDENT_PLAN_FILTERS)[number];
  activity?: (typeof STUDENT_ACTIVITY_FILTERS)[number];
  sort?: (typeof STUDENT_SORTS)[number];
}

export type StudentRow = Database["public"]["Functions"]["admin_list_students"]["Returns"][number];

export async function listStudents(actorId: string, filters: StudentFilters, page: number) {
  const { data, error } = await createAdminClient().rpc("admin_list_students", {
    p_actor_id: actorId,
    p_search: filters.search ?? null,
    p_exam: filters.exam ?? null,
    p_plan: filters.plan ?? null,
    p_activity: filters.activity ?? null,
    p_sort: filters.sort ?? "joined_desc",
    p_limit: STUDENT_PAGE_SIZE,
    p_offset: (page - 1) * STUDENT_PAGE_SIZE,
  });
  if (error) throw new Error("Could not load students.");
  const rows = data ?? [];
  const total = Number(rows[0]?.total_count ?? 0);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / STUDENT_PAGE_SIZE)) };
}

export interface EntitlementEventRow {
  id: number;
  eventType: string;
  source: "payment" | "admin";
  actor: string | null;
  reason: string | null;
  previousExpiresAt: string | null;
  newExpiresAt: string | null;
  planName: string | null;
  createdAt: string;
}

export interface StudentDetail {
  identity: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    joinedAt: string;
    lastSignInAt: string | null;
    onboardingCompleted: boolean;
  };
  preparation: {
    examCode: string;
    examName: string;
    examYear: number;
    targetScore: number | null;
    intendedCourse: string | null;
    studyIntensity: string;
    subjects: string[];
  } | null;
  entitlement: Entitlement;
  entitlementActivatedAt: string | null;
  entitlementEvents: EntitlementEventRow[];
  suspension: { reason: string; suspendedAt: string; suspendedBy: string } | null;
  academics: StudentAcademicSnapshot | null;
  academicsError: string | null;
  payments: Database["public"]["Tables"]["payment_transactions"]["Row"][] | null;
  leads: Pick<Database["public"]["Tables"]["premium_class_leads"]["Row"], "id" | "exam_type" | "subject_name" | "topic" | "class_type" | "status" | "created_at" | "phone">[] | null;
  supportCases: Pick<Database["public"]["Tables"]["support_cases"]["Row"], "id" | "category" | "subject" | "status" | "created_at">[] | null;
}

/**
 * One student, assembled from the systems that already own each part. The
 * plan comes from the billing authority the product enforces, and learning
 * figures from the same graded history the student's Progress page reads.
 * Sections the admin's role does not cover are returned as null, not loaded.
 */
export async function loadStudentDetail(admin: AdminContext, userId: string): Promise<StudentDetail | null> {
  const db = createAdminClient();
  const [{ data: auth, error: authError }, { data: profile, error: profileError }] = await Promise.all([
    db.auth.admin.getUserById(userId),
    db.from("profiles").select("id, full_name, onboarding_completed, created_at").eq("id", userId).maybeSingle(),
  ]);
  if (profileError) throw new Error("Could not load the student.");
  if (!profile || authError || !auth?.user) return null;

  const [preferenceResult, entitlement, entitlementRow, eventsResult, suspensionResult] = await Promise.all([
    db.from("student_exam_preferences")
      .select("id, exam_body_id, exam_year, target_score, intended_course, study_intensity")
      .eq("user_id", userId).eq("is_primary", true).maybeSingle(),
    getEntitlement(userId),
    db.from("user_entitlements").select("activated_at").eq("user_id", userId).maybeSingle(),
    db.from("entitlement_events")
      .select("id, event_type, source, actor_id, reason, previous_expires_at, new_expires_at, plan_slug, created_at")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
    db.from("account_suspensions").select("reason, suspended_at, suspended_by").eq("user_id", userId).maybeSingle(),
  ]);
  if (preferenceResult.error || eventsResult.error || suspensionResult.error) throw new Error("Could not load the student.");

  let preparation: StudentDetail["preparation"] = null;
  const preference = preferenceResult.data;
  if (preference) {
    const [{ data: exam }, { data: links }] = await Promise.all([
      db.from("exam_bodies").select("code, short_name").eq("id", preference.exam_body_id).maybeSingle(),
      db.from("student_subject_preferences").select("subject_id, display_order").eq("preference_id", preference.id).order("display_order"),
    ]);
    const subjectIds = (links ?? []).map((link) => link.subject_id);
    const { data: subjects } = subjectIds.length
      ? await db.from("subjects").select("id, name").in("id", subjectIds)
      : { data: [] as { id: string; name: string }[] };
    const names = new Map((subjects ?? []).map((subject) => [subject.id, subject.name]));
    preparation = {
      examCode: exam?.code ?? "",
      examName: exam?.short_name ?? "Unknown exam",
      examYear: preference.exam_year,
      targetScore: preference.target_score,
      intendedCourse: preference.intended_course,
      studyIntensity: preference.study_intensity,
      subjects: subjectIds.map((id) => names.get(id)).filter((name): name is string => Boolean(name)),
    };
  }

  let academics: StudentAcademicSnapshot | null = null;
  let academicsError: string | null = null;
  try {
    academics = summariseStudentAcademics(await loadHistory(userId), preference?.exam_body_id);
  } catch {
    academicsError = "Learning history could not be loaded right now.";
  }

  const [payments, leads, supportCases] = await Promise.all([
    can(admin, "payments.view")
      ? db.from("payment_transactions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(25)
        .then(({ data, error }) => { if (error) throw new Error("Could not load payments."); return data ?? []; })
      : Promise.resolve(null),
    can(admin, "classes.view")
      ? db.from("premium_class_leads").select("id, exam_type, subject_name, topic, class_type, status, created_at, phone").eq("user_id", userId).order("created_at", { ascending: false }).limit(10)
        .then(({ data, error }) => { if (error) throw new Error("Could not load class requests."); return data ?? []; })
      : Promise.resolve(null),
    can(admin, "support.view")
      ? db.from("support_cases").select("id, category, subject, status, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(10)
        .then(({ data, error }) => { if (error) throw new Error("Could not load support cases."); return data ?? []; })
      : Promise.resolve(null),
  ]);

  const events = eventsResult.data ?? [];
  const suspension = suspensionResult.data;
  const directory = await loadDirectory(admin.userId, [...events.map((event) => event.actor_id), suspension?.suspended_by]);

  return {
    identity: {
      id: userId,
      fullName: profile.full_name,
      email: auth.user.email ?? null,
      phone: auth.user.phone || null,
      joinedAt: profile.created_at,
      lastSignInAt: auth.user.last_sign_in_at ?? null,
      onboardingCompleted: profile.onboarding_completed,
    },
    preparation,
    entitlement,
    entitlementActivatedAt: entitlementRow.data?.activated_at ?? null,
    entitlementEvents: events.map((event) => ({
      id: event.id,
      eventType: event.event_type,
      source: event.source,
      actor: event.actor_id ? displayName(directory.get(event.actor_id), "Former admin") : null,
      reason: event.reason,
      previousExpiresAt: event.previous_expires_at,
      newExpiresAt: event.new_expires_at,
      planName: findPlan(event.plan_slug)?.name ?? null,
      createdAt: event.created_at,
    })),
    suspension: suspension
      ? {
          reason: suspension.reason,
          suspendedAt: suspension.suspended_at,
          suspendedBy: suspension.suspended_by ? displayName(directory.get(suspension.suspended_by), "Former admin") : "Unknown",
        }
      : null,
    academics,
    academicsError,
    payments,
    leads,
    supportCases,
  };
}
