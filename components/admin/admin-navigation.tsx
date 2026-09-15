"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  BookOpenCheck,
  ClipboardList,
  CreditCard,
  FileQuestion,
  GraduationCap,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  ScrollText,
  ServerCog,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { activeAdminHref } from "@/features/admin/permissions";
import { signOutAction } from "@/features/auth/actions";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  "/admin": LayoutDashboard,
  "/admin/students": Users,
  "/admin/academics": GraduationCap,
  "/admin/questions": FileQuestion,
  "/admin/exams": ClipboardList,
  "/admin/classes": BookOpenCheck,
  "/admin/payments": CreditCard,
  "/admin/support": LifeBuoy,
  "/admin/analytics": BarChart3,
  "/admin/system": ServerCog,
  "/admin/admins": ShieldCheck,
  "/admin/audit-log": ScrollText,
};

export interface AdminNavigationProps {
  items: { href: string; label: string }[];
  name: string;
  email: string | null;
  roleLabel: string;
}

function NavLinks({ items, active }: { items: AdminNavigationProps["items"]; active: string | undefined }) {
  return (
    <ul className="space-y-0.5">
      {items.map(({ href, label }) => {
        const Icon = ICONS[href] ?? LayoutDashboard;
        const current = href === active;
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex min-h-[38px] items-center gap-[11px] rounded-lg px-2.5 text-[13px] font-semibold transition-colors motion-reduce:transition-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
                current ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white",
              )}
            >
              <Icon aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.9} />
              <span>{label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Identity({ name, email, roleLabel }: Omit<AdminNavigationProps, "items">) {
  return (
    <div className="border-t border-white/[0.08] px-4 py-4">
      <p className="truncate text-[12.5px] font-bold text-white">{name}</p>
      {email ? <p className="mt-0.5 truncate text-[11px] text-white/50">{email}</p> : null}
      <p className="mt-2 inline-flex rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-brand-200">{roleLabel}</p>
      <form action={signOutAction} className="mt-3">
        <button
          type="submit"
          className="inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-[12px] font-semibold text-white/70 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          Sign out
        </button>
      </form>
    </div>
  );
}

/**
 * The admin rail: a fixed ink sidebar on desktop, and on smaller screens a
 * compact top bar that opens the same links in a drawer. The drawer is a native
 * modal <dialog>, so focus trapping, Escape and restoring focus come from the
 * platform.
 */
export function AdminNavigation({ items, name, email, roleLabel }: AdminNavigationProps) {
  const pathname = usePathname();
  const active = activeAdminHref(pathname, items.map((item) => item.href));
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const currentLabel = items.find((item) => item.href === active)?.label ?? "Admin";

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[240px] flex-col bg-slate-950 text-white lg:flex">
        <div className="px-5 pb-5 pt-6">
          <BrandMark inverse sublabel={false} />
          <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">Admin workspace</p>
        </div>
        <nav aria-label="Admin" className="flex-1 overflow-y-auto px-3 pb-4">
          <NavLinks items={items} active={active} />
        </nav>
        <Identity name={name} email={email} roleLabel={roleLabel} />
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 lg:hidden">
        <div className="flex min-w-0 items-center gap-2.5">
          <BrandMark compact />
          <span className="truncate text-[13px] font-bold text-slate-950">{currentLabel}</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open admin menu"
          aria-expanded={open}
          className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <dialog
        ref={dialogRef}
        aria-label="Admin menu"
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialogRef.current) setOpen(false);
        }}
        className="m-0 h-dvh max-h-dvh w-[280px] max-w-[85vw] bg-slate-950 p-0 text-white backdrop:bg-slate-950/60"
      >
        {open ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between px-5 pb-4 pt-5">
              <BrandMark inverse sublabel={false} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close admin menu"
                className="grid h-9 w-9 place-items-center rounded-lg text-white/70 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="Admin" className="flex-1 overflow-y-auto px-3 pb-4">
              <NavLinks items={items} active={active} />
            </nav>
            <Identity name={name} email={email} roleLabel={roleLabel} />
          </div>
        ) : null}
      </dialog>
    </>
  );
}
