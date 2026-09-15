import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { isAdminPermission, isAdminRole, type AdminPermission, type AdminRole } from "@/features/admin/permissions";
import { isAccountSuspended } from "@/lib/account-status";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Who the current administrator is and what they may do.
 *
 * Authorization is never inferred from an email address, a JWT claim or user
 * metadata — all of which the account holder can influence. It is read from
 * `app_admins` joined to `admin_role_permissions`, the same rows the database
 * functions check again before any privileged write.
 */
export interface AdminContext {
  userId: string;
  email: string | null;
  displayName: string;
  role: AdminRole;
  permissions: ReadonlySet<AdminPermission>;
}

interface Membership {
  role: AdminRole;
  permissions: AdminPermission[];
  displayName: string;
}

/** Fails closed: anything short of a clean, active membership is "not an admin". */
const loadMembership = cache(async (userId: string): Promise<Membership | null> => {
  try {
    const db = createAdminClient();
    const { data: membership, error } = await db
      .from("app_admins")
      .select("role, is_active")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error(`[admin] membership lookup failed: ${error.code ?? "unknown"}`);
      return null;
    }
    if (!membership?.is_active || !isAdminRole(membership.role)) return null;

    const [{ data: grants, error: grantError }, { data: profile }] = await Promise.all([
      db.from("admin_role_permissions").select("permission").eq("role", membership.role),
      db.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    ]);
    if (grantError) {
      console.error(`[admin] permission lookup failed: ${grantError.code ?? "unknown"}`);
      return null;
    }

    return {
      role: membership.role,
      permissions: (grants ?? []).map((grant) => grant.permission).filter(isAdminPermission),
      displayName: profile?.full_name?.trim() ?? "",
    };
  } catch {
    console.error("[admin] membership lookup failed");
    return null;
  }
});

function toContext(user: { id: string; email?: string | null }, membership: Membership): AdminContext {
  return {
    userId: user.id,
    email: user.email ?? null,
    displayName: membership.displayName || user.email?.split("@")[0] || "Admin",
    role: membership.role,
    permissions: new Set(membership.permissions),
  };
}

export function can(admin: Pick<AdminContext, "permissions">, permission: AdminPermission): boolean {
  return admin.permissions.has(permission);
}

/** For admin pages and layouts. Non-admins never learn the workspace exists. */
export const requireAdmin = cache(async (): Promise<AdminContext> => {
  const { user } = await requireUser();
  const membership = await loadMembership(user.id);
  if (!membership) redirect("/home");
  return toContext(user, membership);
});

/**
 * For a page that needs one permission. An admin without it is returned to the
 * overview with a notice rather than shown an error page for a link they
 * should not have been offered.
 */
export async function requireAdminPermission(permission: AdminPermission): Promise<AdminContext> {
  const admin = await requireAdmin();
  if (!can(admin, permission)) {
    redirect(permission === "overview.view" ? "/home" : "/admin?denied=1");
  }
  return admin;
}

export type AdminAuthorization =
  | { ok: true; admin: AdminContext }
  | { ok: false; status: 401 | 403; error: string };

/**
 * For server actions and route handlers, which must answer rather than
 * redirect. Every privileged operation calls this first, and the database
 * function it then calls checks the same permission a second time.
 */
export async function authorizeAdmin(permission: AdminPermission): Promise<AdminAuthorization> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: "Your session has ended. Sign in again." };
  if (await isAccountSuspended(user.id)) return { ok: false, status: 403, error: "This account is suspended." };

  const membership = await loadMembership(user.id);
  if (!membership) return { ok: false, status: 403, error: "Admin access is required." };

  const admin = toContext(user, membership);
  if (!can(admin, permission)) return { ok: false, status: 403, error: "Your role does not allow this action." };
  return { ok: true, admin };
}
