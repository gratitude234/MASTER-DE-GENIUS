import { Target } from "lucide-react";
import { AppStatusRow } from "@/components/pwa/app-status-row";
import { SignOut } from "@/components/pwa/sign-out";
import { getStudentProfile } from "@/features/profile/queries";
import { ProfileNameForm } from "@/components/profile/profile-name-form";
import { Badge } from "@/components/ui/badge";
import { typography } from "@/components/ui/variants";

export default async function MePage() {
  const { user, profile, preference, examBody, subjects } = await getStudentProfile();
  const initials = (profile.full_name || user.email || "DG").split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");

  return (
    <div className="screen-enter mx-auto max-w-[560px] space-y-3.5">
      <div><h1 className={typography.h1}>Profile</h1><p className="mt-1 text-[12.5px] text-slate-500">Your MASTER@DE&apos;GENIUS account and preparation setup.</p></div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        {/* The initials are a visual stand-in for the name announced beside them. */}
        <div className="flex items-center gap-3.5"><div aria-hidden="true" className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-brand-500 text-base font-bold text-white">{initials}</div><div className="min-w-0"><div className="truncate text-[15px] font-bold text-slate-950">{profile.full_name || "Student"}</div><div className="truncate text-[12.5px] text-slate-500">{user.email}</div></div></div>
        <div className="mt-5 border-t border-slate-100 pt-5"><ProfileNameForm fullName={profile.full_name} /></div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2"><Target aria-hidden="true" className="h-4 w-4 text-brand-500" /><h2 className={typography.h2}>Preparation profile</h2></div>
        <div className="mt-3 divide-y divide-slate-100 border-t border-slate-100 text-[12.5px]">
          <div className="flex justify-between gap-4 py-2.5"><span className="text-slate-500">Exam</span><strong className="font-bold text-slate-950">{examBody?.short_name ?? "—"} {preference?.exam_year ?? ""}</strong></div>
          <div className="flex justify-between gap-4 py-2.5"><span className="text-slate-500">Target score</span><strong className="font-bold text-slate-950">{preference?.target_score ? `${preference.target_score} / 400` : "—"}</strong></div>
          <div className="flex justify-between gap-4 py-2.5"><span className="text-slate-500">Course</span><strong className="text-right font-bold text-slate-950">{preference?.intended_course || "Not set"}</strong></div>
          <div className="flex justify-between gap-4 py-2.5"><span className="text-slate-500">Study intensity</span><strong className="font-bold capitalize text-slate-950">{preference?.study_intensity ?? "—"}</strong></div>
        </div>
        <div className="mt-3.5 flex flex-wrap gap-1.5">{subjects.map((subject) => <Badge key={subject.id} tone="neutral" className="px-3 py-1.5 text-[11.5px]">{subject.name}</Badge>)}</div>
      </section>

      <AppStatusRow />

      <SignOut />
    </div>
  );
}
