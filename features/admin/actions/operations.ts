"use server";

import { actionFail, actionOk, type AdminActionResult } from "@/features/admin/action-result";
import { authorizeAdmin } from "@/features/admin/auth";
import { adminErrorMessage, isKnownAdminError } from "@/features/admin/errors";
import {
  inputErrorMessage,
  parseBlockInput,
  parseMembershipEmail,
  parseNote,
  parseOptionalUuid,
  parseQuestionInput,
  parseReason,
  parseRole,
  parseUuid,
  type BlockInput,
  type QuestionInput,
} from "@/features/admin/validation";
import { SUPPORT_CATEGORIES, SUPPORT_CHANNELS, SUPPORT_STATUSES } from "@/features/admin/support";
import { updateAdminLead } from "@/features/classes/service";
import { CLASS_LEAD_STATUSES, type ClassLeadStatus } from "@/features/classes/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

/*
 * Every action follows the same order: authorize (session, membership,
 * permission), validate, then call the database function that re-checks the
 * permission and writes the audit row. Nothing is written from here directly.
 */

function failure(context: string, error: unknown): AdminActionResult<never> {
  if (!isKnownAdminError(error)) console.error(`[admin] ${context} failed`, { code: (error as { code?: string })?.code ?? "unknown" });
  return actionFail(adminErrorMessage(error));
}

function invalid(error: unknown): AdminActionResult<never> {
  return actionFail(inputErrorMessage(error) ?? "Check the form and try again.");
}

// ─────────────────────────────────────────────────────────── class leads

const LEAD_STATUSES = new Set<string>(CLASS_LEAD_STATUSES);

export async function updateLeadAction(
  leadId: string,
  input: { status?: string; assignedTo?: string | null; note?: string },
): Promise<AdminActionResult> {
  const authorization = await authorizeAdmin("classes.manage");
  if (!authorization.ok) return actionFail(authorization.error);

  let id: string;
  let note: string | null;
  let assignedTo: string | null | undefined;
  try {
    id = parseUuid(leadId, "lead");
    note = parseNote(input.note);
    assignedTo = input.assignedTo === undefined ? undefined : parseOptionalUuid(input.assignedTo, "admin");
    if (input.status !== undefined && !LEAD_STATUSES.has(input.status)) return actionFail("Choose a valid status.");
  } catch (error) {
    return invalid(error);
  }

  try {
    await updateAdminLead(authorization.admin.userId, id, { status: input.status as ClassLeadStatus | undefined, assignedTo, note });
  } catch (error) {
    return failure("lead update", error);
  }
  return actionOk("Lead updated.");
}

// ─────────────────────────────────────────────────────────── questions

export async function saveQuestionAction(questionId: string | null, input: QuestionInput): Promise<AdminActionResult<{ id: string }>> {
  const authorization = await authorizeAdmin("questions.manage");
  if (!authorization.ok) return actionFail(authorization.error);

  let parsed: ReturnType<typeof parseQuestionInput>;
  let id: string | null;
  try {
    id = parseOptionalUuid(questionId, "question");
    parsed = parseQuestionInput(input);
  } catch (error) {
    return invalid(error);
  }

  const { data, error } = await createAdminClient().rpc("admin_save_internal_question", {
    p_actor_id: authorization.admin.userId,
    p_question_id: id,
    p_payload: parsed.payload as unknown as Json,
    p_reason: parsed.reason,
  });
  if (error || !data) return failure("question save", error);
  return actionOk(id ? "Question saved." : "Question created.", { id: data });
}

const QUESTION_STATUS_SET = new Set(["draft", "pending_review", "active", "flagged", "disabled"]);

export async function setQuestionStatusAction(questionId: string, status: string, reason: string): Promise<AdminActionResult> {
  const authorization = await authorizeAdmin("questions.manage");
  if (!authorization.ok) return actionFail(authorization.error);
  if (!QUESTION_STATUS_SET.has(status)) return actionFail("Choose a valid status.");

  let id: string;
  let parsedReason: string | null;
  try {
    id = parseUuid(questionId, "question");
    parsedReason = parseReason(reason, { required: false });
  } catch (error) {
    return invalid(error);
  }

  const { error } = await createAdminClient().rpc("admin_set_question_status", {
    p_actor_id: authorization.admin.userId,
    p_question_id: id,
    p_status: status as "draft" | "pending_review" | "active" | "flagged" | "disabled",
    p_reason: parsedReason,
  });
  if (error) return failure("question status", error);
  return actionOk("Question status updated.");
}

export async function blockQuestionAction(key: Omit<BlockInput, "reason">, reason: string): Promise<AdminActionResult> {
  const authorization = await authorizeAdmin("questions.manage");
  if (!authorization.ok) return actionFail(authorization.error);

  let parsed: ReturnType<typeof parseBlockInput>;
  try {
    parsed = parseBlockInput({ ...key, reason });
  } catch (error) {
    return invalid(error);
  }

  const { error } = await createAdminClient().rpc("admin_block_question", {
    p_actor_id: authorization.admin.userId,
    p_source_provider: parsed.provider,
    p_exam_code: parsed.exam,
    p_subject_slug: parsed.subject,
    p_source_question_id: parsed.sourceQuestionId,
    p_reason: parsed.reason,
  });
  if (error) return failure("question block", error);
  return actionOk("Question blocked. It will not appear in new practice or mock sessions.");
}

export async function liftQuestionBlockAction(blockId: string, reason: string): Promise<AdminActionResult> {
  const authorization = await authorizeAdmin("questions.manage");
  if (!authorization.ok) return actionFail(authorization.error);

  let id: string;
  let parsedReason: string;
  try {
    id = parseUuid(blockId, "block");
    parsedReason = parseReason(reason) as string;
  } catch (error) {
    return invalid(error);
  }

  const { error } = await createAdminClient().rpc("admin_lift_question_block", { p_actor_id: authorization.admin.userId, p_block_id: id, p_reason: parsedReason });
  if (error) return failure("question unblock", error);
  return actionOk("Block lifted. The question can be served again.");
}

// ─────────────────────────────────────────────────────────── sessions

export async function finalizeOverdueSessionAction(kind: string, sessionId: string, reason: string): Promise<AdminActionResult> {
  const authorization = await authorizeAdmin("sessions.recover");
  if (!authorization.ok) return actionFail(authorization.error);
  if (kind !== "exam" && kind !== "practice") return actionFail("Unknown session type.");

  let id: string;
  let parsedReason: string;
  try {
    id = parseUuid(sessionId, "session");
    parsedReason = parseReason(reason) as string;
  } catch (error) {
    return invalid(error);
  }

  const { error } = await createAdminClient().rpc("admin_finalize_overdue_session", {
    p_actor_id: authorization.admin.userId, p_kind: kind, p_session_id: id, p_reason: parsedReason,
  });
  if (error) return failure("session finalise", error);
  return actionOk("Session finalised with the answers the server already held. The result is now available to the student.");
}

// ─────────────────────────────────────────────────────────── support

export async function createSupportCaseAction(input: {
  userId?: string | null;
  category: string;
  channel: string;
  subject: string;
  message?: string;
  assignedTo?: string | null;
}): Promise<AdminActionResult<{ id: string }>> {
  const authorization = await authorizeAdmin("support.manage");
  if (!authorization.ok) return actionFail(authorization.error);

  if (!(SUPPORT_CATEGORIES as readonly string[]).includes(input.category)) return actionFail("Choose a category.");
  if (!(SUPPORT_CHANNELS as readonly string[]).includes(input.channel)) return actionFail("Choose how the student reached us.");
  const subject = input.subject?.trim() ?? "";
  if (subject.length < 3 || subject.length > 160) return actionFail("Summarise the problem in 3 to 160 characters.");

  let userId: string | null;
  let assignedTo: string | null;
  let message: string | null;
  try {
    userId = parseOptionalUuid(input.userId, "student");
    assignedTo = parseOptionalUuid(input.assignedTo, "admin");
    message = parseNote(input.message);
    if (message && message.length > 3000) return actionFail("Keep the details under 3,000 characters.");
  } catch (error) {
    return invalid(error);
  }

  const { data, error } = await createAdminClient().rpc("admin_create_support_case", {
    p_actor_id: authorization.admin.userId,
    p_user_id: userId,
    p_category: input.category,
    p_channel: input.channel,
    p_subject: subject,
    p_message: message,
    p_assigned_to: assignedTo,
  });
  if (error || !data) return failure("support case create", error);
  return actionOk("Support case opened.", { id: data });
}

export async function updateSupportCaseAction(
  caseId: string,
  input: { status?: string; assignedTo?: string | null; note?: string },
): Promise<AdminActionResult> {
  const authorization = await authorizeAdmin("support.manage");
  if (!authorization.ok) return actionFail(authorization.error);
  if (input.status !== undefined && !(SUPPORT_STATUSES as readonly string[]).includes(input.status)) return actionFail("Choose a valid status.");

  let id: string;
  let note: string | null;
  let assignedTo: string | null | undefined;
  try {
    id = parseUuid(caseId, "support case");
    note = parseNote(input.note);
    assignedTo = input.assignedTo === undefined ? undefined : parseOptionalUuid(input.assignedTo, "admin");
  } catch (error) {
    return invalid(error);
  }

  const { error } = await createAdminClient().rpc("admin_update_support_case", {
    p_actor_id: authorization.admin.userId,
    p_case_id: id,
    p_status: input.status ?? null,
    p_update_assignment: assignedTo !== undefined,
    p_assigned_to: assignedTo ?? null,
    p_note: note,
  });
  if (error) return failure("support case update", error);
  return actionOk("Support case updated.");
}

// ─────────────────────────────────────────────────────────── admins

export async function grantMembershipAction(email: string, role: string, reason: string): Promise<AdminActionResult> {
  const authorization = await authorizeAdmin("admins.manage");
  if (!authorization.ok) return actionFail(authorization.error);

  let parsed: { email: string; role: ReturnType<typeof parseRole>; reason: string };
  try {
    parsed = { email: parseMembershipEmail(email), role: parseRole(role), reason: parseReason(reason) as string };
  } catch (error) {
    return invalid(error);
  }

  const { error } = await createAdminClient().rpc("admin_grant_membership", {
    p_actor_id: authorization.admin.userId, p_email: parsed.email, p_role: parsed.role, p_reason: parsed.reason,
  });
  if (error) return failure("membership grant", error);
  return actionOk(`${parsed.email} now has admin access.`);
}

export async function updateMembershipAction(
  userId: string,
  change: { role?: string; isActive?: boolean },
  reason: string,
): Promise<AdminActionResult> {
  const authorization = await authorizeAdmin("admins.manage");
  if (!authorization.ok) return actionFail(authorization.error);

  let id: string;
  let role: ReturnType<typeof parseRole> | null;
  let parsedReason: string;
  try {
    id = parseUuid(userId, "admin");
    role = change.role === undefined ? null : parseRole(change.role);
    parsedReason = parseReason(reason) as string;
  } catch (error) {
    return invalid(error);
  }
  if (id === authorization.admin.userId) return actionFail("You cannot change your own access. Ask another super admin.");

  const { error } = await createAdminClient().rpc("admin_update_membership", {
    p_actor_id: authorization.admin.userId,
    p_user_id: id,
    p_role: role,
    p_is_active: typeof change.isActive === "boolean" ? change.isActive : null,
    p_reason: parsedReason,
  });
  if (error) return failure("membership update", error);
  return actionOk("Admin access updated.");
}
