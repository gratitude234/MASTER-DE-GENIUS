import { StudentNavigation, type ExamLabel } from "@/components/app-shell/student-navigation";
import { PlanStrip } from "@/components/billing/plan-status";
import { SupportHub } from "@/components/support/support-hub";
import type { PlanBadge } from "@/features/billing/usage-types";
import { Suspense } from "react";

/**
 * The approved desktop composition: a 250px navy rail, and beside it a single
 * 1080px column that the content actually fills.
 *
 * That width is the fix for the old desktop problem. The shell used to open to
 * 1260px while every page inside it capped itself at 768–896px, so on a large
 * display a phone-width strip floated in the middle of an empty canvas. 1080px
 * is the prototype's own measure: Home spreads across it in two and four
 * columns, and the reading screens set their own narrower measure on purpose.
 *
 * The plan indicator lives here, once: in the rail on desktop and as a strip
 * above the page on phones, so no page has to remember to sell Master.
 */
export function StudentShell({
  examLabel,
  plan = null,
  children,
}: {
  examLabel: ExamLabel | null;
  plan?: PlanBadge | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50">
      <StudentNavigation examLabel={examLabel} plan={plan} />
      <Suspense fallback={null}><SupportHub /></Suspense>
      <main className="min-h-screen pb-nav-clearance lg:ml-[250px] lg:pb-0">
        <div className="mx-auto w-full max-w-[1080px] px-4 py-5 sm:px-6 lg:px-10 lg:py-9">
          <PlanStrip plan={plan} />
          {children}
        </div>
      </main>
    </div>
  );
}
