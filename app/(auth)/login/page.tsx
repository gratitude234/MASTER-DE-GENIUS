import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { InlineAlert } from "@/components/ui/inline-alert";
import { typography } from "@/components/ui/variants";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; password?: string }> }) {
  const params = await searchParams;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white px-7 py-8">
      <h1 className={typography.h1}>Welcome back</h1>
      <p className="mt-1.5 text-[13.5px] leading-[1.5] text-slate-600">Sign in to continue your exam preparation.</p>
      {params.password === "updated" ? (
        <div className="mt-5"><InlineAlert tone="success">Password updated. Sign in with your new password.</InlineAlert></div>
      ) : null}
      <div className="mt-6"><LoginForm nextPath={params.next} /></div>
      <div className="mt-5 text-center text-xs text-slate-500">New here? <Link href="/signup" className="rounded font-bold text-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">Create account</Link></div>
    </section>
  );
}
