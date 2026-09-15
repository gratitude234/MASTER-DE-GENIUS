/**
 * The admin vocabulary shared by server guards and the admin UI.
 *
 * Which role holds which permission is deliberately NOT restated here: that
 * matrix lives in `admin_role_permissions` and is read per request, so the
 * database functions and the route guards can never disagree about it. This
 * module only names the permissions so that TypeScript can check every call
 * site, and a test keeps this list identical to the seeded one.
 */

export const ADMIN_ROLES = ["super_admin", "academic_admin", "support_admin", "classes_admin"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_PERMISSIONS = [
  "overview.view",
  "students.view",
  "students.manage",
  "entitlements.grant",
  "payments.view",
  "academics.view",
  "questions.view",
  "questions.manage",
  "sessions.view",
  "sessions.recover",
  "classes.view",
  "classes.manage",
  "support.view",
  "support.manage",
  "analytics.view",
  "system.view",
  "admins.manage",
  "audit.view",
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  academic_admin: "Academic Admin",
  support_admin: "Support Admin",
  classes_admin: "Classes / CRM Admin",
};

export const ADMIN_ROLE_SUMMARIES: Record<AdminRole, string> = {
  super_admin: "Full access, including payments, entitlements, roles, system and the audit log.",
  academic_admin: "Academic performance, question bank quality and session diagnosis.",
  support_admin: "Student lookup, session problems and support cases. No financial data.",
  classes_admin: "Premium Class leads: assignment, contact, notes and enrolment.",
};

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);
}

export function isAdminPermission(value: unknown): value is AdminPermission {
  return typeof value === "string" && (ADMIN_PERMISSIONS as readonly string[]).includes(value);
}

export interface AdminNavItem {
  href: string;
  label: string;
  permission: AdminPermission;
}

/** Sidebar order. An item renders only for admins holding its permission. */
export const ADMIN_NAV: readonly AdminNavItem[] = [
  { href: "/admin", label: "Overview", permission: "overview.view" },
  { href: "/admin/students", label: "Students", permission: "students.view" },
  { href: "/admin/academics", label: "Academics", permission: "academics.view" },
  { href: "/admin/questions", label: "Questions", permission: "questions.view" },
  { href: "/admin/exams", label: "Exams & Sessions", permission: "sessions.view" },
  { href: "/admin/classes", label: "Master Classes", permission: "classes.view" },
  { href: "/admin/payments", label: "Payments", permission: "payments.view" },
  { href: "/admin/support", label: "Support", permission: "support.view" },
  { href: "/admin/analytics", label: "Analytics", permission: "analytics.view" },
  { href: "/admin/system", label: "System", permission: "system.view" },
  { href: "/admin/admins", label: "Admin & Roles", permission: "admins.manage" },
  { href: "/admin/audit-log", label: "Audit Log", permission: "audit.view" },
];

/** The nav entry that owns a pathname: the longest matching prefix wins. */
export function activeAdminHref(pathname: string, hrefs: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const href of hrefs) {
    const matches = href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
    if (matches && (!best || href.length > best.length)) best = href;
  }
  return best;
}
