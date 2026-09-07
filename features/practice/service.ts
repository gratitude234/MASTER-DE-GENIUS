import "server-only";
import { getRevisions } from "@/features/offline/server";

import { toStudentQuestion } from "@/features/questions/delivery";
import { fetchCanonicalQuestions } from "@/features/questions/service";
import type { StudentQuestion } from "@/features/questions/types";
import type {
  CompletePracticeSessionResult,
  CreatePracticeSessionInput,
  PracticeFeedback,
  PracticeMode,
  PracticeSessionView,
  SavePracticeAnswerResult,
} from "@/features/practice/types";
import { TIMED_SECONDS_PER_QUESTION } from "@/features/practice/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";
import type { ExamBody, QuestionOption } from "@/types/domain";

const EXAM_CODES = new Set<ExamBody>(["jamb", "waec", "neco", "post_utme", "school"]);
const OPTION_KEYS = new Set<QuestionOption["key"]>(["A", "B", "C", "D", "E"]);

type SessionRow = Database["public"]["Tables"]["practice_sessions"]["Row"];
type SessionQuestionRow = Database["public"]["Tables"]["practice_session_questions"]["Row"];
type AnswerRow = Database["public"]["Tables"]["practice_answers"]["Row"];

function asExamBody(value: string): ExamBody {
  if (!EXAM_CODES.has(value as ExamBody)) throw new Error(`Unsupported exam body: ${value}`);
  return value as ExamBody;
}

function asOptionKey(value: string): QuestionOption["key"] {
  if (!OPTION_KEYS.has(value as QuestionOption["key"])) throw new Error("Stored answer option is invalid.");
  return value as QuestionOption["key"];
}

function asStudentQuestion(value: Json): StudentQuestion {
  return value as unknown as StudentQuestion;
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

async function assertOnboardedUser(userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("onboarding_completed")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error(`Could not verify your profile: ${error.message}`);
  if (!data?.onboarding_completed) throw new Error("Finish onboarding before starting practice.");
}

async function resolvePracticeScope(userId: string, input: CreatePracticeSessionInput) {
  const admin = createAdminClient();

  const { data: preference, error: prefError } = await admin
    .from("student_exam_preferences")
    .select("id, exam_body_id")
    .eq("user_id", userId)
    .eq("is_primary", true)
    .maybeSingle();

  if (prefError || !preference) throw new Error("Your primary exam preference is not available.");

  const [{ data: exam, error: examError }, { data: subject, error: subjectError }] = await Promise.all([
    admin.from("exam_bodies").select("id, code").eq("id", preference.exam_body_id).eq("is_active", true).maybeSingle(),
    admin.from("subjects").select("id, slug, name").eq("slug", input.subjectSlug).eq("is_active", true).maybeSingle(),
  ]);

  if (examError || !exam) throw new Error("Could not resolve your exam.");
  if (subjectError || !subject) throw new Error("Could not resolve the selected subject.");

  const { data: selectedSubject, error: selectedError } = await admin
    .from("student_subject_preferences")
    .select("subject_id")
    .eq("preference_id", preference.id)
    .eq("subject_id", subject.id)
    .maybeSingle();

  if (selectedError) throw new Error("Could not verify the selected subject.");
  if (!selectedSubject) throw new Error("That subject is not part of your current exam setup.");

  let topic: { id: string; slug: string; name: string } | null = null;
  if (input.topicSlug) {
    const { data, error } = await admin
      .from("topics")
      .select("id, slug, name")
      .eq("subject_id", subject.id)
      .eq("slug", input.topicSlug)
      .eq("is_active", true)
      .maybeSingle();
    if (error || !data) throw new Error("Could not resolve the selected topic.");
    topic = data;
  }

  return {
    exam: { id: exam.id, code: asExamBody(exam.code) },
    subject,
    topic,
  };
}

export async function createPracticeSessionForUser(
  userId: string,
  input: CreatePracticeSessionInput,
): Promise<{ sessionId: string; questionCount: number; requestedCount: number }> {
  await assertOnboardedUser(userId);
  const scope = await resolvePracticeScope(userId, input);
  const provider = process.env.QUESTION_PROVIDER?.trim() || "internal";

  const questions = await fetchCanonicalQuestions(
    {
      examBody: scope.exam.code,
      subjectSlug: scope.subject.slug,
      topicSlug: scope.topic?.slug ?? null,
      year: input.year ?? null,
      difficulty: input.difficulty ?? null,
      count: input.count,
    },
    provider,
  );

  if (questions.length === 0) {
    throw new Error("No questions match this practice setup yet. Try another topic, year, or difficulty.");
  }

  const payload = questions.map((question) => ({
    sourceProvider: question.source.provider,
    sourceQuestionId: question.source.providerQuestionId,
    internalQuestionId: question.source.internalQuestionId ?? null,
    studentSnapshot: toStudentQuestion(question),
    correctOptionKey: question.correctOptionKey,
    explanation: question.explanation ?? null,
  }));

  const admin = createAdminClient();
  const durationSeconds = input.mode === "timed" ? questions.length * TIMED_SECONDS_PER_QUESTION : null;
  const { data, error } = await admin.rpc("create_practice_session", {
    p_user_id: userId,
    p_exam_body_id: scope.exam.id,
    p_subject_id: scope.subject.id,
    p_topic_id: scope.topic?.id ?? null,
    p_mode: input.mode,
    p_difficulty: input.difficulty ?? null,
    p_year_filter: input.year ?? null,
    p_requested_count: input.count,
    p_provider: provider,
    p_duration_seconds: durationSeconds,
    p_questions: toJson(payload),
  });

  if (error || !data) throw new Error(`Could not create practice session: ${error?.message ?? "unknown error"}`);
  return { sessionId: data, questionCount: questions.length, requestedCount: input.count };
}

export async function loadPracticeSessionForUser(userId: string, sessionId: string): Promise<PracticeSessionView | null> {
  const admin = createAdminClient();
  const { data: session, error: sessionError } = await admin
    .from("practice_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (sessionError) throw new Error(`Could not load practice session: ${sessionError.message}`);
  if (!session) return null;

  const typedSession = session as SessionRow;
  const [
    { data: subject, error: subjectError },
    { data: topic, error: topicError },
    { data: questionRows, error: questionsError },
    { data: answerRows, error: answersError },
  ] = await Promise.all([
    admin.from("subjects").select("slug, name").eq("id", typedSession.subject_id).single(),
    typedSession.topic_id
      ? admin.from("topics").select("slug, name").eq("id", typedSession.topic_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin.from("practice_session_questions").select("*").eq("session_id", sessionId).order("position"),
    admin.from("practice_answers").select("*").eq("session_id", sessionId).eq("user_id", userId),
  ]);

  if (subjectError || !subject) throw new Error("Could not load the practice subject.");
  if (topicError) throw new Error("Could not load the practice topic.");
  if (questionsError) throw new Error("Could not load practice questions.");
  if (answersError) throw new Error("Could not load saved answers.");

  const revisions = await getRevisions(userId, "practice", sessionId);
  const answersByQuestion = new Map<string, AnswerRow>(
    ((answerRows ?? []) as AnswerRow[]).map((answer) => [answer.session_question_id, answer]),
  );
  const revealFeedback = typedSession.mode === "practice" || typedSession.status === "completed";

  const questions = ((questionRows ?? []) as SessionQuestionRow[]).map((row) => {
    const answer = answersByQuestion.get(row.id);
    let feedback: PracticeFeedback | null = null;
    if (answer && revealFeedback) {
      feedback = {
        isCorrect: answer.is_correct,
        correctOptionKey: asOptionKey(row.correct_option_key),
        explanation: row.explanation,
      };
    }

    return {
      id: row.id,
      revision: revisions.get(row.id) ?? 0,
      position: row.position,
      question: asStudentQuestion(row.student_snapshot),
      selectedOptionKey: answer ? asOptionKey(answer.selected_option_key) : null,
      feedback,
    };
  });

  return {
    id: typedSession.id,
    userId, serverNow: Date.now(),
    mode: typedSession.mode,
    status: typedSession.status,
    subjectName: subject.name,
    subjectSlug: subject.slug,
    topicName: topic?.name ?? null,
    topicSlug: topic?.slug ?? null,
    difficulty: typedSession.difficulty,
    year: typedSession.year_filter,
    requestedCount: typedSession.requested_count,
    questionCount: typedSession.question_count,
    answeredCount: typedSession.answered_count,
    /*
     * Withheld under exactly the rule that governs per-question feedback.
     *
     * A running correct count is an answer key in aggregate: during a timed
     * session a student could answer one question, reload, and read off whether
     * it was right — the very thing `feedback` is withheld to prevent. It is
     * null rather than 0 so the client can tell "not available yet" from a
     * genuine score of zero.
     */
    correctCount: revealFeedback ? typedSession.correct_count : null,
    sourceProvider: typedSession.source_provider,
    startedAt: typedSession.started_at,
    expiresAt: typedSession.expires_at,
    completedAt: typedSession.completed_at,
    questions,
  };
}

export async function savePracticeAnswerForUser(
  userId: string,
  sessionId: string,
  sessionQuestionId: string,
  selectedOptionKey: QuestionOption["key"],
  expectedRevision: number, mutationId: string,
): Promise<SavePracticeAnswerResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("save_response_v2", {
    p_kind: "practice", p_is_flagged: false, p_expected_revision: expectedRevision, p_mutation_id: mutationId,
    p_user_id: userId,
    p_session_id: sessionId,
    p_question_id: sessionQuestionId,
    p_selected_option_key: selectedOptionKey,
  });

  if (error) throw new Error(error.message);
  const result = data as unknown as Database["public"]["Functions"]["save_practice_answer"]["Returns"][number] & { revision: number; mutation_id: string };
  if (!result) throw new Error("The answer could not be saved.");

  const response: SavePracticeAnswerResult = {
    revision: result.revision, mutationId: result.mutation_id, serverNow: Date.now(), isFlagged: false,
    selectedOptionKey: asOptionKey(result.selected_option_key),
    answeredCount: result.answered_count,
    questionCount: result.question_count,
  };

  if (result.mode === "practice") {
    response.feedback = {
      isCorrect: result.is_correct,
      correctOptionKey: asOptionKey(result.correct_option_key),
      explanation: result.explanation,
    };
  }

  return response;
}

export async function completePracticeSessionForUser(
  userId: string,
  sessionId: string,
): Promise<CompletePracticeSessionResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("complete_practice_session", {
    p_user_id: userId,
    p_session_id: sessionId,
  });

  if (error) throw new Error(error.message);
  const result = data?.[0];
  if (!result || result.status !== "completed" || !result.completed_at) {
    throw new Error("The practice session could not be completed.");
  }

  return {
    sessionId: result.session_id,
    status: "completed",
    answeredCount: result.answered_count,
    correctCount: result.correct_count,
    questionCount: result.question_count,
    completedAt: result.completed_at,
  };
}

export async function getLatestActivePracticeSessionForUser(userId: string): Promise<{
  id: string;
  subjectName: string;
  mode: PracticeMode;
  answeredCount: number;
  questionCount: number;
} | null> {
  const admin = createAdminClient();
  const { data: session, error } = await admin
    .from("practice_sessions")
    .select("id, subject_id, mode, answered_count, question_count")
    .eq("user_id", userId)
    .eq("status", "in_progress")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Could not check for an active practice session: ${error.message}`);
  if (!session) return null;

  const { data: subject, error: subjectError } = await admin
    .from("subjects")
    .select("name")
    .eq("id", session.subject_id)
    .maybeSingle();
  if (subjectError || !subject) throw new Error("Could not load the active practice subject.");

  return {
    id: session.id,
    subjectName: subject.name,
    mode: session.mode,
    answeredCount: session.answered_count,
    questionCount: session.question_count,
  };
}
