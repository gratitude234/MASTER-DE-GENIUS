import Link from "next/link";
import { BrainCircuit, ClipboardCheck, FileQuestion, RotateCcw } from "lucide-react";

const actions = [
  { href: "/practice?quick=1", label: "Quick Practice", helper: "Targets your weakest area", icon: BrainCircuit },
  { href: "/mock", label: "Full Mock", helper: "JAMB conditions", icon: ClipboardCheck },
  { href: "/practice?mode=past", label: "Past Questions", helper: "Browse by year", icon: FileQuestion },
  { href: "/progress/mistakes", label: "Mistakes", helper: "Review weak spots", icon: RotateCcw },
] as const;

export function QuickActions() {
  return (
    <section aria-label="Quick actions" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {actions.map(({ href, label, helper, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="group flex min-h-[84px] items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 transition hover:border-slate-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none"
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700 transition-colors group-hover:bg-brand-50 group-hover:text-brand-500">
            <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-extrabold text-slate-900">{label}</div>
            <div className="mt-0.5 truncate text-[10px] font-medium text-slate-500">{helper}</div>
          </div>
        </Link>
      ))}
    </section>
  );
}
