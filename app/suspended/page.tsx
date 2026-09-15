import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand/brand-mark";
import { SignOut } from "@/components/pwa/sign-out";
import { buttonClasses, typography } from "@/components/ui/variants";
import { generalSupportMessage, whatsappUrl } from "@/features/classes/whatsapp";
import { isAccountSuspended } from "@/lib/account-status";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Account suspended", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Where a suspended account lands. It deliberately does not use requireUser,
 * which is what sends suspended accounts here, and it says nothing about why:
 * the reason is internal, and support can explain it in a conversation.
 */
export default async function SuspendedPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await isAccountSuspended(user.id))) redirect("/home");

  const support = whatsappUrl(generalSupportMessage("platform"));

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
        <BrandMark />
        <h1 className={cn(typography.h1, "mt-6")}>This account is suspended</h1>
        <p className={cn(typography.body, "mt-2")}>You can&apos;t use Master De Genius with this account at the moment. Your results and payment history are kept.</p>
        <p className={cn(typography.body, "mt-2")}>If you think this is a mistake, contact Master De Genius support.</p>
        <div className="mt-6 space-y-2.5">
          {support ? <a href={support} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "dark", size: "lg", fullWidth: true })}>Contact support on WhatsApp</a> : null}
          <SignOut />
        </div>
      </div>
    </main>
  );
}
