import { StudentNavigation, type ExamLabel } from "@/components/app-shell/student-navigation";

export function StudentShell({ examLabel, children }: { examLabel: ExamLabel | null; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <StudentNavigation examLabel={examLabel} />
      <main className="min-h-screen pb-[92px] lg:ml-[246px] lg:pb-0">
        <div className="mx-auto w-full max-w-[1260px] px-4 py-5 sm:px-6 lg:px-9 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
