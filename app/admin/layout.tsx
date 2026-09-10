import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";
import { requireAdmin } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <div className="min-h-dvh bg-slate-50"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6"><BrandMark /><nav aria-label="Admin"><Link href="/admin/classes" className="text-xs font-bold text-brand-500">Premium Classes CRM</Link></nav></div></header><main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-9">{children}</main></div>;
}
