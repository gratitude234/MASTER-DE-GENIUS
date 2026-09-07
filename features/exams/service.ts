import "server-only";
import { getRevisions } from "@/features/offline/server";

import { toStudentQuestion } from "@/features/questions/delivery";
import { fetchCanonicalQuestions, isSubjectAvailable } from "@/features/questions/service";
import type { StudentQuestion } from "@/features/questions/types";
import type {
  ActiveExamAttemptSummary,
  CreateMockAttemptResult,
  ExamAttemptView,
  ExamSubmissionReason,
  MockExamSetup,
  SaveExamResponseResult,
  SubmitExamAttemptResult,
} from "@/features/exams/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";
import type { ExamBody, QuestionOption } from "@/types/domain";

const EXAM_CODES = new Set<ExamBody>(["jamb", "waec", "neco", "post_utme", "school"]);
const OPTION_KEYS = new Set<QuestionOption["key"]>(["A", "B", "C", "D", "E"]);

type AttemptRow = Database["public"]["Tables"]["exam_attempts"]["Row"];
type AttemptSubjectRow = Database["public"]["Tables"]["exam_attempt_subjects"]["Row"];
type AttemptQuestionRow = Database["public"]["Tables"]["exam_attempt_questions"]["Row"];
type AttemptAnswerRow = Database["public"]["Tables"]["exam_attempt_answers"]["Row"];

function asExamBody(value: string): ExamBody {
  if (!EXAM_CODES.has(value as ExamBody)) throw new Error(`Unsupported exam body: ${value}`);
  return value as ExamBody;
}

function asOptionKey(value: string | null): QuestionOption["key"] | null {
  if (value == null) return null;
  if (!OPTION_KEYS.has(value as QuestionOption["key"])) throw new Error("Stored answer option is invalid.");
  return value as QuestionOption["key"];
}

function asStudentQuestion(value: Json): StudentQuestion {
  return value as unknown as StudentQuestion;
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function isUniqueViolation(error: { code?: string | null } | null) {
  return error?.code === "23505";
}

async function assertOnboardedUser(userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("onboarding_completed")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error(`Could not verify your profile: ${error.message}`);
  if (!data?.onboarding_completed) throw new Error("Finish onboarding before starting a mock exam.");
}

async function loadPrimaryPreference(userId: string) {
  const admin = createAdminClient();
  const { data: preference, error } = await admin
    .from("student_exam_preferences")
    .select("id, exam_body_id, exam_year")
    .eq("user_id", userId)
    .eq("is_primary", true)
    .maybeSingle();

  if (error || !preference) throw new Error("Your primary exam preference is not available.");
  return preference;
}

export async function getActiveExamAttemptSummaryForUser(
  userId: string,
  examBodyId?: string,
): Promise<ActiveExamAttemptSummary | null> {
  const admin = createAdminClient();
  let query = admin
    .from("exam_attempts")
    .select("id, exam_body_id, status, answered_count, flagged_count, total_questions, started_at, expires_at, created_at")
    .eq("user_id", userId)
    .in("status", ["created", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (examBodyId) query = query.eq("exam_body_id", examBodyId);

  const { data: attempt, error } = await query.maybeSingle();
  if (error) throw new Error(`Could not check for an active exam: ${error.message}`);
  if (!attempt || !attempt.started_at || !attempt.expires_at) return null;

  if (new Date(attempt.expires_at).getTime() <= Date.now()) {
    await submitExamAttemptForUser(userId, attempt.id, "time_expired");
    return null;
  }

  const { data: exam, error: examError } = await admin
    .from("exam_bodies")
    .select("short_name")
    .eq("id", attempt.exam_body_id)
    .single();
  if (examError) throw new Error(`Could not load exam details: ${examError.message}`);

  return {
    id: attempt.id,
    examName: exam.short_name,
    status: attempt.status,
    answeredCount: attempt.answered_count,
    flaggedCount: attempt.flagged_count,
    totalQuestions: attempt.total_questions,
    startedAt: attempt.started_at,
    expiresAt: attempt.expires_at,
  };
}

export async function loadMockExamSetupForUser(userId: string): Promise<MockExamSetup> {
  await assertOnboardedUser(userId);
  const admin = createAdminClient();
  const preference = await loadPrimaryPreference(userId);

  const [{ data: exam, error: examError }, { data: blueprint, error: blueprintError }, { data: selectedLinks, error: linksError }] = await Promise.all([
    admin.from("exam_bodies").select("id, code, short_name").eq("id", preference.exam_body_id).eq("is_active", true).maybeSingle(),
    admin.from("exam_blueprints").select("*").eq("exam_body_id", preference.exam_body_id).eq("code", "full_mock").eq("is_active", true).maybeSingle(),
    admin.from("student_subject_preferences").select("subject_id, display_order").eq("preference_id", preference.id).order("display_order"),
  ]);

  if (examError || !exam) throw new Error("Could not resolve your exam body.");
  if (blueprintError || !blueprint) throw new Error("A full mock blueprint is not configured for your exam yet.");
  if (linksError) throw new Error(`Could not load your selected subjects: ${linksError.message}`);

  if ((selectedLinks ?? []).length !== blueprint.expected_subject_count) {
    throw new Error(`Your exam setup must contain exactly ${blueprint.expected_subject_count} subjects before starting this mock.`);
  }

  const subjectIds = (selectedLinks ?? []).map((item) => item.subject_id);
  const [{ data: subjectRows, error: subjectError }, { data: overrides, error: overrideError }] = await Promise.all([
    admin.from("subjects").select("id, slug, name").in("id", subjectIds),
    admin.from("exam_blueprint_subject_overrides").select("subject_id, question_count").eq("blueprint_id", blueprint.id),
  ]);
  if (subjectError) throw new Error(`Could not load exam subjects: ${subjectError.message}`);
  if (overrideError) throw new Error(`Could not load exam blueprint rules: ${overrideError.message}`);

  const subjectById = new Map((subjectRows ?? []).map((subject) => [subject.id, subject]));
  const overrideBySubject = new Map((overrides ?? []).map((item) => [item.subject_id, item.question_count]));
  const subjects = (selectedLinks ?? []).map((link) => {
    const subject = subjectById.get(link.subject_id);
    if (!subject) throw new Error("One of your selected subjects is no longer available.");
    return {
      id: subject.id,
      slug: subject.slug,
      name: subject.name,
      displayOrder: link.display_order,
      questionCount: overrideBySubject.get(subject.id) ?? blueprint.default_question_count,
      // Surfaced so the UI never offers a paper the active source cannot build.
      available: isSubjectAvailable(asExamBody(exam.code), subject.slug, process.env.QUESTION_PROVIDER?.trim() || "internal"),
    };
  });

  const activeAttempt = await getActiveExamAttemptSummaryForUser(userId, exam.id);

  return {
    blueprintId: blueprint.id,
    blueprintCode: blueprint.code,
    blueprintName: blueprint.name,
    examBodyId: exam.id,
    examBody: asExamBody(exam.code),
    examName: exam.short_name,
    examYear: preference.exam_year,
    durationSeconds: blueprint.duration_seconds,
    totalQuestions: subjects.reduce((total, subject) => total + subject.questionCount, 0),
    subjects,
    activeAttempt,
  };
}

export async function createMockExamAttemptForUser(userId: string): Promise<CreateMockAttemptResult> {
  const setup = await loadMockExamSetupForUser(userId);
  if (setup.activeAttempt) {
    return { attemptId: setup.activeAttempt.id, resumed: true, totalQuestions: setup.activeAttempt.totalQuestions };
  }

  const provider = process.env.QUESTION_PROVIDER?.trim() || "internal";
  const questionBatches = await Promise.all(
    setup.subjects.map(async (subject) => {
      const questions = await fetchCanonicalQuestions({
        examBody: setup.examBody,
        subjectSlug: subject.slug,
        count: subject.questionCount,
        requestType: "mock",
      }, provider);

      if (questions.length !== subject.questionCount) {
        throw new Error(`MOCK_INVENTORY_SHORTAGE|${subject.name}|${subject.questionCount}|${questions.length}`);
      }

      return {
        subjectId: subject.id,
        displayOrder: subject.displayOrder,
        questionCount: subject.questionCount,
        questions: questions.map((question) => ({
          sourceProvider: question.source.provider,
          sourceQuestionId: question.source.providerQuestionId,
          internalQuestionId: question.source.internalQuestionId ?? null,
          studentSnapshot: toStudentQuestion(question),
          correctOptionKey: question.correctOptionKey,
          explanation: question.explanation ?? null,
        })),
      };
    }),
  );

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("create_exam_attempt", {
    p_user_id: userId,
    p_exam_body_id: setup.examBodyId,
    p_blueprint_id: setup.blueprintId,
    p_exam_year: setup.examYear,
    p_provider: provider,
    p_duration_seconds: setup.durationSeconds,
    p_subjects: toJson(questionBatches),
  });

  if (error) {
    if (isUniqueViolation(error)) {
      const active = await getActiveExamAttemptSummaryForUser(userId, setup.examBodyId);
      if (active) return { attemptId: active.id, resumed: true, totalQuestions: active.totalQuestions };
    }
    throw new Error(`Could not create mock exam: ${error.message}`);
  }
  if (!data) throw new Error("Could not create mock exam.");

  return { attemptId: data, resumed: false, totalQuestions: setup.totalQuestions };
}

export async function loadExamAttemptForUser(userId: string, attemptId: string): Promise<ExamAttemptView | null> {
  const admin = createAdminClient();
  const { data: initialAttempt, error: attemptError } = await admin
    .from("exam_attempts")
    .select("*")
    .eq("id", attemptId)
    .eq("user_id", userId)
    .maybeSingle();

  let attempt = initialAttempt;
  if (attemptError) throw new Error(`Could not load exam attempt: ${attemptError.message}`);
  if (!attempt) return null;

  let typedAttempt = attempt as AttemptRow;
  if (typedAttempt.status === "in_progress" && typedAttempt.expires_at && new Date(typedAttempt.expires_at).getTime() <= Date.now()) {
    await submitExamAttemptForUser(userId, attemptId, "time_expired");
    const refreshed = await admin.from("exam_attempts").select("*").eq("id", attemptId).eq("user_id", userId).single();
    if (refreshed.error) throw new Error(`Could not refresh submitted exam: ${refreshed.error.message}`);
    attempt = refreshed.data;
    typedAttempt = attempt as AttemptRow;
  }

  const [
    { data: exam, error: examError },
    { data: blueprint, error: blueprintError },
    { data: subjectRows, error: attemptSubjectsError },
    { data: questionRows, error: questionError },
    { data: answerRows, error: answerError },
  ] = await Promise.all([
    admin.from("exam_bodies").select("code, short_name").eq("id", typedAttempt.exam_body_id).single(),
    admin.from("exam_blueprints").select("name").eq("id", typedAttempt.blueprint_id).single(),
    admin.from("exam_attempt_subjects").select("*").eq("attempt_id", attemptId).order("display_order"),
    admin.from("exam_attempt_questions").select("*").eq("attempt_id", attemptId).order("overall_position"),
    admin.from("exam_attempt_answers").select("*").eq("attempt_id", attemptId),
  ]);

  if (examError) throw new Error(`Could not load exam details: ${examError.message}`);
  if (blueprintError) throw new Error(`Could not load mock blueprint: ${blueprintError.message}`);
  if (attemptSubjectsError) throw new Error(`Could not load exam subjects: ${attemptSubjectsError.message}`);
  if (questionError) throw new Error(`Could not load exam questions: ${questionError.message}`);
  if (answerError) throw new Error(`Could not load saved answers: ${answerError.message}`);

  const revisions = await getRevisions(userId, "exam", attemptId);
  const typedSubjects = (subjectRows ?? []) as AttemptSubjectRow[];
  const typedQuestions = (questionRows ?? []) as AttemptQuestionRow[];
  const typedAnswers = (answerRows ?? []) as AttemptAnswerRow[];
  const subjectIds = typedSubjects.map((subject) => subject.subject_id);
  const { data: subjects, error: subjectMetaError } = subjectIds.length
    ? await admin.from("subjects").select("id, slug, name").in("id", subjectIds)
    : { data: [], error: null };
  if (subjectMetaError) throw new Error(`Could not load subject names: ${subjectMetaError.message}`);

  const subjectMeta = new Map((subjects ?? []).map((subject) => [subject.id, subject]));
  const answerByQuestion = new Map(typedAnswers.map((answer) => [answer.attempt_question_id, answer]));
  const questionsByAttemptSubject = new Map<string, AttemptQuestionRow[]>();
  for (const question of typedQuestions) {
    const list = questionsByAttemptSubject.get(question.attempt_subject_id) ?? [];
    list.push(question);
    questionsByAttemptSubject.set(question.attempt_subject_id, list);
  }

  return {
    id: typedAttempt.id,
    userId, serverNow: Date.now(),
    examBody: asExamBody(exam.code),
    examName: exam.short_name,
    blueprintName: blueprint.name,
    examYear: typedAttempt.exam_year,
    status: typedAttempt.status,
    sourceProvider: typedAttempt.source_provider,
    durationSeconds: typedAttempt.duration_seconds,
    totalQuestions: typedAttempt.total_questions,
    answeredCount: typedAttempt.answered_count,
    flaggedCount: typedAttempt.flagged_count,
    startedAt: typedAttempt.started_at!,
    expiresAt: typedAttempt.expires_at!,
    submittedAt: typedAttempt.submitted_at,
    submissionReason: typedAttempt.submission_reason,
    subjects: typedSubjects.map((attemptSubject) => {
      const meta = subjectMeta.get(attemptSubject.subject_id);
      if (!meta) throw new Error("Exam subject metadata is missing.");
      return {
        id: attemptSubject.id,
        subjectId: attemptSubject.subject_id,
        slug: meta.slug,
        name: meta.name,
        displayOrder: attemptSubject.display_order,
        questionCount: attemptSubject.question_count,
        answeredCount: attemptSubject.answered_count,
        flaggedCount: attemptSubject.flagged_count,
        questions: (questionsByAttemptSubject.get(attemptSubject.id) ?? [])
          .sort((a, b) => a.subject_position - b.subject_position)
          .map((questionRow) => {
            const answer = answerByQuestion.get(questionRow.id);
            return {
              id: questionRow.id,
              revision: revisions.get(questionRow.id) ?? 0,
              subjectId: questionRow.subject_id,
              subjectPosition: questionRow.subject_position,
              overallPosition: questionRow.overall_position,
              question: asStudentQuestion(questionRow.student_snapshot),
              selectedOptionKey: asOptionKey(answer?.selected_option_key ?? null),
              isFlagged: answer?.is_flagged ?? false,
            };
          }),
      };
    }),
  };
}

export async function saveExamResponseForUser(
  userId: string,
  attemptId: string,
  attemptQuestionId: string,
  selectedOptionKey: QuestionOption["key"] | null,
  isFlagged: boolean,
  expectedRevision: number, mutationId: string,
): Promise<SaveExamResponseResult> {
  if (selectedOptionKey != null && !OPTION_KEYS.has(selectedOptionKey)) throw new Error("Invalid answer option.");
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("save_response_v2", {
    p_kind: "exam", p_expected_revision: expectedRevision, p_mutation_id: mutationId,
    p_user_id: userId,
    p_session_id: attemptId,
    p_question_id: attemptQuestionId,
    p_selected_option_key: selectedOptionKey,
    p_is_flagged: isFlagged,
  });

  if (error) throw new Error(error.message);
  const result = data as unknown as Database["public"]["Functions"]["save_exam_response"]["Returns"][number] & { revision: number; mutation_id: string };
  if (!result || !result.expires_at) throw new Error("Could not save exam response.");

  return {
    revision: result.revision, mutationId: result.mutation_id, serverNow: Date.now(),
    selectedOptionKey: asOptionKey(result.selected_option_key),
    isFlagged: result.is_flagged,
    answeredCount: result.answered_count,
    flaggedCount: result.flagged_count,
    totalQuestions: result.total_questions,
    expiresAt: result.expires_at,
  };
}

export async function submitExamAttemptForUser(
  userId: string,
  attemptId: string,
  reason: ExamSubmissionReason,
): Promise<SubmitExamAttemptResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("submit_exam_attempt", {
    p_user_id: userId,
    p_attempt_id: attemptId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  const result = data?.[0];
  if (!result || result.status !== "submitted" || !result.submitted_at || !result.submission_reason) {
    throw new Error("Could not submit exam.");
  }

  return {
    attemptId: result.attempt_id,
    status: "submitted",
    answeredCount: result.answered_count,
    flaggedCount: result.flagged_count,
    totalQuestions: result.total_questions,
    submittedAt: result.submitted_at,
    submissionReason: result.submission_reason,
  };
}
