import Link from "next/link";
import { RequestPasswordResetForm } from "@/components/auth/password-reset-form";

export default function ForgotPasswordPage() {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-black tracking-[-0.035em] text-slate-950">Reset your password</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">We&apos;ll email you a secure reset link.</p>
      <div className="mt-6"><RequestPasswordResetForm /></div>
      <div className="mt-5 text-center text-xs"><Link href="/login" className="font-bold text-brand-500">Back to sign in</Link></div>
    </section>
  );
}
