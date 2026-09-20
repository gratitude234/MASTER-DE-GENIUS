/**
 * Deterministic question-integrity validation.
 *
 * MASTER must never knowingly present a question that cannot be understood and
 * answered from what the student can actually see. Provider inventory contains
 * questions whose original examination context — a section instruction, a
 * comprehension passage, a diagram — was lost before it reached us, leaving a
 * structurally valid but semantically orphaned question:
 *
 *     prompt: "mischief"                                   (no instruction)
 *     prompt: "The image in the quotation above depicts…"   (no quotation)
 *
 * This module is the single place that decides. It is pure and synchronous, and
 * deliberately free of any AI or network call: the same question must always
 * produce the same verdict, and the verdict must be cheap enough to run on every
 * candidate of every session. Nothing here repairs a question — missing
 * examination content is detected, never invented.
 *
 * Imported by the server before a session is frozen and by tests directly, so it
 * carries no "server-only" marker and performs no I/O.
 */

/** Why a candidate was refused. Diagnostic only; never shown to a student. */
export type QuestionIntegrityReason =
  | "missing_passage_context"
  | "missing_referenced_asset"
  | "missing_referenced_context"
  | "missing_underlined_context"
  | "orphan_fragment";

/**
 * The structural subset the check needs. Both `CanonicalQuestion` and
 * `StudentQuestion` satisfy it, so the same rule applies to a candidate before
 * freezing and to a stored snapshot during inspection.
 */
export interface QuestionIntegrityInput {
  prompt: string;
  instruction?: string | null;
  passage?: { body: string } | null;
  assets?: readonly { id: string }[] | null;
  options?: readonly { text: string }[] | null;
}

export interface QuestionIntegrityResult {
  valid: boolean;
  reason?: QuestionIntegrityReason;
  /** The matched phrase or rule, for server diagnostics. Never an answer key. */
  detail?: string;
}

/**
 * Words that can only mean separate source material the student must read.
 * Missing in either direction: a passage does not become readable because the
 * question said "below".
 */
const SOURCE_MATERIAL_NOUNS = [
  "passage", "quotation", "quote", "extract", "excerpt", "poem", "stanza",
  "dialogue", "conversation", "paragraph", "story", "comprehension", "text",
];

/** Words that can only mean something the student must look at. */
const VISUAL_NOUNS = [
  "diagram", "figure", "graph", "table", "map", "illustration", "image", "picture",
  "chart", "sketch", "drawing", "photograph", "photo",
];

/**
 * Words that may equally describe the question's own prompt or its options.
 * Only a backwards reference ("the statement above") can point at material that
 * should already be on screen; "the sentence below" is usually the prompt
 * itself, and "the statements below" is usually the option list.
 */
const AMBIGUOUS_NOUNS = [
  "statement", "statements", "sentence", "sentences", "information", "data",
];

function referencePattern(nouns: string[], direction: string): RegExp {
  const group = nouns.join("|");
  // Both orders occur in real papers: "the passage above" and "the above passage".
  return new RegExp(`\\b(?:(?:${group})s?\\s+(?:${direction})|(?:${direction})\\s+(?:${group})s?)\\b`, "i");
}

const SOURCE_REFERENCE = referencePattern(SOURCE_MATERIAL_NOUNS, "above|below");
const VISUAL_REFERENCE = referencePattern(VISUAL_NOUNS, "above|below");
const AMBIGUOUS_REFERENCE = referencePattern(AMBIGUOUS_NOUNS, "above");

/**
 * A bare backwards reference with no noun: "from the above", "as shown above".
 * Deliberately narrow, and deliberately backwards-only — "a temperature above
 * 30°C" must never be mistaken for a reference to missing material, and
 * "the options given below" is not missing context at all.
 */
const GENERIC_REFERENCE =
  /\b(?:(?:from|in|of|to)\s+the\s+above|(?:shown|given|stated|described|listed|illustrated|indicated)\s+above)\b/i;

/**
 * Emphasis is presentation, and the canonical question model is plain text:
 * provider markup is stripped so the product can render safely without
 * `dangerouslySetInnerHTML`. A question that says "the underlined word" — or
 * "the word in italics", which JAMB and WAEC use for the same task — inside a
 * full sentence therefore cannot be answered: the emphasis is gone and which
 * word was meant is unknowable. Rich-text emphasis is an intentionally
 * unsupported context pattern, so such questions are rejected, never guessed at.
 *
 * The one shape that survives is the common ALOC one where the prompt *is* the
 * expression being asked about ("mischief") and only the instruction mentions
 * the emphasis. Nothing is ambiguous there, because there is only one candidate.
 */
const EMPHASIS_REFERENCE = /\bunderlined?\b|\bin italics\b|\bitalici[sz]ed\b|\bin bold\b|\bbolded\b|\bemboldened\b/i;

/** Longest prompt that can still be "the expression itself" rather than a sentence. */
const MAX_EXPRESSION_WORDS = 4;

/**
 * Longest prompt that can be an orphan fragment. One word shorter than an
 * expression on purpose: four-word stems such as "H₂SO₄ is a strong" are real
 * questions, and a false rejection costs a student inventory.
 */
const MAX_FRAGMENT_WORDS = 3;

const SENTENCE_PUNCTUATION = /[.!?:;]/;
const BLANK = /(_{2,}|\.{3,}|…|-{3,})/;
const MATHS = /[0-9₀-₉⁰-⁹+\-×÷=<>%√∫∑π]/;

/**
 * A finite verb means the prompt is a clause, not a loose word: "The boy is",
 * "H₂SO₄ is a strong" and "Sound travels faster in" are all sentence stems whose
 * options complete them.
 */
const FINITE_VERB =
  /\b(?:is|are|was|were|be|been|being|has|have|had|does|do|did|will|would|shall|should|can|could|may|might|must|becomes?|means?|occurs?|contains?|produces?|travels?|equals?)\b/i;

/**
 * An imperative or interrogative opening makes even a very short prompt
 * self-explanatory: "Simplify 3x" is a task, "mischief" is a loose word.
 */
const TASK_OPENING =
  /^(?:what|which|who|whom|whose|when|where|why|how|name|state|list|define|calculate|find|evaluate|solve|simplify|convert|identify|choose|select|give|compute|determine|express|factorise|factorize|differentiate|integrate|draw|explain|describe|compare)\b/i;

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * Whether a prompt reads as an isolated lexical fragment: a bare word or very
 * short phrase carrying no task of its own.
 *
 * Deliberately *not* a length rule. "2 + 2 = ?", "Simplify 3x + 6" and "The
 * capital of Nigeria is" are all short and all answerable, so a fragment must
 * fail every one of these tests:
 *
 *   - at most three words;
 *   - no sentence punctuation (a stem or question carries its own task);
 *   - no blank to fill;
 *   - no digits or mathematical symbols;
 *   - no finite verb, which would make it a clause the options complete;
 *   - no interrogative or imperative opening.
 *
 * Even then it is only rejected when nothing else supplies the task — see
 * `checkQuestionIntegrity`.
 */
export function isLexicalFragment(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return true;
  if (words(text).length > MAX_FRAGMENT_WORDS) return false;
  if (SENTENCE_PUNCTUATION.test(text)) return false;
  if (BLANK.test(text)) return false;
  if (MATHS.test(text)) return false;
  if (FINITE_VERB.test(text)) return false;
  if (TASK_OPENING.test(text)) return false;
  return true;
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Decides whether a question can be understood from what the student will see.
 *
 * Conservative by design: a question is only refused when it points at context
 * that is demonstrably absent. Anything merely unusual — a terse factual
 * question, an incomplete-sentence stem, an unfamiliar subject — is accepted,
 * because wrongly discarding a good question costs a student inventory.
 */
export function checkQuestionIntegrity(question: QuestionIntegrityInput): QuestionIntegrityResult {
  const prompt = (question.prompt ?? "").trim();
  const instruction = hasText(question.instruction) ? question.instruction!.trim() : "";
  const hasPassage = hasText(question.passage?.body);
  const hasAssets = (question.assets?.length ?? 0) > 0;
  // Everything the student will read, judged together: an instruction that
  // quotes a missing passage breaks the question just as surely as a prompt that does.
  const visible = instruction ? `${instruction}\n${prompt}` : prompt;

  const sourceReference = SOURCE_REFERENCE.exec(visible);
  if (sourceReference && !hasPassage) {
    return { valid: false, reason: "missing_passage_context", detail: sourceReference[0].toLowerCase() };
  }

  const visualReference = VISUAL_REFERENCE.exec(visible);
  if (visualReference && !hasAssets) {
    return { valid: false, reason: "missing_referenced_asset", detail: visualReference[0].toLowerCase() };
  }

  const ambiguousReference = AMBIGUOUS_REFERENCE.exec(visible);
  if (ambiguousReference && !hasPassage && !hasAssets) {
    return { valid: false, reason: "missing_referenced_context", detail: ambiguousReference[0].toLowerCase() };
  }

  const genericReference = GENERIC_REFERENCE.exec(visible);
  if (genericReference && !hasPassage && !hasAssets) {
    return { valid: false, reason: "missing_referenced_context", detail: genericReference[0].toLowerCase() };
  }

  // Answerable only when the prompt is itself the expression in question; inside
  // a sentence the stripped emphasis is unrecoverable.
  if (EMPHASIS_REFERENCE.test(visible) && words(prompt).length > MAX_EXPRESSION_WORDS) {
    return { valid: false, reason: "missing_underlined_context", detail: "emphasised expression is not identifiable" };
  }

  if (isLexicalFragment(prompt) && !instruction && !hasPassage && !hasAssets) {
    return { valid: false, reason: "orphan_fragment", detail: "no instruction, passage or asset accompanies the fragment" };
  }

  return { valid: true };
}

/** Convenience wrapper for call sites that only need the verdict. */
export function isDeliverableQuestion(question: QuestionIntegrityInput): boolean {
  return checkQuestionIntegrity(question).valid;
}
