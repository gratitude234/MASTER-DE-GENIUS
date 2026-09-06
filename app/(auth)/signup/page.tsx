import Link from "next/link";
import { SignupForm } from "@/components/auth/signup-form";

export default function SignupPage() {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-2xl font-black tracking-[-0.035em] text-slate-950">Create your account</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">Set up your preparation profile, subjects and JAMB target.</p>
      <div className="mt-6"><SignupForm /></div>
      <div className="mt-5 text-center text-xs text-slate-400">Already registered? <Link href="/login" className="font-bold text-brand-500">Sign in</Link></div>
    </section>
  );
}
