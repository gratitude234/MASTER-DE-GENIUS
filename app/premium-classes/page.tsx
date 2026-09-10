import Link from "next/link";
import { BookOpenCheck, CheckCircle2, UsersRound } from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { SupportHub } from "@/components/support/support-hub";
import { buttonClasses, typography } from "@/components/ui/variants";
import { Suspense } from "react";

export const metadata = { title: "Premium Classes", description: "JAMB and WAEC tutoring from Master De Genius." };

export default function PremiumClassesPage() {
  return <main className="min-h-dvh bg-slate-50 pb-24">
    <Suspense fallback={null}><SupportHub authenticated={false} hasStudentNav={false} /></Suspense>
    <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-6" aria-label="Public navigation"><BrandMark /><div className="flex gap-2"><Link href="/login" className={buttonClasses({ variant: "ghost", size: "sm" })}>Sign in</Link><Link href="/signup" className={buttonClasses({ variant: "dark", size: "sm" })}>Create account</Link></div></nav>
    <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16"><div className="rounded-3xl bg-slate-950 px-6 py-12 text-white sm:px-12 sm:py-16"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand-200">Master De Genius Premium Classes</p><h1 className="mt-3 max-w-3xl font-serif text-4xl font-semibold tracking-tight sm:text-6xl">Need more than practice?</h1><p className="mt-4 max-w-2xl text-sm leading-7 text-white/65">Learn directly from experienced tutors through JAMB and WAEC topic clinics, private lessons, group classes and bootcamps.</p><div className="mt-7 flex flex-wrap gap-3"><Link href="/signup" className={buttonClasses({ variant: "primary", size: "lg" })}>Create account to request a class</Link><Link href="/login?next=/classes" className={buttonClasses({ variant: "secondary", size: "lg", className: "border-white/20 bg-white text-slate-950" })}>I already have an account</Link></div></div>
      <div className="mt-8 grid gap-3 sm:grid-cols-3">{[[UsersRound,"Group Classes","Structured learning with other students."],[CheckCircle2,"Private Lessons","Personal attention for your specific needs."],[BookOpenCheck,"Topic Clinics","Focused help with the exact topic holding you back."]].map(([Icon,title,copy]) => { const C = Icon as typeof UsersRound; return <article className="rounded-2xl border border-slate-200 bg-white p-5" key={String(title)}><C className="h-5 w-5 text-brand-500" aria-hidden="true"/><h2 className="mt-3 text-sm font-bold text-slate-950">{String(title)}</h2><p className="mt-1 text-xs leading-5 text-slate-600">{String(copy)}</p></article>; })}</div>
      <section className="mt-10 text-center"><h2 className={typography.h1}>JAMB • WAEC • Topic Clinics • Private Lessons</h2><p className="mt-2 text-sm text-slate-600">Practise on Master De Genius, then ask for human help whenever you need it.</p></section>
    </section>
  </main>;
}
