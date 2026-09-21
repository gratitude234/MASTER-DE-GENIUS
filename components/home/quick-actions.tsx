import Link from "next/link";
import { BrainCircuit, ClipboardCheck, FileQuestion, RotateCcw } from "lucide-react";

const sharedActions = [
  { href: "/practice", label: "Practice", helper: "Build a session", icon: BrainCircuit },
  { href: "/practice?mode=past", label: "Past Questions", helper: "Browse by year", icon: FileQuestion },
  { href: "/progress/mistakes", label: "Mistakes", helper: "Review weak spots", icon: RotateCcw },
] as const;

/**
 * The four places a student actually goes: Practice, the exam-style session
 * their exam body offers, Past Questions and Mistakes.
 *
 * A 2x2 grid on a phone, four across on the desktop column. Each one navigates
 * straight to its destination — no intermediate screen, and no copy beyond the
 * three words under the label.
 *
 * "Practice" goes to the setup screen rather than to the quick-practice
 * shortcut. Continue Learning already offers the targeted session, and two
 * differently-worded routes into the same recommendation was one of the
 * duplications this dashboard was carrying.
 */
export function QuickActions({ examCode }: { examCode: string | null }) {
  const examAction = examCode === "waec"
    ? { href: "/practice?timed=1", label: "Timed Subject", helper: "Exam-style session", icon: ClipboardCheck }
    : { href: "/mock", label: "Full Mock", helper: "JAMB conditions", icon: ClipboardCheck };
  const actions = [sharedActions[0], examAction, ...sharedActions.slice(1)];
  return (
    <section aria-label="Quick actions" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {actions.map(({ href, label, helper, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="group flex min-h-[60px] items-center gap-2.5 rounded-2xl border border-slate-200 bg-white p-3 transition hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 motion-reduce:transition-none"
        >
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700 transition-colors group-hover:bg-brand-50 group-hover:text-brand-500 motion-reduce:transition-none">
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
