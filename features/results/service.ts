import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { grade, mistakeBank, outcome, type LearningResult, type ResultKind, type ReviewItem } from "./grading";
import type { StudentQuestion } from "@/features/questions/types";
import type { Json } from "@/types/database";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadResult(userId: string, kind: ResultKind, id: string): Promise<LearningResult | null> {
  if (!UUID.test(id)) return null;
  const db = createAdminClient();
  // Ownership AND final status must be verified before reading answer keys.
  const result = kind === "exam"
    ? await db.from("exam_attempts").select("*").eq("id", id).eq("user_id", userId).eq("status", "submitted").maybeSingle()
    : await db.from("practice_sessions").select("*").eq("id", id).eq("user_id", userId).eq("status", "completed").maybeSingle();
  if (result.error) throw new Error("Could not load result. Please try again.");
  const row = result.data;
  if (!row) return null;
  const completedAt = "submitted_at" in row ? row.submitted_at : row.completed_at;
  if (!completedAt || !row.started_at) throw new Error("This result is not ready yet.");
  const { data: exam, error: examError } = await db.from("exam_bodies").select("code, short_name").eq("id", row.exam_body_id).single();
  if (examError || !exam) throw new Error("Could not load exam details.");
  let items: ReviewItem[];
  if (kind === "exam") {
    const [q, a] = await Promise.all([
      db.from("exam_attempt_questions").select("*").eq("attempt_id", id).order("overall_position"),
      db.from("exam_attempt_answers").select("*").eq("attempt_id", id).eq("user_id", userId),
    ]);
    if (q.error || a.error) throw new Error("Could not load exam answers.");
    if (q.data.length !== ("total_questions" in row ? row.total_questions : -1)) throw new Error("The complete paper could not be loaded.");
    const answers = new Map(a.data.map(x => [x.attempt_question_id, x]));
    items = q.data.map(x => {
      const answer = answers.get(x.id);
      const selected = answer?.selected_option_key ?? null;
      return { id: x.id, position: x.overall_position, question: x.student_snapshot as unknown as StudentQuestion,
        selected, correct: x.correct_option_key, explanation: x.explanation,
        outcome: outcome(selected, x.correct_option_key), flagged: answer?.is_flagged ?? false };
    });
  } else {
    const [q, a] = await Promise.all([
      db.from("practice_session_questions").select("*").eq("session_id", id).order("position"),
      db.from("practice_answers").select("*").eq("session_id", id).eq("user_id", userId),
    ]);
    if (q.error || a.error) throw new Error("Could not load practice answers.");
    if (q.data.length !== ("question_count" in row ? row.question_count : -1)) throw new Error("The complete session could not be loaded.");
    const answers = new Map(a.data.map(x => [x.session_question_id, x]));
    items = q.data.map(x => {
      const selected = answers.get(x.id)?.selected_option_key ?? null;
      return { id: x.id, position: x.position, question: x.student_snapshot as unknown as StudentQuestion,
        selected, correct: x.correct_option_key, explanation: x.explanation,
        outcome: outcome(selected, x.correct_option_key), flagged: false };
    });
  }
  const end = Math.min(Date.parse(completedAt), row.expires_at ? Date.parse(row.expires_at) : Infinity);
  return { id, kind, examBodyId: row.exam_body_id, completedAt, startedAt: row.started_at,
    title: `${exam.short_name} ${kind === "exam" ? "Mock" : "Practice"}`,
    elapsedSeconds: Math.max(0, Math.round((end - Date.parse(row.started_at)) / 1000)),
    ...grade(items, kind === "exam" && exam.code === "jamb"), items };
}

/** Explicit pagination: never silently truncate a student's history at the API row cap. */
export async function loadHistory(userId: string): Promise<LearningResult[]> {
  const db = createAdminClient();
  const refs: { id: string; kind: ResultKind }[] = [];
  for (const kind of ["exam", "practice"] as const) {
    for (let offset = 0; ; offset += 100) {
      const response = kind === "exam"
        ? await db.from("exam_attempts").select("id").eq("user_id", userId).eq("status", "submitted").order("id").range(offset, offset + 99)
        : await db.from("practice_sessions").select("id").eq("user_id", userId).eq("status", "completed").order("id").range(offset, offset + 99);
      if (response.error) throw new Error("Could not load your history. Please retry.");
      refs.push(...response.data.map(x => ({ id: x.id, kind })));
      if (response.data.length < 100) break;
    }
  }
  const results: LearningResult[] = [];
  // Bound concurrency to avoid exhausting database connections on long histories.
  for (let start = 0; start < refs.length; start += 4) {
    const batch = await Promise.all(refs.slice(start, start + 4).map(r => loadResult(userId, r.kind, r.id)));
    for (const result of batch) if (result) results.push(result);
  }
  return results.sort((a, b) => b.completedAt.localeCompare(a.completedAt) || a.id.localeCompare(b.id));
}

export interface RevisionInput {
  resultId?: string;
  kind?: ResultKind;
  subjectSlug: string;
  topicSlug?: string;
  mistakes?: boolean;
}
export async function startRevision(userId: string, input: RevisionInput): Promise<string> {
  let items: ReviewItem[];
  let examBodyId: string;
  if (input.mistakes) {
    const bank = mistakeBank(await loadHistory(userId)).filter(m => !m.mastered
      && m.item.question.subject.slug === input.subjectSlug
      && (!input.topicSlug || m.item.question.topic?.slug === input.topicSlug));
    if (!bank.length) throw new Error("No active mistakes match this subject and topic.");
    examBodyId = bank[0].examBodyId;
    items = bank.filter(m => m.examBodyId === examBodyId).slice(0, 20).map(m => m.item);
  } else {
    if (!input.resultId || !input.kind) throw new Error("Choose a result to practise from.");
    const result = await loadResult(userId, input.kind, input.resultId);
    if (!result) throw new Error("Completed result not found.");
    examBodyId = result.examBodyId;
    items = result.items.filter(i => i.question.subject.slug === input.subjectSlug
      && (!input.topicSlug || i.question.topic?.slug === input.topicSlug))
      .sort((a, b) => Number(a.outcome === "correct") - Number(b.outcome === "correct")).slice(0, 20);
  }
  if (!items.length) throw new Error("No questions are available for this revision.");
  const db = createAdminClient();
  const { data: subject, error: subjectError } = await db.from("subjects").select("id").eq("slug", input.subjectSlug).single();
  if (subjectError || !subject) throw new Error("Subject is unavailable.");
  let topicId: string | null = null;
  if (input.topicSlug) {
    const { data: topic, error } = await db.from("topics").select("id").eq("subject_id", subject.id).eq("slug", input.topicSlug).maybeSingle();
    if (error) throw new Error("Could not load topic.");
    topicId = topic?.id ?? null;
  }
  // Reuse owned frozen questions, preserving source identity. No provider availability required.
  const payload = items.map(i => ({ sourceProvider: i.question.source.provider,
    sourceQuestionId: i.question.source.providerQuestionId,
    internalQuestionId: i.question.source.internalQuestionId ?? null,
    studentSnapshot: i.question, correctOptionKey: i.correct, explanation: i.explanation }));
  const { data, error } = await db.rpc("create_practice_session", {
    p_user_id: userId, p_exam_body_id: examBodyId, p_subject_id: subject.id, p_topic_id: topicId,
    p_mode: "practice", p_difficulty: null, p_year_filter: null, p_requested_count: items.length,
    p_provider: "revision", p_duration_seconds: null, p_questions: JSON.parse(JSON.stringify(payload)) as Json,
  });
  if (error || !data) throw new Error("Could not start revision. Please try again.");
  return data;
}
