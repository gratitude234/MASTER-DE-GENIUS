import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";
import type { QuestionOption } from "@/types/domain";
import type { CanonicalQuestion, QuestionQuery } from "@/features/questions/types";
import type { QuestionProvider } from "@/features/questions/providers/types";

const OPTION_KEYS = new Set<QuestionOption["key"]>(["A", "B", "C", "D", "E"]);

function assertOptionKey(value: string): QuestionOption["key"] {
  if (!OPTION_KEYS.has(value as QuestionOption["key"])) {
    throw new Error(`Invalid option key returned by the internal question store: ${value}`);
  }
  return value as QuestionOption["key"];
}

function shuffled<T>(items: T[]): T[] {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(Math.random() * (index + 1));
    [output[index], output[swapWith]] = [output[swapWith], output[index]];
  }
  return output;
}

type QuestionRow = Database["public"]["Tables"]["questions"]["Row"];
type OptionRow = Database["public"]["Tables"]["question_options"]["Row"];
type AssetRow = Database["public"]["Tables"]["question_assets"]["Row"];

export class InternalQuestionProvider implements QuestionProvider {
  readonly id = "internal" as const;
  readonly capabilities = {
    years: true,
    topics: true,
    difficulty: true,
    passages: true,
    assets: true,
    explanations: true,
  } as const;

  async fetchQuestions(query: QuestionQuery): Promise<CanonicalQuestion[]> {
    const supabase = createAdminClient();

    const { data: exam, error: examError } = await supabase
      .from("exam_bodies")
      .select("id, code")
      .eq("code", query.examBody)
      .eq("is_active", true)
      .maybeSingle();

    if (examError) throw new Error(`Could not resolve exam body: ${examError.message}`);
    if (!exam) return [];

    const { data: subject, error: subjectError } = await supabase
      .from("subjects")
      .select("id, slug, name")
      .eq("slug", query.subjectSlug)
      .eq("is_active", true)
      .maybeSingle();

    if (subjectError) throw new Error(`Could not resolve subject: ${subjectError.message}`);
    if (!subject) return [];

    let topic: Database["public"]["Tables"]["topics"]["Row"] | null = null;
    if (query.topicSlug) {
      const { data, error } = await supabase
        .from("topics")
        .select("*")
        .eq("subject_id", subject.id)
        .eq("slug", query.topicSlug)
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw new Error(`Could not resolve topic: ${error.message}`);
      if (!data) return [];
      topic = data;
    }

    const candidateLimit = Math.min(Math.max(query.count * 5, query.count), 250);
    let questionQuery = supabase
      .from("questions")
      .select("*")
      .eq("exam_body_id", exam.id)
      .eq("subject_id", subject.id)
      .eq("status", "active")
      .limit(candidateLimit);

    if (topic) questionQuery = questionQuery.eq("topic_id", topic.id);
    if (query.year != null) questionQuery = questionQuery.eq("year", query.year);
    if (query.difficulty) questionQuery = questionQuery.eq("difficulty", query.difficulty);
    const { data: candidateRows, error: questionError } = await questionQuery;
    if (questionError) throw new Error(`Could not load questions: ${questionError.message}`);

    const excluded = new Set(query.excludeSourceIds ?? []);
    const eligibleRows = ((candidateRows ?? []) as QuestionRow[]).filter((row) => {
      const sourceId = row.source_question_id ?? row.id;
      return !excluded.has(sourceId);
    });
    const selectedRows = shuffled(eligibleRows).slice(0, query.count);
    if (selectedRows.length === 0) return [];

    const questionIds = selectedRows.map((row) => row.id);
    const passageIds = selectedRows.map((row) => row.passage_id).filter((id): id is string => Boolean(id));
    const topicIds = selectedRows.map((row) => row.topic_id).filter((id): id is string => Boolean(id));

    const [
      { data: optionRows, error: optionError },
      { data: assetRows, error: assetError },
      { data: selectedTopicRows, error: selectedTopicError },
    ] = await Promise.all([
      supabase
        .from("question_options")
        .select("*")
        .in("question_id", questionIds)
        .order("display_order"),
      supabase
        .from("question_assets")
        .select("*")
        .in("question_id", questionIds)
        .order("display_order"),
      topicIds.length
        ? supabase.from("topics").select("id, subject_id, slug, name").in("id", topicIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (optionError) throw new Error(`Could not load question options: ${optionError.message}`);
    if (assetError) throw new Error(`Could not load question assets: ${assetError.message}`);
    if (selectedTopicError) throw new Error(`Could not load question topics: ${selectedTopicError.message}`);

    const { data: passageRows, error: passageError } = passageIds.length
      ? await supabase.from("question_passages").select("id, title, body").in("id", passageIds)
      : { data: [], error: null };
    if (passageError) throw new Error(`Could not load passages: ${passageError.message}`);

    const optionsByQuestion = new Map<string, OptionRow[]>();
    for (const option of (optionRows ?? []) as OptionRow[]) {
      const list = optionsByQuestion.get(option.question_id) ?? [];
      list.push(option);
      optionsByQuestion.set(option.question_id, list);
    }

    const assetsByQuestion = new Map<string, AssetRow[]>();
    for (const asset of (assetRows ?? []) as AssetRow[]) {
      const list = assetsByQuestion.get(asset.question_id) ?? [];
      list.push(asset);
      assetsByQuestion.set(asset.question_id, list);
    }

    const passageById = new Map((passageRows ?? []).map((passage) => [passage.id, passage]));
    const topicById = new Map((selectedTopicRows ?? []).map((item) => [item.id, item]));

    return selectedRows.map((row) => {
      const options = (optionsByQuestion.get(row.id) ?? []).map((option) => ({
        id: option.id,
        key: assertOptionKey(option.option_key),
        text: option.option_text,
      }));

      if (options.length < 2) {
        throw new Error(`Active question ${row.id} has an invalid option set.`);
      }

      const passage = row.passage_id ? passageById.get(row.passage_id) : null;
      return {
        id: row.id,
        source: {
          provider: row.source_provider,
          providerQuestionId: row.source_question_id ?? row.id,
          internalQuestionId: row.id,
        },
        examBody: query.examBody,
        subject,
        topic: row.topic_id && topicById.get(row.topic_id)
          ? {
              id: topicById.get(row.topic_id)!.id,
              subjectId: topicById.get(row.topic_id)!.subject_id,
              name: topicById.get(row.topic_id)!.name,
              slug: topicById.get(row.topic_id)!.slug,
            }
          : null,
        year: row.year,
        prompt: row.question_text,
        passage: passage
          ? { id: passage.id, title: passage.title, body: passage.body }
          : null,
        assets: (assetsByQuestion.get(row.id) ?? []).map((asset) => ({
          id: asset.id,
          kind: asset.kind,
          url: asset.url,
          altText: asset.alt_text,
          caption: asset.caption,
        })),
        options,
        correctOptionKey: assertOptionKey(row.correct_option_key),
        explanation: row.explanation,
        difficulty: row.difficulty,
      } satisfies CanonicalQuestion;
    });
  }
}
