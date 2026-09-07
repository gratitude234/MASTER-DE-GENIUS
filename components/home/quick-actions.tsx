import Link from "next/link";
import { BrainCircuit, ClipboardCheck, FileQuestion, RotateCcw } from "lucide-react";

const actions = [
  { href: "/practice?quick=1", label: "Quick Practice", helper: "Targets your weakest area", icon: BrainCircuit },
  { href: "/mock", label: "Full Mock", helper: "JAMB conditions", icon: ClipboardCheck },
  { href: "/practice?mode=past", label: "Past Questions", helper: "Browse by year", icon: FileQuestion },
  { href: "/progress/mistakes", label: "Mistakes", helper: "Review weak spots", icon: RotateCcw },
] as const;

/**
 * Two up on a phone, four across on the desktop rail's 1080px column — the
 * approved layout, and the reason the desktop canvas no longer reads as empty
 * space around a phone-width strip.
 */
export function QuickActions() {
  return (
    <section aria-label="Quick actions" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {actions.map(({ href, label, helper, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="group flex min-h-[68px] items-center gap-[11px] rounded-2xl border border-slate-200 bg-white p-3.5 transition hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 motion-reduce:transition-none"
        >
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700 transition-colors group-hover:bg-brand-50 group-hover:text-brand-500 motion-reduce:transition-none">
            <Icon className="h-[17px] w-[17px]" strokeWidth={1.9} />
          </div>
          <div className="min-w-0">
            <div className="text-[12.5px] font-bold text-slate-950">{label}</div>
            <div className="mt-px text-[10.5px] font-medium leading-snug text-slate-500">{helper}</div>
          </div>
        </Link>
      ))}
    </section>
  );
}
