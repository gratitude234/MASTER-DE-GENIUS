"use server";

import { actionFail, actionOk, type AdminActionResult } from "@/features/admin/action-result";
import { authorizeAdmin } from "@/features/admin/auth";
import { adminErrorMessage, isKnownAdminError } from "@/features/admin/errors";
import { formatDateTime } from "@/features/admin/format";
import { inputErrorMessage, parseGrantInput, parseReason, parseUuid, type GrantInput } from "@/features/admin/validation";
import { createAdminClient } from "@/lib/supabase/admin";

/** Effectively permanent until an admin reactivates the account. */
const SUSPENSION_BAN_DURATION = "876000h";

function failure(context: string, error: unknown): AdminActionResult<never> {
  if (!isKnownAdminError(error)) console.error(`[admin] ${context} failed`, { code: (error as { code?: string })?.code ?? "unknown" });
  return actionFail(adminErrorMessage(error));
}

export async function grantMasterAccessAction(userId: string, input: GrantInput): Promise<AdminActionResult> {
  const authorization = await authorizeAdmin("entitlements.grant");
  if (!authorization.ok) return actionFail(authorization.error);

  let parsed: ReturnType<typeof parseGrantInput>;
  let studentId: string;
  try {
    studentId = parseUuid(userId, "student");
    parsed = parseGrantInput(input);
  } catch (error) {
    return actionFail(inputErrorMessage(error) ?? "Check the form and try again.");
  }

  const { data, error } = await createAdminClient().rpc("admin_grant_master_access", {
    p_actor_id: authorization.admin.userId,
    p_user_id: studentId,
    p_days: parsed.days,
    p_expires_at: parsed.expiresAt,
    p_reason: parsed.reason,
  });
  if (error) return failure("master grant", error);

  const expiry = (data as { new_expires_at?: string } | null)?.new_expires_at;
  return actionOk(`Master access now runs until ${formatDateTime(expiry)} (WAT).`);
}

/**
 * Suspension has two halves. The database record (audited) makes every page
 * refuse the account at once; the Supabase Auth ban stops it signing in or
 * refreshing a session. Both halves are idempotent, so repeating the action
 * after a partial failure completes it rather than erroring.
 */
export async function suspendStudentAction(userId: string, reason: string): Promise<AdminActionResult> {
  const authorization = await authorizeAdmin("students.manage");
  if (!authorization.ok) return actionFail(authorization.error);

  let studentId: string;
  let parsedReason: string;
  try {
    studentId = parseUuid(userId, "student");
    parsedReason = parseReason(reason) as string;
  } catch (error) {
    return actionFail(inputErrorMessage(error) ?? "Check the form and try again.");
  }

  const db = createAdminClient();
  const { error } = await db.rpc("admin_record_suspension", { p_actor_id: authorization.admin.userId, p_user_id: studentId, p_reason: parsedReason });
  if (error && error.message !== "ACCOUNT_ALREADY_SUSPENDED") return failure("suspension", error);

  const ban = await db.auth.admin.updateUserById(studentId, { ban_duration: SUSPENSION_BAN_DURATION });
  if (ban.error) {
    console.error("[admin] auth ban failed", { status: ban.error.status ?? "unknown" });
    return actionFail("The suspension is recorded and the app refuses this account, but the sign-in block could not be applied. Run Suspend again to finish.");
  }
  return actionOk(error ? "The account was already suspended. The sign-in block has been re-applied." : "Account suspended. The student can no longer use Master De Genius.");
}

export async function reactivateStudentAction(userId: string, reason: string): Promise<AdminActionResult> {
  const authorization = await authorizeAdmin("students.manage");
  if (!authorization.ok) return actionFail(authorization.error);

  let studentId: string;
  let parsedReason: string;
  try {
    studentId = parseUuid(userId, "student");
    parsedReason = parseReason(reason) as string;
  } catch (error) {
    return actionFail(inputErrorMessage(error) ?? "Check the form and try again.");
  }

  const db = createAdminClient();
  const { error } = await db.rpc("admin_clear_suspension", { p_actor_id: authorization.admin.userId, p_user_id: studentId, p_reason: parsedReason });
  if (error && error.message !== "ACCOUNT_NOT_SUSPENDED") return failure("reactivation", error);

  const unban = await db.auth.admin.updateUserById(studentId, { ban_duration: "none" });
  if (unban.error) {
    console.error("[admin] auth unban failed", { status: unban.error.status ?? "unknown" });
    return actionFail("The suspension is cleared, but the sign-in block could not be lifted. Run Reactivate again to finish.");
  }
  return actionOk("Account reactivated. The student can sign in again.");
}
