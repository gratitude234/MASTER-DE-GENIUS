import Link from "next/link";
import { MailCheck } from "lucide-react";

export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ email?: string; mode?: string }> }) {
  const { email, mode } = await searchParams;
  const reset = mode === "reset";
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-sm sm:p-9">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-500/10 text-brand-500"><MailCheck className="h-6 w-6" /></div>
      <h1 className="mt-5 text-2xl font-black tracking-[-0.035em] text-slate-950">Check your email</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        {reset ? "We sent a password reset link" : "We sent a confirmation link"}{email ? <> to <strong className="text-slate-700">{email}</strong></> : null}.
      </p>
      <Link href="/login" className="mt-7 inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 px-5 text-sm font-bold text-slate-700">Back to sign in</Link>
    </section>
  );
}
