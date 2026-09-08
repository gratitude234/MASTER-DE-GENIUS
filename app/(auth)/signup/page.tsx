import Link from "next/link";
import { SignupForm } from "@/components/auth/signup-form";
import { typography } from "@/components/ui/variants";

export default function SignupPage() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white px-7 py-8">
      <h1 className={typography.h1}>Create your account</h1>
      <p className="mt-1.5 text-[13.5px] leading-[1.5] text-slate-600">Set up your examination, subjects and preparation goal.</p>
      <div className="mt-6"><SignupForm /></div>
      <div className="mt-5 text-center text-xs text-slate-500">Already registered? <Link href="/login" className="rounded font-bold text-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">Sign in</Link></div>
    </section>
  );
}
