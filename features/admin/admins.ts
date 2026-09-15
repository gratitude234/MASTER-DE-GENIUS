import "server-only";

import { ADMIN_ROLES, isAdminPermission, type AdminPermission, type AdminRole } from "@/features/admin/permissions";
import { createAdminClient } from "@/lib/supabase/admin";

export async function listAdmins(actorId: string) {
  const { data, error } = await createAdminClient().rpc("admin_list_admins", { p_actor_id: actorId });
  if (error) throw new Error("Could not load administrators.");
  return data ?? [];
}

/** The live permission matrix, read from the table the database enforces. */
export async function loadRolePermissions(): Promise<Record<AdminRole, AdminPermission[]>> {
  const { data, error } = await createAdminClient().from("admin_role_permissions").select("role, permission").order("permission");
  if (error) throw new Error("Could not load role permissions.");
  const matrix = Object.fromEntries(ADMIN_ROLES.map((role) => [role, [] as AdminPermission[]])) as Record<AdminRole, AdminPermission[]>;
  for (const row of data ?? []) {
    if (isAdminPermission(row.permission)) matrix[row.role].push(row.permission);
  }
  return matrix;
}
