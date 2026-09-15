import { AdminPageHeader, DataTable, Panel, cell } from "@/components/admin/admin-ui";
import { GrantMembershipDialog, MembershipRowControls } from "@/components/admin/membership-controls";
import { Badge } from "@/components/ui/badge";
import { listAdmins, loadRolePermissions } from "@/features/admin/admins";
import { requireAdminPermission } from "@/features/admin/auth";
import { formatDate, formatDateTime } from "@/features/admin/format";
import { ADMIN_PERMISSIONS, ADMIN_ROLES, ADMIN_ROLE_LABELS } from "@/features/admin/permissions";

export const dynamic = "force-dynamic";

export default async function AdminAdminsPage() {
  const admin = await requireAdminPermission("admins.manage");
  const [admins, matrix] = await Promise.all([listAdmins(admin.userId), loadRolePermissions()]);
  const activeSuperAdmins = admins.filter((row) => row.is_active && row.role === "super_admin").length;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Admin & Roles"
        description="Who can operate Master De Genius, and what each role allows. Every change needs a reason and is written to the audit log."
        actions={<GrantMembershipDialog />}
      />

      <DataTable label="Administrators" minWidth={940}>
        <thead>
          <tr>
            <th scope="col" className={cell.th}>Administrator</th>
            <th scope="col" className={cell.th}>Role</th>
            <th scope="col" className={cell.th}>Status</th>
            <th scope="col" className={cell.th}>Access granted</th>
            <th scope="col" className={cell.th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {admins.map((row) => {
            const isSelf = row.user_id === admin.userId;
            const lastSuper = row.is_active && row.role === "super_admin" && activeSuperAdmins === 1;
            return (
              <tr key={row.user_id}>
                <td className={cell.td}>
                  <span className="font-semibold text-slate-950">{row.full_name.trim() || row.email || "Unknown account"}</span>{isSelf ? <Badge tone="brand" className="ml-2">You</Badge> : null}
                  <div className="text-[11.5px] text-slate-500">{row.email ?? "No email"}</div>
                </td>
                <td className={cell.td}>{ADMIN_ROLE_LABELS[row.role]}</td>
                <td className={cell.td}>
                  {row.is_active ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral" dot>Deactivated</Badge>}
                  {row.deactivated_at ? <div className="mt-1 text-[11px] text-slate-500">{formatDate(row.deactivated_at)}</div> : null}
                </td>
                <td className={`${cell.td} text-[11.5px]`}>{formatDateTime(row.created_at)}<div className="text-slate-500">{row.granted_by_email ? `by ${row.granted_by_email}` : "Before roles, or from the database console"}</div></td>
                <td className={cell.td}>
                  {isSelf ? (
                    <span className="text-[11.5px] text-slate-500">Another super admin must change your access.</span>
                  ) : lastSuper ? (
                    <span className="text-[11.5px] text-slate-500">The only active super admin. Add another before changing this one.</span>
                  ) : (
                    <MembershipRowControls userId={row.user_id} email={row.email ?? "this admin"} role={row.role} isActive={row.is_active} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>

      <Panel title="What each role can do" description="Read live from the permission table the database enforces." bodyClassName="p-0">
        <DataTable label="Role permissions" minWidth={720}>
          <thead>
            <tr>
              <th scope="col" className={cell.th}>Permission</th>
              {ADMIN_ROLES.map((role) => <th key={role} scope="col" className={`${cell.th} text-center`}>{ADMIN_ROLE_LABELS[role]}</th>)}
            </tr>
          </thead>
          <tbody>
            {ADMIN_PERMISSIONS.map((permission) => (
              <tr key={permission}>
                <td className={`${cell.td} mono-number text-[11.5px]`}>{permission}</td>
                {ADMIN_ROLES.map((role) => (
                  <td key={role} className={`${cell.td} text-center`}>
                    {matrix[role].includes(permission) ? <span aria-label="Allowed" className="font-bold text-success-700">✓</span> : <span aria-label="Not allowed" className="text-slate-300">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Panel>
    </div>
  );
}
