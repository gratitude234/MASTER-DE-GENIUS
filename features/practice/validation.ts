import { PRACTICE_MAX_QUESTIONS } from "@/features/billing/plans";
import type { CreatePracticeSessionInput, PracticeMode } from "@/features/practice/types";
import type { QuestionDifficulty, QuestionOption } from "@/types/domain";

const DIFFICULTIES = new Set<QuestionDifficulty>(["easy", "medium", "hard"]);
const OPTION_KEYS = new Set<QuestionOption["key"]>(["A", "B", "C", "D", "E"]);
const MODES = new Set<PracticeMode>(["practice", "timed"]);

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseCreatePracticeSessionInput(value: unknown): CreatePracticeSessionInput {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid practice session request.");
  }

  const body = value as Record<string, unknown>;
  const examBody = body.examBody;
  if (examBody !== undefined && examBody !== "jamb" && examBody !== "waec") throw new Error("Choose a supported exam.");
  const subjectSlug = readString(body.subjectSlug);
  const topicSlugRaw = readString(body.topicSlug);
  const mode = readString(body.mode) as PracticeMode | null;
  const count = typeof body.count === "number" ? body.count : Number(body.count);
  const difficultyRaw = readString(body.difficulty);
  const yearRaw = body.year == null || body.year === "" ? null : Number(body.year);

  if (!subjectSlug || !/^[a-z0-9-]+$/.test(subjectSlug)) {
    throw new Error("Choose a valid subject.");
  }
  if (topicSlugRaw && topicSlugRaw !== "all" && !/^[a-z0-9-]+$/.test(topicSlugRaw)) {
    throw new Error("Choose a valid topic.");
  }
  if (!mode || !MODES.has(mode)) {
    throw new Error("Choose a valid practice mode.");
  }
  /*
   * The absolute ceiling, not this student's. The plan's own
   * `maxQuestionsPerSession` clamps the request on the server afterwards, so a
   * Free request for 40 builds the 20 the plan allows rather than being
   * refused — validation is about a well-formed request, not about what this
   * particular student is entitled to.
   */
  if (!Number.isInteger(count) || count < 1 || count > PRACTICE_MAX_QUESTIONS) {
    throw new Error(`Practice sessions can contain between 1 and ${PRACTICE_MAX_QUESTIONS} questions.`);
  }

  let difficulty: QuestionDifficulty | null = null;
  if (difficultyRaw && difficultyRaw !== "mixed") {
    if (!DIFFICULTIES.has(difficultyRaw as QuestionDifficulty)) {
      throw new Error("Choose a valid difficulty.");
    }
    difficulty = difficultyRaw as QuestionDifficulty;
  }

  let year: number | null = null;
  if (yearRaw != null) {
    if (!Number.isInteger(yearRaw) || yearRaw < 1960 || yearRaw > 2100) {
      throw new Error("Choose a valid exam year.");
    }
    year = yearRaw;
  }

  return {
    ...(examBody ? { examBody } : {}),
    subjectSlug,
    topicSlug: topicSlugRaw && topicSlugRaw !== "all" ? topicSlugRaw : null,
    count,
    mode,
    difficulty,
    year,
  };
}

export function parseOptionKey(value: unknown): QuestionOption["key"] {
  if (typeof value !== "string" || !OPTION_KEYS.has(value as QuestionOption["key"])) {
    throw new Error("Choose a valid answer option.");
  }
  return value as QuestionOption["key"];
}
