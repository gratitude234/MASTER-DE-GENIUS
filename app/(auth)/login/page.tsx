import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; password?: string }> }) {
  const params = await searchParams;
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-black tracking-[-0.035em] text-slate-950">Welcome back</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">Continue your MASTER@DE&apos;GENIUS preparation.</p>
      {params.password === "updated" ? <div className="mt-5 rounded-xl bg-emerald-50 px-3.5 py-3 text-sm font-semibold text-emerald-700">Password updated. Sign in with your new password.</div> : null}
      <div className="mt-6"><LoginForm nextPath={params.next} /></div>
      <div className="mt-5 text-center text-xs text-slate-400">New here? <Link href="/signup" className="font-bold text-brand-500">Create account</Link></div>
    </section>
  );
}
