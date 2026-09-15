import "server-only";

import { displayName, loadDirectory } from "@/features/admin/directory";
import type { StudentQuestion } from "@/features/questions/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

export const QUESTION_PAGE_SIZE = 30;
export const QUESTION_STATUSES = ["draft", "pending_review", "active", "flagged", "disabled"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export interface QuestionCatalog {
  exams: { id: string; code: string; name: string }[];
  subjects: { id: string; slug: string; name: string; examIds: string[] }[];
  topics: { id: string; subjectId: string; name: string }[];
}

/** Exams, the subjects each offers, and topics — for filters and the editor. */
export async function loadQuestionCatalog(): Promise<QuestionCatalog> {
  const db = createAdminClient();
  const [exams, links, subjects, topics] = await Promise.all([
    db.from("exam_bodies").select("id, code, short_name").eq("is_active", true).order("short_name"),
    db.from("exam_subjects").select("exam_body_id, subject_id"),
    db.from("subjects").select("id, slug, name").eq("is_active", true).order("name"),
    db.from("topics").select("id, subject_id, name, display_order").eq("is_active", true).order("display_order"),
  ]);
  if (exams.error || links.error || subjects.error || topics.error) throw new Error("Could not load the question catalogue.");

  const examIds = new Set((exams.data ?? []).map((exam) => exam.id));
  const examsBySubject = new Map<string, string[]>();
  for (const link of links.data ?? []) {
    if (!examIds.has(link.exam_body_id)) continue;
    examsBySubject.set(link.subject_id, [...(examsBySubject.get(link.subject_id) ?? []), link.exam_body_id]);
  }

  return {
    exams: (exams.data ?? []).map((exam) => ({ id: exam.id, code: exam.code, name: exam.short_name })),
    subjects: (subjects.data ?? [])
      .filter((subject) => examsBySubject.has(subject.id))
      .map((subject) => ({ ...subject, examIds: examsBySubject.get(subject.id) ?? [] })),
    topics: (topics.data ?? []).map((topic) => ({ id: topic.id, subjectId: topic.subject_id, name: topic.name })),
  };
}

export interface InternalQuestionFilters {
  exam?: string;
  subject?: string;
  status?: QuestionStatus;
  year?: number;
  search?: string;
}

export async function listInternalQuestions(catalog: QuestionCatalog, filters: InternalQuestionFilters, page: number) {
  let query = createAdminClient()
    .from("questions")
    .select("id, exam_body_id, subject_id, topic_id, year, status, difficulty, question_text, source_provider, updated_at", { count: "exact" })
    .order("updated_at", { ascending: false });

  const exam = catalog.exams.find((item) => item.code === filters.exam);
  const subject = catalog.subjects.find((item) => item.slug === filters.subject);
  if (filters.exam && !exam) return { rows: [], total: 0, page, pageCount: 1 };
  if (filters.subject && !subject) return { rows: [], total: 0, page, pageCount: 1 };
  if (exam) query = query.eq("exam_body_id", exam.id);
  if (subject) query = query.eq("subject_id", subject.id);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.year) query = query.eq("year", filters.year);
  if (filters.search) {
    const safe = filters.search.replace(/[%_\\]/g, "").slice(0, 120);
    if (safe) query = query.ilike("question_text", `%${safe}%`);
  }

  const start = (page - 1) * QUESTION_PAGE_SIZE;
  const { data, error, count } = await query.range(start, start + QUESTION_PAGE_SIZE - 1);
  if (error) throw new Error("Could not load questions.");

  const examName = new Map(catalog.exams.map((item) => [item.id, item.name]));
  const subjectName = new Map(catalog.subjects.map((item) => [item.id, item.name]));
  const topicName = new Map(catalog.topics.map((item) => [item.id, item.name]));
  const total = count ?? 0;
  return {
    rows: (data ?? []).map((row) => ({
      ...row,
      examName: examName.get(row.exam_body_id) ?? "—",
      subjectName: subjectName.get(row.subject_id) ?? "—",
      topicName: row.topic_id ? topicName.get(row.topic_id) ?? null : null,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / QUESTION_PAGE_SIZE)),
  };
}

export interface InternalQuestionDetail {
  question: Database["public"]["Tables"]["questions"]["Row"];
  options: { key: string; text: string }[];
  passageTitle: string | null;
  assetCount: number;
  timesServed: number;
  createdBy: string | null;
}

export async function loadInternalQuestion(actorId: string, id: string): Promise<InternalQuestionDetail | null> {
  const db = createAdminClient();
  const { data: question, error } = await db.from("questions").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("Could not load the question.");
  if (!question) return null;

  const [options, assets, passage, practiceUses, mockUses, directory] = await Promise.all([
    db.from("question_options").select("option_key, option_text").eq("question_id", id).order("display_order"),
    db.from("question_assets").select("id", { count: "exact", head: true }).eq("question_id", id),
    question.passage_id ? db.from("question_passages").select("title").eq("id", question.passage_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("practice_session_questions").select("id", { count: "exact", head: true }).eq("internal_question_id", id),
    db.from("exam_attempt_questions").select("id", { count: "exact", head: true }).eq("internal_question_id", id),
    loadDirectory(actorId, [question.created_by]),
  ]);
  if (options.error) throw new Error("Could not load the question options.");

  return {
    question,
    options: (options.data ?? []).map((option) => ({ key: option.option_key, text: option.option_text })),
    passageTitle: passage.data ? passage.data.title ?? "Untitled passage" : null,
    assetCount: assets.count ?? 0,
    timesServed: (practiceUses.count ?? 0) + (mockUses.count ?? 0),
    createdBy: question.created_by ? displayName(directory.get(question.created_by), "Former admin") : null,
  };
}

export const BLOCK_PAGE_SIZE = 30;

export async function listQuestionBlocks(actorId: string, state: "active" | "lifted", page: number) {
  let query = createAdminClient()
    .from("question_blocks")
    .select("*", { count: "exact" })
    .order(state === "active" ? "created_at" : "lifted_at", { ascending: false });
  query = state === "active" ? query.is("lifted_at", null) : query.not("lifted_at", "is", null);

  const start = (page - 1) * BLOCK_PAGE_SIZE;
  const { data, error, count } = await query.range(start, start + BLOCK_PAGE_SIZE - 1);
  if (error) throw new Error("Could not load blocked questions.");

  const directory = await loadDirectory(actorId, (data ?? []).flatMap((row) => [row.blocked_by, row.lifted_by]));
  const total = count ?? 0;
  return {
    rows: (data ?? []).map((row) => ({
      ...row,
      blockedByName: row.blocked_by ? displayName(directory.get(row.blocked_by), "Former admin") : "Unknown",
      liftedByName: row.lifted_by ? displayName(directory.get(row.lifted_by), "Former admin") : null,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / BLOCK_PAGE_SIZE)),
  };
}

export interface ExternalQuestionKey {
  provider: string;
  exam: string;
  subject: string;
  sourceQuestionId: string;
}

export interface ExternalQuestionInspection {
  question: StudentQuestion;
  correctOptionKey: string;
  explanation: string | null;
  lastServedAt: string;
  activeBlock: { id: string; reason: string; createdAt: string } | null;
}

/**
 * Shows an external question exactly as Master De Genius froze it into a
 * session. The provider is never called: inspection costs no credits and
 * reflects what students actually saw.
 */
export async function inspectExternalQuestion(key: ExternalQuestionKey): Promise<ExternalQuestionInspection | null> {
  const db = createAdminClient();
  const [practice, mock, block] = await Promise.all([
    db.from("practice_session_questions").select("student_snapshot, correct_option_key, explanation, created_at")
      .eq("source_provider", key.provider).eq("source_question_id", key.sourceQuestionId)
      .order("created_at", { ascending: false }).limit(25),
    db.from("exam_attempt_questions").select("student_snapshot, correct_option_key, explanation, created_at")
      .eq("source_provider", key.provider).eq("source_question_id", key.sourceQuestionId)
      .order("created_at", { ascending: false }).limit(25),
    db.from("question_blocks").select("id, reason, created_at")
      .eq("source_provider", key.provider).eq("exam_code", key.exam).eq("subject_slug", key.subject)
      .eq("source_question_id", key.sourceQuestionId).is("lifted_at", null).maybeSingle(),
  ]);
  if (practice.error || mock.error || block.error) throw new Error("Could not inspect the question.");

  // Providers reuse ids across subjects, so only snapshots for this exam and
  // subject count as the same question.
  const match = [...(practice.data ?? []), ...(mock.data ?? [])]
    .filter((row) => {
      const snapshot = row.student_snapshot as Partial<StudentQuestion> | null;
      return snapshot?.examBody === key.exam && snapshot?.subject?.slug === key.subject;
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  if (!match) return null;
  return {
    question: match.student_snapshot as unknown as StudentQuestion,
    correctOptionKey: match.correct_option_key,
    explanation: match.explanation,
    lastServedAt: match.created_at,
    activeBlock: block.data ? { id: block.data.id, reason: block.data.reason, createdAt: block.data.created_at } : null,
  };
}
