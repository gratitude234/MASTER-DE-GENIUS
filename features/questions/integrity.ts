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
  | "duplicate_option_content"
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

/* -------------------------------------------------------------------------
 * Visual dependency
 *
 * A question that tells the student to look at something must arrive with that
 * something. The first version of this rule only recognised a noun next to
 * "above" or "below", which is why three production questions escaped it:
 *
 *   "Using the table,What is the modal age?"          — no direction word
 *   "The histogram above represents…"                 — "histogram" was not a noun it knew
 *   "From the graph, it can be inferred that"          — no direction word
 *
 * Recognition is therefore contextual rather than a list of exact phrases: a
 * noun that names a visual, combined with a grammatical frame that can only
 * mean "the one in front of you". The frames were designed against the 123
 * questions in the live frozen corpus that mention a visual noun at all, and
 * checked in both directions — every genuine reference is caught, and every
 * non-referential use ("significant figures", "figure of speech", "the periodic
 * table", "a circular table", "the image height", "his public image", "personal
 * drawings", "in a pie chart") is left alone.
 * ---------------------------------------------------------------------- */

/**
 * Nouns that name a visual and effectively nothing else, so a definite
 * reference to one ("the histogram shows…") is enough on its own.
 */
const STRICT_VISUAL_NOUNS = [
  "venn diagram", "pie chart", "bar chart", "flow chart", "flowchart",
  "diagram", "histogram", "graph", "table", "chart", "figure", "map",
];

/**
 * Nouns that name a visual only some of the time. "The image height", "his
 * public image", "the mental picture", "personal drawings" and "worship the
 * image he set up" are all ordinary prose, so these count only when an explicit
 * anchor — a direction, an anchor word, or an instruction to look at them —
 * makes the reference unmistakable.
 */
const WEAK_VISUAL_NOUNS = [
  "photograph", "illustration", "picture", "drawing", "sketch", "image", "photo",
];

/** Longest first, so "pie chart" is preferred over "chart" when both could match. */
function nounGroup(...sets: string[][]): string {
  return [...new Set(sets.flat())].sort((a, b) => b.length - a.length).join("|");
}

const ALL_VISUAL_NOUNS = nounGroup(STRICT_VISUAL_NOUNS, WEAK_VISUAL_NOUNS);
const STRICT_NOUNS = nounGroup(STRICT_VISUAL_NOUNS);

/**
 * Words that anchor a noun to something already drawn: "the diagram given",
 * "in the diagram shown", "the figure provided". Both orders occur.
 */
const ANCHOR_WORDS = "shown|given|drawn|provided|displayed|illustrated|depicted|attached|supplied|presented";

/**
 * Verbs that direct the student at something. "of" is deliberately absent —
 * "the slope of the graph" is a phrase, not an instruction, and the question
 * that uses it describes its own graph in words.
 */
const DIRECTING_VERBS =
  "us(?:e|ing|ed)|from|in|on|study|studying|examine|examining|consider|considering|observe|observing|" +
  "inspect|inspecting|interpret|interpreting|read|reading|refer(?:ring)? to|according to|based on|complete|completing";

/** Only a definite or demonstrative determiner points at something on screen. */
const DEFINITE = "the|this|that|these|those";

/**
 * Predicates that make a definite noun the subject of the question: "the
 * histogram shows…", "the diagram represents", "the table above is".
 */
const VISUAL_PREDICATES =
  "is|are|was|were|shows?|showed|represents?|represented|illustrates?|indicates?|displays?|depicts?|gives?|contains?|has|have";

/**
 * Non-referential fixed phrases that contain a visual noun. Each was found in
 * the live corpus; without them, ordinary questions would be refused.
 */
const NON_REFERENTIAL =
  /\bfigures?\s+of\s+speech\b|\bsignificant\s+figures?\b|\bperiodic\s+table\b|\bwater\s+table\b|\btimes\s+table\b|\bfigures?\s+of\s+authority\b/gi;

/**
 * A reference the question answers itself: "…a graph of the mass deposited is
 * plotted. The slope of the graph gives?" introduces its graph in words, so
 * "the graph" points backwards into the sentence, not at a missing picture.
 *
 * Only an indefinite introduction earlier in the same visible text counts, and
 * only for the bare frames — "the table above" is never anaphoric.
 */
function introducedIndefinitely(visible: string, noun: string, beforeIndex: number): boolean {
  const pattern = new RegExp(`\\b(?:a|an)\\s+(?:[a-z][a-z-]*\\s+){0,3}${noun}s?\\b`, "gi");
  for (const match of visible.matchAll(pattern)) {
    if (match.index !== undefined && match.index < beforeIndex) return true;
  }
  return false;
}

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
const AMBIGUOUS_REFERENCE = referencePattern(AMBIGUOUS_NOUNS, "above");

/**
 * The five frames that can only mean "look at the thing supplied with this
 * question". Ordered cheapest and most certain first; the first to match wins
 * and supplies the diagnostic detail.
 *
 *   1. directional — "the table above", "the above diagram", "in the figure below"
 *   2. anchored    — "the diagram given", "in the diagram shown", "the figure provided"
 *   3. directed    — "using the table", "from the graph", "study the diagram",
 *                    "according to the chart"
 *   4. predicated  — "the histogram shows", "the diagram represents", "this graph is"
 *   5. enumerated  — "the following table", but never "which of the following diagrams",
 *                    where "the following" means the answer options
 *
 * Frames 1, 2, 3 and 5 accept every visual noun; frame 4 accepts only the
 * unambiguous ones, because "the image is" and "the picture is" are ordinary
 * English and "the diagram is" is not.
 */
const VISUAL_FRAMES: { name: string; pattern: RegExp; anaphoric: boolean }[] = [
  {
    name: "directional",
    pattern: new RegExp(`\\b(?:(${ALL_VISUAL_NOUNS})s?\\s+(?:above|below)|(?:above|below)\\s+(${ALL_VISUAL_NOUNS})s?)\\b`, "gi"),
    anaphoric: false,
  },
  {
    name: "anchored",
    pattern: new RegExp(`\\b(?:(${ALL_VISUAL_NOUNS})s?\\s+(?:${ANCHOR_WORDS})|(?:${ANCHOR_WORDS})\\s+(?:${DEFINITE})?\\s*(${ALL_VISUAL_NOUNS})s?)\\b`, "gi"),
    anaphoric: false,
  },
  {
    name: "directed",
    pattern: new RegExp(`\\b(?:${DIRECTING_VERBS})\\s+(?:${DEFINITE})\\s+(${ALL_VISUAL_NOUNS})s?\\b`, "gi"),
    anaphoric: true,
  },
  {
    name: "predicated",
    pattern: new RegExp(`\\b(?:${DEFINITE})\\s+(${STRICT_NOUNS})s?\\s+(?:${VISUAL_PREDICATES})\\b`, "gi"),
    anaphoric: true,
  },
  {
    name: "enumerated",
    pattern: new RegExp(`(?<!\\b(?:which|one|any|all|none|each|some|several|many)\\s+of\\s+)\\bthe following\\s+(${ALL_VISUAL_NOUNS})s?\\b`, "gi"),
    anaphoric: false,
  },
];

/**
 * Whether the visible text depends on a visual the student must be shown.
 *
 * Returns the matched phrase for diagnostics, or null. Fixed non-referential
 * phrases are blanked (not deleted) before matching, so offsets stay aligned
 * and "significant figures" can never supply the noun for a frame.
 */
export function findVisualReference(visible: string): string | null {
  const text = visible.replace(NON_REFERENTIAL, (phrase) => " ".repeat(phrase.length));

  for (const frame of VISUAL_FRAMES) {
    frame.pattern.lastIndex = 0;
    for (const match of text.matchAll(frame.pattern)) {
      const noun = (match.slice(1).find(Boolean) ?? "").toLowerCase();
      if (frame.anaphoric && noun && introducedIndefinitely(text, noun, match.index ?? 0)) continue;
      return match[0].replace(/\s+/g, " ").trim().toLowerCase();
    }
  }
  return null;
}

/**
 * A bare backwards reference with no noun: "from the above", "as shown above".
 * Deliberately narrow, and deliberately backwards-only — "a temperature above
 * 30°C" must never be mistaken for a reference to missing material, and
 * "the options given below" is not missing context at all.
 */
const GENERIC_REFERENCE =
  /\b(?:(?:from|in|of|to)\s+the\s+above|(?:shown|given|stated|described|listed|illustrated|indicated|represented|depicted|presented)\s+above)\b/i;

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

/* -------------------------------------------------------------------------
 * Duplicate visible option content
 * ---------------------------------------------------------------------- */

/**
 * Invisible characters that make two identical options look different to a
 * string comparison: non-breaking and other Unicode spaces, zero-width marks,
 * and the soft hyphen.
 */
const INVISIBLE = /[   -   　]/g;
const ZERO_WIDTH = /[​-‍⁠﻿­]/g;

/**
 * The form two options are compared in.
 *
 * Only presentation is normalised: invisible characters become ordinary spaces,
 * whitespace runs collapse, and the ends are trimmed. Nothing is evaluated and
 * nothing is stripped, so "1/2" and "0.5", "2+2" and "2 + 2", "3x" and "3 x"
 * all stay distinct — the check never decides that two mathematical
 * expressions mean the same thing, only that two strings are the same string.
 *
 * HTML needs no handling here: provider markup is already removed and entities
 * decoded by `cleanText` before a question becomes canonical, so "<b>5</b>",
 * "&nbsp;5" and "5" all arrive as "5" and are caught.
 */
function optionComparisonKey(text: string): string {
  return text.replace(ZERO_WIDTH, "").replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
}

/**
 * Case is folded on the first character only, and only when the option set is
 * not marking stress.
 *
 * Folding the whole string would be wrong twice over. English papers set stress
 * questions whose options differ *only* in capitalisation — the live corpus
 * holds "aSSociation / associaTION / associAtion / Association." as four
 * distinct answers — and chemistry distinguishes "CO" from "Co". Folding only
 * the leading character catches the real duplicate pattern, a sentence-cased
 * copy of the same answer ("Receive" and "receive", "Abuja" and " Abuja "),
 * and leaves both of those intact.
 */
function firstCharacterFolded(key: string): string {
  return key ? key[0].toLowerCase() + key.slice(1) : key;
}

/**
 * A capital inside a word — "associaTION", "deDIcation", "obliGAtion".
 *
 * Its presence anywhere in the option list means the paper is marking stressed
 * syllables with capitals, so capitalisation is the content of every option and
 * even the leading character must be compared exactly. Without this guard the
 * live set "dedicaTION / deDIcation / dedication / Dedication" would lose its
 * last two options to each other and a valid question would be thrown away.
 */
const STRESS_MARKED = /[a-z][A-Z]/;

export interface DuplicateOptionPair {
  first: string;
  second: string;
}

/**
 * Two options a student would read as the same answer, or null.
 *
 * A question whose options are "4, 5, 5, 7" cannot be answered honestly: two
 * choices are the same, so at most one of them can be marked correct and a
 * student who picks the other is wrong for no reason they can see. It was
 * served in production. Duplicate option *keys* were already refused by the
 * adapters; duplicate option *content* was not.
 */
export function findDuplicateOptionContent(
  options: readonly { text: string }[] | null | undefined,
): DuplicateOptionPair | null {
  if (!options || options.length < 2) return null;

  const keys = options.map((option) => optionComparisonKey(option.text ?? ""));
  const stressMarked = keys.some((key) => STRESS_MARKED.test(key));

  const exact = new Map<string, string>();
  const folded = new Map<string, string>();

  for (let index = 0; index < options.length; index += 1) {
    const key = keys[index];
    if (!key) continue;
    const text = options[index].text;

    const previousExact = exact.get(key);
    if (previousExact !== undefined) return { first: previousExact, second: text };
    exact.set(key, text);

    if (stressMarked) continue;
    const foldedKey = firstCharacterFolded(key);
    const previousFolded = folded.get(foldedKey);
    if (previousFolded !== undefined) return { first: previousFolded, second: text };
    folded.set(foldedKey, text);
  }

  return null;
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

  const visualReference = findVisualReference(visible);
  if (visualReference && !hasAssets) {
    return { valid: false, reason: "missing_referenced_asset", detail: visualReference };
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

  const duplicate = findDuplicateOptionContent(question.options);
  if (duplicate) {
    return {
      valid: false,
      reason: "duplicate_option_content",
      // The option text is the student-visible answer list, never the key.
      detail: `two options read identically: ${JSON.stringify(duplicate.first)} and ${JSON.stringify(duplicate.second)}`,
    };
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
