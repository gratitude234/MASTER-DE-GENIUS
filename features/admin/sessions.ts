import "server-only";

import { displayName, loadDirectory } from "@/features/admin/directory";
import { outcome, type Outcome } from "@/features/results/grading";
import type { StudentQuestion } from "@/features/questions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

export const SESSION_PAGE_SIZE = 25;
export const SESSION_KINDS = ["practice", "timed", "revision", "mock"] as const;
export const SESSION_STATES = ["active", "overdue", "finished", "abandoned"] as const;

export interface SessionFilters {
  kind?: (typeof SESSION_KINDS)[number];
  state?: (typeof SESSION_STATES)[number];
  exam?: "jamb" | "waec";
  subject?: string;
  userId?: string;
  search?: string;
  from?: string;
  to?: string;
}

export type SessionRow = Database["public"]["Functions"]["admin_list_sessions"]["Returns"][number];

export async function listSessions(actorId: string, filters: SessionFilters, page: number) {
  const { data, error } = await createAdminClient().rpc("admin_list_sessions", {
    p_actor_id: actorId,
    p_kind: filters.kind ?? null,
    p_state: filters.state ?? null,
    p_exam: filters.exam ?? null,
    p_subject_slug: filters.subject ?? null,
    p_user_id: filters.userId ?? null,
    p_search: filters.search ?? null,
    p_from: filters.from ?? null,
    p_to: filters.to ?? null,
    p_limit: SESSION_PAGE_SIZE,
    p_offset: (page - 1) * SESSION_PAGE_SIZE,
  });
  if (error) throw new Error("Could not load sessions.");
  const rows = data ?? [];
  const total = Number(rows[0]?.total_count ?? 0);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / SESSION_PAGE_SIZE)) };
}

export interface SessionQuestionRow {
  id: string;
  position: number;
  subjectName: string;
  subjectSlug: string;
  topicName: string | null;
  sourceProvider: string;
  sourceQuestionId: string;
  internalQuestionId: string | null;
  prompt: string;
  selected: string | null;
  correct: string;
  outcome: Outcome;
  flagged: boolean;
  answeredAt: string | null;
}

export interface SessionDetail {
  kind: "practice" | "exam";
  id: string;
  userId: string;
  student: string;
  studentEmail: string | null;
  examCode: string;
  examName: string;
  sessionType: "practice" | "timed" | "revision" | "mock";
  status: string;
  sourceProvider: string;
  subjects: { name: string; questionCount: number; answeredCount: number; correctCount: number }[];
  questionCount: number;
  answeredCount: number;
  correctCount: number;
  flaggedCount: number | null;
  startedAt: string | null;
  expiresAt: string | null;
  finishedAt: string | null;
  submissionReason: string | null;
  durationSeconds: number | null;
  createdAt: string;
  updatedAt: string;
  /** Questions carrying an offline-sync revision receipt, and the highest revision seen. */
  sync: { questionsWithReceipts: number; highestRevision: number };
  isOverdue: boolean;
  questions: SessionQuestionRow[];
}

function snapshot(value: unknown): Partial<StudentQuestion> {
  return value && typeof value === "object" ? (value as Partial<StudentQuestion>) : {};
}

/**
 * Read-only diagnosis of one session: what was frozen, what the server
 * received, and whether offline sync reached it. Nothing here can alter an
 * answer or a score.
 */
export async function loadSessionDetail(actorId: string, kind: "practice" | "exam", id: string): Promise<SessionDetail | null> {
  const db = createAdminClient();
  const now = Date.now();

  if (kind === "practice") {
    const { data: session, error } = await db.from("practice_sessions").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error("Could not load the session.");
    if (!session) return null;

    const [exam, subject, questions, answers, revisions, directory] = await Promise.all([
      db.from("exam_bodies").select("code, short_name").eq("id", session.exam_body_id).maybeSingle(),
      db.from("subjects").select("slug, name").eq("id", session.subject_id).maybeSingle(),
      db.from("practice_session_questions").select("id, position, source_provider, source_question_id, internal_question_id, student_snapshot, correct_option_key").eq("session_id", id).order("position"),
      db.from("practice_answers").select("session_question_id, selected_option_key, answered_at").eq("session_id", id),
      db.from("response_revisions").select("revision").eq("kind", "practice").eq("session_id", id),
      loadDirectory(actorId, [session.user_id]),
    ]);
    if (questions.error || answers.error || revisions.error) throw new Error("Could not load the session.");

    const answerBy = new Map((answers.data ?? []).map((answer) => [answer.session_question_id, answer]));
    const person = directory.get(session.user_id);
    return {
      kind,
      id,
      userId: session.user_id,
      student: displayName(person),
      studentEmail: person?.email ?? null,
      examCode: exam.data?.code ?? "",
      examName: exam.data?.short_name ?? "Unknown exam",
      sessionType: session.source_provider === "revision" ? "revision" : session.mode,
      status: session.status,
      sourceProvider: session.source_provider,
      subjects: [{ name: subject.data?.name ?? "Unknown subject", questionCount: session.question_count, answeredCount: session.answered_count, correctCount: session.correct_count }],
      questionCount: session.question_count,
      answeredCount: session.answered_count,
      correctCount: session.correct_count,
      flaggedCount: null,
      startedAt: session.started_at,
      expiresAt: session.expires_at,
      finishedAt: session.completed_at,
      submissionReason: null,
      durationSeconds: session.duration_seconds,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      sync: {
        questionsWithReceipts: revisions.data?.length ?? 0,
        highestRevision: Math.max(0, ...(revisions.data ?? []).map((row) => row.revision)),
      },
      isOverdue: session.status === "in_progress" && session.mode === "timed" && Boolean(session.expires_at) && Date.parse(session.expires_at!) <= now,
      questions: (questions.data ?? []).map((row) => {
        const question = snapshot(row.student_snapshot);
        const answer = answerBy.get(row.id);
        const selected = answer?.selected_option_key ?? null;
        return {
          id: row.id,
          position: row.position,
          subjectName: question.subject?.name ?? subject.data?.name ?? "",
          subjectSlug: question.subject?.slug ?? subject.data?.slug ?? "",
          topicName: question.topic?.name ?? null,
          sourceProvider: row.source_provider,
          sourceQuestionId: row.source_question_id,
          internalQuestionId: row.internal_question_id,
          prompt: typeof question.prompt === "string" ? question.prompt : "",
          selected,
          correct: row.correct_option_key,
          outcome: outcome(selected, row.correct_option_key),
          flagged: false,
          answeredAt: answer?.answered_at ?? null,
        };
      }),
    };
  }

  const { data: attempt, error } = await db.from("exam_attempts").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("Could not load the attempt.");
  if (!attempt) return null;

  const [exam, sections, questions, answers, revisions, directory] = await Promise.all([
    db.from("exam_bodies").select("code, short_name").eq("id", attempt.exam_body_id).maybeSingle(),
    db.from("exam_attempt_subjects").select("subject_id, display_order, question_count, answered_count, correct_count").eq("attempt_id", id).order("display_order"),
    db.from("exam_attempt_questions").select("id, overall_position, subject_id, source_provider, source_question_id, internal_question_id, student_snapshot, correct_option_key").eq("attempt_id", id).order("overall_position"),
    db.from("exam_attempt_answers").select("attempt_question_id, selected_option_key, is_flagged, answered_at").eq("attempt_id", id),
    db.from("response_revisions").select("revision").eq("kind", "exam").eq("session_id", id),
    loadDirectory(actorId, [attempt.user_id]),
  ]);
  if (sections.error || questions.error || answers.error || revisions.error) throw new Error("Could not load the attempt.");

  const subjectIds = (sections.data ?? []).map((section) => section.subject_id);
  const { data: subjects } = subjectIds.length
    ? await db.from("subjects").select("id, slug, name").in("id", subjectIds)
    : { data: [] as { id: string; slug: string; name: string }[] };
  const subjectBy = new Map((subjects ?? []).map((subject) => [subject.id, subject]));
  const answerBy = new Map((answers.data ?? []).map((answer) => [answer.attempt_question_id, answer]));
  const person = directory.get(attempt.user_id);

  return {
    kind,
    id,
    userId: attempt.user_id,
    student: displayName(person),
    studentEmail: person?.email ?? null,
    examCode: exam.data?.code ?? "",
    examName: exam.data?.short_name ?? "Unknown exam",
    sessionType: "mock",
    status: attempt.status,
    sourceProvider: attempt.source_provider,
    subjects: (sections.data ?? []).map((section) => ({
      name: subjectBy.get(section.subject_id)?.name ?? "Unknown subject",
      questionCount: section.question_count,
      answeredCount: section.answered_count,
      correctCount: section.correct_count,
    })),
    questionCount: attempt.total_questions,
    answeredCount: attempt.answered_count,
    correctCount: attempt.correct_count,
    flaggedCount: attempt.flagged_count,
    startedAt: attempt.started_at,
    expiresAt: attempt.expires_at,
    finishedAt: attempt.submitted_at,
    submissionReason: attempt.submission_reason,
    durationSeconds: attempt.duration_seconds,
    createdAt: attempt.created_at,
    updatedAt: attempt.updated_at,
    sync: {
      questionsWithReceipts: revisions.data?.length ?? 0,
      highestRevision: Math.max(0, ...(revisions.data ?? []).map((row) => row.revision)),
    },
    isOverdue: attempt.status === "in_progress" && Boolean(attempt.expires_at) && Date.parse(attempt.expires_at!) <= now,
    questions: (questions.data ?? []).map((row) => {
      const question = snapshot(row.student_snapshot);
      const answer = answerBy.get(row.id);
      const selected = answer?.selected_option_key ?? null;
      const subject = subjectBy.get(row.subject_id);
      return {
        id: row.id,
        position: row.overall_position,
        subjectName: subject?.name ?? question.subject?.name ?? "",
        subjectSlug: subject?.slug ?? question.subject?.slug ?? "",
        topicName: question.topic?.name ?? null,
        sourceProvider: row.source_provider,
        sourceQuestionId: row.source_question_id,
        internalQuestionId: row.internal_question_id,
        prompt: typeof question.prompt === "string" ? question.prompt : "",
        selected,
        correct: row.correct_option_key,
        outcome: outcome(selected, row.correct_option_key),
        flagged: answer?.is_flagged ?? false,
        answeredAt: answer?.answered_at ?? null,
      };
    }),
  };
}
