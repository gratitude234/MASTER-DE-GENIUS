"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CircleHelp, ExternalLink, GraduationCap, LifeBuoy, MessageCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { buttonClasses } from "@/components/ui/variants";
import { generalSupportMessage, whatsappUrl } from "@/features/classes/whatsapp";
import { track } from "@/features/analytics/events";
import { cn } from "@/lib/utils";
import { shouldShowSupportCta } from "@/features/support/visibility";

export function SupportHub({ authenticated = true, hasStudentNav = true }: { authenticated?: boolean; hasStudentNav?: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [open, setOpen] = useState(false);
  const number = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP_NUMBER?.replace(/\D/g, "") || null;
  const context = useMemo(() => ({
    examType: search.get("examType"), subjectSlug: search.get("subjectSlug"),
    subjectName: search.get("subjectName"), topic: search.get("topic"),
  }), [search]);
  const eligible = shouldShowSupportCta(pathname);
  useEffect(() => { if (eligible) track("support_cta_viewed", { pathname, authenticated }); }, [eligible, pathname, authenticated]);
  if (!eligible) return null;

  const requestParams = new URLSearchParams({ request: "1", source: "persistent_support_cta" });
  for (const [key, value] of Object.entries(context)) if (value) requestParams.set(key, value);
  const classHref = authenticated ? `/classes?${requestParams}` : "/premium-classes";
  const academicUrl = whatsappUrl(generalSupportMessage("academic"), number);
  const platformUrl = whatsappUrl(generalSupportMessage("platform"), number);
  const contextual = context.subjectName || context.topic;

  return (
    <>
      <button
        type="button"
        aria-label="Open Master De Genius support"
        aria-haspopup="dialog"
        onClick={() => { setOpen(true); track("support_cta_opened", { pathname, authenticated, hasContext: Boolean(context.subjectSlug || context.topic) }); }}
        className={cn(
          "fixed right-3 z-40 inline-flex min-h-11 items-center gap-2 rounded-full bg-slate-950 px-4 text-xs font-bold text-white shadow-lg shadow-slate-950/20 transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 motion-reduce:transition-none sm:right-5",
          hasStudentNav ? "bottom-[calc(var(--nav-clearance)+0.75rem)] lg:bottom-6" : "bottom-[calc(env(safe-area-inset-bottom)+1rem)]",
        )}
      >
        <CircleHelp className="h-4 w-4" aria-hidden="true" /> Need Help?
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="How can we help?" description="Choose the kind of support you need." size="md">
        <div className="space-y-2.5">
          {contextual && authenticated ? (
            <div className="rounded-xl bg-brand-50 p-3.5">
              <p className="text-xs font-bold text-slate-950">Need help with {context.topic || context.subjectName}?</p>
              <p className="mt-1 text-[11.5px] leading-5 text-slate-600">We can carry this subject into your class request.</p>
              <Link onClick={() => { setOpen(false); track("support_option_selected", { option: "contextual_class", source: "persistent_support_cta" }); track("class_cta_clicked", { source: "persistent_support_cta", subjectSlug: context.subjectSlug }); }} href={classHref} className={buttonClasses({ variant: "primary", size: "sm", className: "mt-3 w-full" })}>
                Request a {context.subjectName || "Premium"} Class
              </Link>
            </div>
          ) : null}
          <SupportOption icon={GraduationCap} title="Get help with my studies" description="Request tutoring or a Premium Class." action={<Link onClick={() => { setOpen(false); track("support_option_selected", { option: "studies" }); track("class_cta_clicked", { source: "persistent_support_cta", subjectSlug: context.subjectSlug }); }} href={classHref} className={buttonClasses({ variant: "dark", size: "md", className: "w-full" })}>{authenticated ? "Request a Class" : "Explore Premium Classes"}</Link>} />
          <SupportOption icon={MessageCircle} title="Talk to Academic Support" description="Ask about JAMB, WAEC or classes." action={academicUrl ? <a onClick={() => { track("support_option_selected", { option: "academic" }); track("support_whatsapp_clicked", { kind: "academic" }); }} href={academicUrl} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "secondary", size: "md", className: "w-full" })}>Chat on WhatsApp <ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden="true" /></a> : <p className="text-xs text-slate-500">WhatsApp contact is being configured.</p>} />
          <SupportOption icon={LifeBuoy} title="I have a platform problem" description="Get help with an account or technical issue." action={platformUrl ? <a onClick={() => { track("support_option_selected", { option: "platform" }); track("support_whatsapp_clicked", { kind: "platform" }); }} href={platformUrl} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "ghost", size: "md", className: "w-full" })}>Get Support <ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden="true" /></a> : <p className="text-xs text-slate-500">WhatsApp contact is being configured.</p>} />
          {!authenticated ? <div className="grid grid-cols-2 gap-2 pt-1"><Link href="/login" className={buttonClasses({ variant: "secondary", size: "md" })}>Sign in</Link><Link href="/signup" className={buttonClasses({ variant: "primary", size: "md" })}>Create account</Link></div> : <Link onClick={() => { setOpen(false); track("support_option_selected", { option: "explore_classes" }); }} href="/classes" className="block rounded-lg py-2 text-center text-xs font-bold text-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">View Master Classes</Link>}
        </div>
      </Sheet>
    </>
  );
}

function SupportOption({ icon: Icon, title, description, action }: { icon: typeof GraduationCap; title: string; description: string; action: React.ReactNode }) {
  return <section className="rounded-xl border border-slate-200 p-3.5"><div className="flex gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100"><Icon className="h-4 w-4 text-slate-700" aria-hidden="true" /></span><div><h3 className="text-xs font-bold text-slate-950">{title}</h3><p className="mt-0.5 text-[11.5px] leading-5 text-slate-600">{description}</p></div></div><div className="mt-3">{action}</div></section>;
}
