import type { Metadata } from "next";
import { AdminNavigation } from "@/components/admin/admin-navigation";
import { requireAdmin } from "@/features/admin/auth";
import { ADMIN_NAV, ADMIN_ROLE_LABELS } from "@/features/admin/permissions";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Authorization is decided on the server from database roles. The layout
  // only shapes navigation; every page and action checks its own permission.
  const admin = await requireAdmin();
  const items = ADMIN_NAV.filter((item) => admin.permissions.has(item.permission)).map(({ href, label }) => ({ href, label }));

  return (
    <div className="min-h-dvh bg-slate-50">
      <AdminNavigation items={items} name={admin.displayName} email={admin.email} roleLabel={ADMIN_ROLE_LABELS[admin.role]} />
      <div className="lg:pl-[240px]">
        <main className="mx-auto w-full max-w-[1320px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">{children}</main>
      </div>
    </div>
  );
}
