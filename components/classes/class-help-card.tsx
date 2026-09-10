"use client";

import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { useEffect, useMemo } from "react";
import { buttonClasses } from "@/components/ui/variants";
import { track } from "@/features/analytics/events";

export function ClassHelpCard({ href, title, description, label = "Request a Class" }: { href: string; title: string; description: string; label?: string }) {
  // Every caller already encodes the attribution it wants in the link, so the
  // card reports on that rather than taking the same values twice.
  const context = useMemo(() => {
    const query = new URLSearchParams(href.split("?")[1] ?? "");
    return { source: query.get("source"), subjectSlug: query.get("subjectSlug"), reason: query.get("recommendationReason") };
  }, [href]);

  useEffect(() => { track("class_recommendation_viewed", context); }, [context]);

  return <section className="rounded-2xl border border-brand-200 bg-brand-50 p-[18px]"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-brand-500"><GraduationCap className="h-5 w-5" aria-hidden="true" /></span><div><h2 className="text-[13px] font-bold text-slate-950">{title}</h2><p className="mt-1 text-[12px] leading-5 text-slate-600">{description}</p></div></div><Link onClick={() => track("class_cta_clicked", context)} href={href} className={buttonClasses({ variant: "primary", size: "md", className: "mt-4 w-full sm:w-auto" })}>{label}</Link></section>;
}
