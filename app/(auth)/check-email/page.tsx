import Link from "next/link";
import { redirect } from "next/navigation";
import { MailCheck } from "lucide-react";
import { buttonClasses, typography } from "@/components/ui/variants";

/**
 * Password recovery only. Email confirmation is disabled, so signup never lands
 * here; any other visit is sent to sign-in rather than shown a stale
 * "confirm your email" screen.
 */
export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ email?: string; mode?: string }> }) {
  const { email, mode } = await searchParams;
  if (mode !== "reset") redirect("/login");

  return (
    <section className="rounded-2xl border border-slate-200 bg-white px-7 py-9 text-center">
      <div aria-hidden="true" className="mx-auto grid h-[52px] w-[52px] place-items-center rounded-2xl bg-brand-50 text-brand-500"><MailCheck className="h-[22px] w-[22px]" /></div>
      <h1 className={`mt-5 ${typography.h1}`}>Check your email</h1>
      <p className="mt-1.5 text-[13.5px] leading-[1.5] text-slate-600">
        We sent a password reset link{email ? <> to <strong className="text-slate-700">{email}</strong></> : null}.
      </p>
      <Link href="/login" className={buttonClasses({ variant: "secondary", size: "md", className: "mt-7" })}>Back to sign in</Link>
    </section>
  );
}
