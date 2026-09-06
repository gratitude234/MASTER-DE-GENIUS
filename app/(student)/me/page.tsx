import { Target } from "lucide-react";
import { SignOut } from "@/components/pwa/sign-out";
import { getStudentProfile } from "@/features/profile/queries";
import { ProfileNameForm } from "@/components/profile/profile-name-form";

export default async function MePage() {
  const { user, profile, preference, examBody, subjects } = await getStudentProfile();
  const initials = (profile.full_name || user.email || "DG").split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div><h1 className="text-2xl font-black tracking-[-0.04em] text-slate-950">Profile</h1><p className="mt-1 text-sm text-slate-500">Your MASTER@DE&apos;GENIUS account and preparation setup.</p></div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-4"><div className="grid h-14 w-14 place-items-center rounded-full bg-brand-500 text-base font-black text-white">{initials}</div><div className="min-w-0"><div className="truncate font-extrabold text-slate-950">{profile.full_name || "Student"}</div><div className="truncate text-sm text-slate-500">{user.email}</div></div></div>
        <div className="mt-6 border-t border-slate-100 pt-5"><ProfileNameForm fullName={profile.full_name} /></div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2"><Target className="h-4 w-4 text-brand-500" /><h2 className="text-sm font-extrabold text-slate-950">Preparation profile</h2></div>
        <div className="mt-4 divide-y divide-slate-100 text-sm">
          <div className="flex justify-between gap-4 py-3"><span className="text-slate-500">Exam</span><strong>{examBody?.short_name ?? "—"} {preference?.exam_year ?? ""}</strong></div>
          <div className="flex justify-between gap-4 py-3"><span className="text-slate-500">Target score</span><strong>{preference?.target_score ? `${preference.target_score} / 400` : "—"}</strong></div>
          <div className="flex justify-between gap-4 py-3"><span className="text-slate-500">Course</span><strong className="text-right">{preference?.intended_course || "Not set"}</strong></div>
          <div className="flex justify-between gap-4 py-3"><span className="text-slate-500">Study intensity</span><strong className="capitalize">{preference?.study_intensity ?? "—"}</strong></div>
        </div>
        <div className="mt-4"><div className="text-xs font-bold uppercase tracking-wide text-slate-400">Subjects</div><div className="mt-2 flex flex-wrap gap-2">{subjects.map((subject) => <span key={subject.id} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-bold text-slate-700">{subject.name}</span>)}</div></div>
      </section>

      <SignOut />
    </div>
  );
}
