import Link from "next/link";
import { RequestPasswordResetForm } from "@/components/auth/password-reset-form";
import { typography } from "@/components/ui/variants";

export default function ForgotPasswordPage() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white px-7 py-8">
      <h1 className={typography.h1}>Reset your password</h1>
      <p className="mt-1.5 text-[13.5px] leading-[1.5] text-slate-600">We&apos;ll email you a secure reset link.</p>
      <div className="mt-6"><RequestPasswordResetForm /></div>
      <div className="mt-5 text-center text-xs"><Link href="/login" className="rounded font-bold text-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">Back to sign in</Link></div>
    </section>
  );
}
