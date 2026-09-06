import Link from "next/link";
import { ActiveExamCard } from "@/components/home/active-exam-card";
import { MistakesCard } from "@/components/home/mistakes-card";
import { QuickActions } from "@/components/home/quick-actions";
import { RevisionButton } from "@/components/results/revision-button";
import { getActiveExamAttemptSummaryForUser } from "@/features/exams/service";
import { getStudentProfile } from "@/features/profile/queries";
import { loadHistory } from "@/features/results/service";
import { mistakeBank } from "@/features/results/grading";
export default async function HomePage() {
  const { user, profile, preference, examBody } = await getStudentProfile();
  // Expiry submission happens before reading history, so newly finished mocks appear immediately.
  const activeExam = await getActiveExamAttemptSummaryForUser(user.id, preference?.exam_body_id);
  const history = await loadHistory(user.id);
  const scoped = history.filter(r => r.examBodyId === preference?.exam_body_id);
  const latest = scoped.find(r => r.kind === "exam");
  const recent = scoped[0];
  const weak = recent ? [...recent.topics].filter(t => t.topicSlug && t.accuracy < 70).sort((a,b) => a.accuracy - b.accuracy).slice(0,3) : [];
  const firstName = profile.full_name.split(/\s+/).filter(Boolean)[0] || "Student";
  return <div className="space-y-5">
    <header><p className="text-xs font-bold uppercase tracking-widest text-blue-700">{examBody?.short_name ?? "Exam"} {preference?.exam_year} Preparation</p><h1 className="mt-2 text-3xl font-black">Welcome back, {firstName}.</h1><p className="mt-2 text-sm text-slate-600">Make your next study session count.</p></header>
    {activeExam && <ActiveExamCard attempt={activeExam} />}
    <section className="space-y-4 rounded-3xl bg-slate-950 p-6 text-white"><h2 className="text-xl font-bold">Continue where you need it most</h2>{recent && weak[0] ? <><p>{weak[0].name} · {weak[0].accuracy}% correct in your latest attempt ({weak[0].total} questions).</p><RevisionButton input={{ resultId: recent.id, kind: recent.kind, subjectSlug: weak[0].subjectSlug, topicSlug: weak[0].topicSlug! }}>Practice {weak[0].name}</RevisionButton></> : <><p className="text-sm text-slate-300">Complete a practice session to find the topics that need more attention.</p><Link href="/practice" className="inline-flex min-h-12 items-center rounded-xl bg-blue-700 px-5 font-bold">Start practice</Link></>}</section>
    <QuickActions />
    <a href="/offline" className="inline-flex min-h-12 items-center text-sm font-bold text-blue-700">Saved sessions · Offline access →</a>
    <div className="grid gap-4 md:grid-cols-2"><section className="rounded-2xl border bg-white p-5"><h2 className="font-bold">Latest mock</h2>{latest ? <><p className="mt-3 text-3xl font-black">{latest.score}/{latest.maximum}</p><p className="mt-2 text-sm text-slate-600">{latest.scaled ? "Estimated mock score" : "Correct answers"}</p><Link href={`/progress/results/exam/${latest.id}`} className="mt-3 inline-flex min-h-12 items-center font-bold text-blue-700">View result →</Link></> : <><p className="mt-3 text-sm text-slate-600">No completed mock yet.</p><Link href="/mock" className="mt-3 inline-flex min-h-12 items-center font-bold text-blue-700">Explore mock exams →</Link></>}</section><MistakesCard count={mistakeBank(history).filter(m => !m.mastered).length} /></div>
    {recent && <section className="space-y-3 rounded-2xl border bg-white p-5"><h2 className="font-bold">Latest attempt · Subject performance</h2>{recent.subjects.map(s => <p key={s.key} className="flex justify-between gap-3 text-sm"><span>{s.name}</span><strong>{s.correct}/{s.total} · {s.accuracy}%</strong></p>)}<Link href={`/progress/results/${recent.kind}/${recent.id}`} className="inline-flex min-h-12 items-center text-sm font-bold text-blue-700">Explore topics & weak areas →</Link></section>}
  </div>;
}
