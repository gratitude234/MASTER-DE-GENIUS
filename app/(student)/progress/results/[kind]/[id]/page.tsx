import { CompletionNotice } from "@/components/pwa/completion-notice";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOnboardedUser } from "@/lib/auth";
import { loadResult } from "@/features/results/service";
import { AnswerReview } from "@/components/results/answer-review";
import { RevisionButton } from "@/components/results/revision-button";
export const dynamic = "force-dynamic";
export default async function ResultPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { user, supabase } = await requireOnboardedUser();
  const { kind, id } = await params;
  if (kind !== "exam" && kind !== "practice") notFound();
  const result = await loadResult(user.id, kind, id);
  if (!result) notFound();
  const { data: preference } = await supabase.from("student_exam_preferences").select("target_score").eq("user_id", user.id).eq("exam_body_id", result.examBodyId).eq("is_primary", true).maybeSingle();
  const weak = [...result.topics].filter(t => t.topicSlug && t.accuracy < 70).sort((a, b) => a.accuracy - b.accuracy || b.total - a.total).slice(0, 3);
  const strong = [...result.subjects].sort((a, b) => b.accuracy - a.accuracy)[0];
  return <div className="mx-auto max-w-4xl space-y-6 pb-6">
    <CompletionNotice userId={user.id} kind={kind} id={id} />
    <Link href="/progress" className="inline-flex min-h-11 items-center text-sm font-semibold text-blue-700">← Progress</Link>
    <section className="rounded-3xl bg-slate-950 p-6 text-white sm:p-8">
      <p className="text-sm text-blue-200">{result.title} · {new Date(result.completedAt).toLocaleDateString("en-GB", { timeZone: "UTC" })}</p>
      <h1 className="mt-3 text-5xl font-black">{result.score}<span className="text-xl text-slate-300"> / {result.maximum}</span></h1>
      <p className="mt-3 text-sm text-slate-200">{result.scaled ? "Estimated mock score · 100 points per subject. This is not an official JAMB score." : "One mark per correct answer. No negative marking."}</p>
      {result.scaled && preference?.target_score != null && <p className="mt-3 font-semibold">Current target: {preference.target_score} · {result.score >= preference.target_score ? "Target reached" : `${preference.target_score - result.score} points away`}</p>}
    </section>
    <div className="grid grid-cols-3 gap-2">{[["Correct", result.correct], ["Incorrect", result.incorrect], ["Unanswered", result.unanswered]].map(([label, value]) => <div key={label} className="rounded-2xl border bg-white p-3 text-center"><p className="text-2xl font-bold">{value}</p><p className="text-xs text-slate-600">{label}</p></div>)}</div>
    <p className="text-sm leading-6 text-slate-600">{result.accuracy}% correct across all questions · {Math.floor(result.elapsedSeconds / 60)}m {result.elapsedSeconds % 60}s session elapsed. {strong && `Strongest subject in this attempt: ${strong.name}.`} Per-question timing was not recorded.</p>
    <section className="space-y-3"><h2 className="text-xl font-bold">Subject breakdown</h2>{result.subjects.map(s => <div key={s.key} className="rounded-2xl border bg-white p-4"><div className="flex justify-between gap-3 font-bold"><span>{s.name}</span><span>{s.accuracy}%</span></div><p className="mt-2 text-sm text-slate-600">{s.correct}/{s.total} correct · {s.incorrect} incorrect · {s.unanswered} unanswered</p><progress value={s.correct} max={s.total} aria-label={`${s.name} accuracy`} className="mt-3 h-2 w-full accent-blue-700" /></div>)}</section>
    <section className="space-y-3"><h2 className="text-xl font-bold">What should I do next?</h2><p className="text-sm text-slate-600">Revisit up to 20 saved questions from a weak topic, with missed questions first. These percentages describe this attempt, not overall mastery.</p>{weak.length ? weak.map(t => <div key={t.key} className="space-y-3 rounded-2xl border border-blue-200 bg-blue-50 p-4"><h3 className="font-bold">{result.subjects.find(s => s.subjectSlug === t.subjectSlug)?.name} · {t.name}</h3><p className="text-sm">{t.correct}/{t.total} correct ({t.accuracy}%) {t.total < 5 ? "· Small sample" : ""}</p><RevisionButton input={{ resultId: id, kind, subjectSlug: t.subjectSlug, topicSlug: t.topicSlug! }}>Practice {t.name}</RevisionButton></div>) : <p className="rounded-2xl border bg-white p-4">No categorised topic scored below 70% in this attempt. Review missed answers or try another practice session.</p>}<Link href="/progress/mistakes" className="inline-flex min-h-12 items-center font-bold text-blue-700">Review my mistake bank →</Link></section>
    <section className="space-y-3"><h2 className="text-xl font-bold">Topic breakdown</h2>{result.topics.map(t => <div key={t.key} className="rounded-xl border bg-white p-4"><p className="font-semibold">{result.subjects.find(s => s.subjectSlug === t.subjectSlug)?.name} · {t.name}</p><p className="mt-1 text-sm text-slate-600">{t.correct}/{t.total} correct · {t.incorrect} incorrect · {t.unanswered} unanswered · {t.accuracy}%{t.total < 5 ? " · Small sample" : ""}</p></div>)}</section>
    <AnswerReview items={result.items} />
    <Link href="/mock" className="inline-flex min-h-12 items-center font-bold text-blue-700">Take another mock →</Link>
  </div>;
}
