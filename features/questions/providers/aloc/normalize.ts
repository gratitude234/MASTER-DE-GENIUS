import "server-only";

import { carriesMaterial, classifyQuestionContext, contextDiagnostic, type ContextClassification } from "@/features/questions/context";
import type { CanonicalQuestion, QuestionPassage } from "@/features/questions/types";
import type { ExamBody, QuestionAsset, QuestionOption } from "@/types/domain";

/**
 * Legacy ALOC payloads are loosely typed and vary between subjects, so every
 * field arrives as `unknown` and is validated before use. Nothing in this shape
 * may escape the ALOC adapter.
 */
export interface AlocRawQuestion {
  id?: unknown;
  question?: unknown;
  option?: unknown;
  options?: unknown;
  answer?: unknown;
  section?: unknown;
  image?: unknown;
  solution?: unknown;
  examtype?: unknown;
  examyear?: unknown;
  hasPassage?: unknown;
}

export interface NormalizeContext {
  examBody: ExamBody;
  subjectSlug: string;
  subjectName: string;
}

/** Why a question was rejected. Surfaced by the smoke script, never to students. */
export type DiscardReason =
  | "missing_id"
  | "empty_prompt"
  | "too_few_options"
  | "duplicate_option_key"
  | "unresolved_answer"
  | "invalid_structure";

const OPTION_ORDER: QuestionOption["key"][] = ["A", "B", "C", "D", "E"];
const OPTION_KEYS = new Set<string>(OPTION_ORDER);

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  deg: "°", times: "×", divide: "÷", plusmn: "±",
  frac12: "½", frac14: "¼", frac34: "¾",
  sup2: "²", sup3: "³", micro: "µ",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ",
  pi: "π", theta: "θ", lambda: "λ", omega: "ω",
  rarr: "→", larr: "←", harr: "↔",
  le: "≤", ge: "≥", ne: "≠",
};

// Conservative: a run only counts as markup when it looks like a real tag, so
// mathematical text such as "x < 5" survives untouched.
const TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>/g;
const LINE_BREAK_TAG = /<\s*(?:br\s*\/?|\/\s*(?:p|div|li|tr|h[1-6]))\s*>/gi;

/**
 * HTML and XML comments, removed before tags.
 *
 * `TAG` requires a letter after the optional slash, so `<!-- × -->` never
 * matched it and a comment travelled all the way to the student: the live
 * corpus holds twenty-seven contexts reading "12.02 ×<!-- × --> 20.06". They
 * come from MathML, where a converter annotates a numeric entity with the
 * character it denotes — `<mo>&#x00D7;<!-- × --></mo>`. The entity is the
 * content and the comment is only a note about it, so removing the comment
 * keeps "×" and loses nothing.
 */
const COMMENT = /<!--[\s\S]*?-->/g;

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const codePoint = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return match;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }
    return ENTITIES[body] ?? ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Markup is removed before entities are decoded, so an escaped `&lt;` becomes a
 * literal "<" instead of being mistaken for a tag and deleted. React already
 * escapes on render, so the product keeps one safe renderer and never needs
 * dangerouslySetInnerHTML.
 */
/**
 * Restores a space that the provider's own text lost after punctuation:
 * "Using the table,What is the modal age?" was served exactly like that.
 *
 * Deliberately the narrowest rule that fixes the observed defect. The space is
 * only inserted between a lowercase letter or digit and an uppercase letter,
 * which is what keeps every initialism in the live corpus intact — "A.V. Dicey",
 * "S.I unit", "E.C.O.W.A.S", "S.V.P", "I.S∩T∩W" all have an *uppercase* letter
 * before the stop and are left alone. A digit after the stop is excluded too, so
 * "0.02174", "2,000" and "N8,000" are untouched, and a lowercase letter after it
 * is excluded, so "f(x,y)" keeps its shape.
 *
 * This is typography, not grammar: no word is added, removed, reordered or
 * respelled, so the question means exactly what the provider sent.
 */
const MISSING_SPACE_AFTER_PUNCTUATION = /([a-z0-9])([,.;:!?])([A-Z])/g;

export function cleanText(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return "";
  return decodeEntities(value.replace(COMMENT, "").replace(LINE_BREAK_TAG, "\n").replace(TAG, ""))
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(MISSING_SPACE_AFTER_PUNCTUATION, "$1$2 $3")
    .trim();
}

export function normalizeOptionKey(value: unknown): QuestionOption["key"] | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim().toLowerCase().replace(/[.)\]:]+$/, "");
  const match = /^(?:option[\s_-]?)?([a-e])$/.exec(raw);
  if (!match) return null;
  const key = match[1].toUpperCase();
  return OPTION_KEYS.has(key) ? (key as QuestionOption["key"]) : null;
}

function comparable(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!?'"()]/g, "").trim();
}

interface NormalizedOptions {
  options: QuestionOption[];
  error?: DiscardReason;
}

export function normalizeOptions(raw: unknown, questionId: string): NormalizedOptions {
  const collected = new Map<QuestionOption["key"], string>();

  const add = (key: QuestionOption["key"] | null, text: unknown): DiscardReason | null => {
    if (!key) return null;
    const value = cleanText(text);
    if (!value) return null;              // ALOC returns null/"" for an absent 5th option.
    if (collected.has(key)) return "duplicate_option_key";
    collected.set(key, value);
    return null;
  };

  if (Array.isArray(raw)) {
    for (let index = 0; index < raw.length && index < OPTION_ORDER.length; index += 1) {
      const failure = add(OPTION_ORDER[index], raw[index]);
      if (failure) return { options: [], error: failure };
    }
  } else if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const failure = add(normalizeOptionKey(key), value);
      if (failure) return { options: [], error: failure };
    }
  } else {
    return { options: [], error: "invalid_structure" };
  }

  const options = OPTION_ORDER.filter((key) => collected.has(key)).map((key) => ({
    id: `aloc:${questionId}:${key}`,
    key,
    text: collected.get(key)!,
  }));

  if (options.length < 2) return { options: [], error: "too_few_options" };
  return { options };
}

/**
 * Resolves the answer key by letter first, then by an unambiguous match against
 * the option text. Anything else is unresolvable: the question is discarded
 * rather than guessed, because a wrong key silently corrupts grading.
 */
export function resolveAnswerKey(raw: unknown, options: QuestionOption[]): QuestionOption["key"] | null {
  const byKey = normalizeOptionKey(raw);
  if (byKey && options.some((option) => option.key === byKey)) return byKey;

  const answerText = cleanText(raw);
  if (!answerText) return null;

  const target = comparable(answerText);
  if (!target) return null;

  const matches = options.filter((option) => comparable(option.text) === target);
  return matches.length === 1 ? matches[0].key : null;
}

/** Deterministic FNV-1a. Questions sharing a passage body share its identifier. */
function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Whether section text is a rubric addressed to the student rather than source
 * material they must read.
 *
 * Two independent markers, because real papers phrase the same task many ways
 * and a list of whole sentences would only ever recognise the fixtures it was
 * written from:
 *
 *   1. a task verb opening a sentence — "Choose the option…", and equally
 *      "…to the sentence given. Select from the options…", which a text-start
 *      anchor would miss;
 *   2. examination register — wording that appears in a rubric and effectively
 *      never in narrative prose ("nearest in meaning", "options lettered A to D",
 *      "from the alternatives provided", "most appropriate").
 *
 * Deliberately a recogniser, not a classifier that guesses: text matching
 * nothing is left to the length rule, so an unrecognised rubric is still shown
 * to the student as a passage rather than discarded. Nothing is ever written.
 */
const TASK_VERBS =
  "choose|select|pick|indicate|complete|fill|read|study|use|answer|identify|rewrite|arrange|underline|circle|state|supply|give|write|insert|replace|match|group|find|attempt";

/**
 * A task verb that opens the text or a later sentence. Anchoring to a sentence
 * boundary is what keeps ordinary prose out: "He had to choose between two
 * paths" never matches, because "choose" is mid-sentence there.
 */
const IMPERATIVE_OPENING = new RegExp(`(?:^|[.;:?!\\n]\\s+)(?:${TASK_VERBS})\\b`, "i");

/** Examination register. Each phrase was chosen for being absent from prose. */
const INSTRUCTION_PHRASES: RegExp[] = [
  /\b(?:in|for|after|from) each of (?:the )?(?:following |these )?(?:questions?|sentences?|items?|words?)\b/i,
  /\b(?:in|for) questions? \d+\s*(?:to|-|–|and)\s*\d+/i,
  /\b(?:nearest|closest|opposite|similar|same|equivalent) in meaning\b/i,
  /\bmost (?:appropriate|suitable|nearly|closely)\b/i,
  /\bbest (?:completes|suits|explains|interprets|conveys|describes)\b/i,
  /\bfrom the (?:words?|options?|alternatives?|list|letters?)\b/i,
  /\b(?:options?|alternatives?|words?|letters?|answers?) lettered\b/i,
  /\balternatives? (?:provided|given|below|above|listed)\b/i,
  /\blettered [a-e]\s*(?:to|-|–)\s*[a-e]\b/i,
  /\bfill in the (?:gap|blank)/i,
  /\bunderlined? (?:word|expression|phrase|portion|part|group|sentence)/i,
  /\bin italics\b|\bitalici[sz]ed\b/i,
  /\bchoose the (?:option|word|answer|expression|one|interpretation|alternative)\b/i,
  /\bpossible interpretations\b/i,
  /\bnumbered gaps?\b/i,
];

/**
 * Instructions are short; comprehension passages are not. The ceiling keeps a
 * block that opens with "Read the passage below…" and then carries the passage
 * itself from being mistaken for a bare instruction line — the source material
 * matters more than the rubric, so when both share one field the passage wins.
 */
const MAX_INSTRUCTION_LENGTH = 300;

/** Below this, text is too short to be a comprehension passage. */
const MIN_PASSAGE_LENGTH = 40;

function looksLikeInstruction(text: string): boolean {
  if (text.length > MAX_INSTRUCTION_LENGTH) return false;
  return IMPERATIVE_OPENING.test(text) || INSTRUCTION_PHRASES.some((pattern) => pattern.test(text));
}

export interface SectionContext {
  /** Task text shown above the prompt. Never source material. */
  instruction: string | null;
  /** Genuine source material the prompt quotes. */
  passage: QuestionPassage | null;
  /**
   * Set when context was refused rather than shown — a worked solution, a
   * broken equation layout, a duplicate of the prompt. Diagnostic only: it
   * tells the integrity validator and the admin inspector that the question
   * lost context, as opposed to never having had any.
   */
  discardedContext?: ContextClassification;
}

/**
 * `section` is not a passage field. Live responses put instruction text in it for
 * most English questions ("In each of questions 86 to 100, choose the option
 * opposite in meaning to the word(s)."), and only comprehension questions carry
 * `hasPassage: 1`.
 *
 * Both concepts are preserved rather than one being discarded. Previously an
 * instruction was recognised and then thrown away, which is what turned
 * "choose the option opposite in meaning …" + "mischief" into a bare, unanswerable
 * "mischief". Classification is deterministic:
 *
 *   - `hasPassage` truthy  → a real passage (the provider's own flag is authoritative)
 *   - `hasPassage` falsy   → the provider says this is not source material, so it is an instruction
 *   - flag absent          → instruction-shaped text is an instruction, otherwise
 *                            long text is a passage and short text is discarded
 *
 * Nothing is invented: text is only classified, never written.
 */
export function normalizeSection(
  raw: unknown,
  hasPassage?: unknown,
  options?: NormalizeSectionOptions,
): SectionContext {
  let title: string | null = null;
  let body = "";
  let declaredInstruction = "";

  if (typeof raw === "string" || typeof raw === "number") {
    body = cleanText(raw);
  } else if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    body = cleanText(record.passage ?? record.content ?? record.body ?? record.text);
    declaredInstruction = cleanText(record.instruction);
    title = cleanText(record.theme ?? record.title ?? record.name) || null;
    // An object carrying only an instruction field still has usable context.
    if (!body && declaredInstruction) return { instruction: declaredInstruction, passage: null };
  }

  const instructionOnly = (text: string): SectionContext => ({
    instruction: declaredInstruction || text || null,
    passage: null,
  });

  if (!body) return instructionOnly("");

  /*
   * What the text *is* comes before what it is long enough to be.
   *
   * The length rule below was the only positive test for source material, so
   * any provider value of forty characters became a passage — which is how a
   * flattened MathML worked solution ended up in the blue PASSAGE card with the
   * answer inside it. Material that cannot be shown faithfully is refused here,
   * and the question is then judged without it by `checkQuestionIntegrity`.
   */
  const material = classifyQuestionContext({ raw, text: body, prompt: options?.prompt });
  if (material.discard) {
    return { instruction: declaredInstruction || null, passage: null, discardedContext: material };
  }
  body = material.text;

  const asContext = (): SectionContext => ({
    instruction: declaredInstruction || null,
    passage: { id: `aloc:passage:${stableHash(body)}`, title, body, kind: material.kind },
  });

  if (hasPassage !== undefined) {
    if (!Number(hasPassage)) return instructionOnly(body);
    return body.length < MIN_PASSAGE_LENGTH ? instructionOnly(body) : asContext();
  }

  // No flag: a bare instruction line is not a comprehension passage, and
  // inventing one would put fabricated content on screen. Rubric recognition
  // runs first and is unchanged — "Choose the best option." is the task, not
  // material, however little prose it contains.
  if (looksLikeInstruction(body)) return instructionOnly(body);

  /*
   * A formula or a table is kept whatever its length. `MIN_PASSAGE_LENGTH`
   * exists to stop a short line of prose being mistaken for a comprehension
   * extract; "v = u + at" is not a short passage but a different kind of thing,
   * and dropping it would lose context the question may need.
   */
  if (body.length < MIN_PASSAGE_LENGTH) {
    return material.kind === "given" && carriesMaterial(body)
      ? asContext()
      : { instruction: declaredInstruction || null, passage: null };
  }
  return asContext();
}

/** Kept for callers that only need the passage half of the classification. */
export function normalizePassage(raw: unknown, hasPassage?: unknown): QuestionPassage | null {
  return normalizeSection(raw, hasPassage).passage;
}

export interface NormalizeSectionOptions {
  /**
   * The question prompt. Supplied so context that merely repeats the prompt can
   * be recognised — the 2016 Mathematics case showed the same fraction twice,
   * once as a broken stack in the passage card and once inside the question.
   */
  prompt?: string;
}

function normalizeYear(raw: unknown): number | null {
  const year = typeof raw === "number" ? raw : Number.parseInt(cleanText(raw), 10);
  return Number.isInteger(year) && year >= 1960 && year <= 2100 ? year : null;
}

/* -------------------------------------------------------------------------
 * Question visuals
 * ---------------------------------------------------------------------- */

/**
 * Field names that have been observed to carry a question visual, longest-lived
 * first. Nothing here is speculative: each entry is a field a probed provider
 * response actually used.
 *
 *   - `imageUrl`   — ALOC Station. Verified 2026-09-20 against both `/questions`
 *                    and `/questions/{id}`; it is the *only* media field in
 *                    Station's 17-key record, and reading `image`/`assets`
 *                    instead is what silently dropped every Station diagram.
 *   - `image`      — legacy ALOC and Sdash V1.
 *   - the rest     — accepted defensively because they cost nothing and a
 *                    provider that renames a field must not silently lose a
 *                    diagram again. A field that is absent simply never matches.
 *
 * Order matters only for asset ordering, never for correctness.
 */
export const PROVIDER_MEDIA_FIELDS = [
  "imageUrl", "image_url", "image", "questionImage", "question_image",
  "diagram", "graph", "figure", "media", "assets", "attachments", "images",
] as const;

/** Keys that carry the URL when a media entry is an object rather than a string. */
const MEDIA_URL_KEYS = ["url", "src", "imageUrl", "image_url", "image", "href", "link", "path"];
/** Keys that carry human-readable alternative text for an entry. */
const MEDIA_ALT_KEYS = ["altText", "alt_text", "alt", "description", "label", "title"];
/** Keys that carry a caption shown beneath the visual. */
const MEDIA_CAPTION_KEYS = ["caption", "figcaption", "subtitle"];

/**
 * Only `https:` is admitted.
 *
 * The product is served over HTTPS and renders a provider URL directly in the
 * browser, so a plain-HTTP image is blocked as mixed content and shows nothing.
 * Admitting one would be worse than refusing it: the question would satisfy the
 * visual-dependency check while the student still saw no diagram, which is the
 * exact failure this work exists to remove. A refused URL leaves the question
 * with no asset, so the integrity validator rejects and replaces it instead.
 *
 * This also excludes `data:`, `javascript:`, `file:` and protocol-relative URLs
 * by construction. No URL is ever fetched server-side, so there is no SSRF
 * surface here; the browser fetches it as an ordinary third-party image.
 */
function usableAssetUrl(value: unknown): string | null {
  const url = cleanText(value);
  if (!url || !/^https:\/\/[^\s<>"']+$/i.test(url)) return null;
  return url;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const text = cleanText(record[key]);
    if (text) return text;
  }
  return null;
}

/**
 * Cloudinary paths in the ALOC corpus mark worked answers explicitly — a live
 * random batch of ten returned `…/MATH_2008_Q30_SOLUTION_nstl3`. Attaching such
 * an image to the question would show the student the answer before they chose
 * one, so it is never treated as a question visual.
 *
 * Matched as a whole path token, so a chemistry diagram is not caught by
 * "solubility" or by a question that merely discusses solutions. A question
 * whose only image is a worked answer keeps no asset at all and is then refused
 * by the integrity validator if its text depends on a visual — the honest
 * outcome, because that question has no usable diagram.
 */
const SOLUTION_ASSET = /(?:^|[/_\-.])(?:solution|solutions|answer|answers|explanation|worked)(?:$|[/_\-.])/i;

export function isSolutionAsset(url: string): boolean {
  try {
    return SOLUTION_ASSET.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

interface MediaCandidate {
  url: string;
  altText: string | null;
  caption: string | null;
}

function collectCandidates(value: unknown, into: MediaCandidate[]): void {
  if (value == null) return;
  if (Array.isArray(value)) {
    for (const entry of value) collectCandidates(entry, into);
    return;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const url = usableAssetUrl(firstString(record, MEDIA_URL_KEYS));
    if (!url) return;
    into.push({
      url,
      altText: firstString(record, MEDIA_ALT_KEYS),
      caption: firstString(record, MEDIA_CAPTION_KEYS),
    });
    return;
  }
  const url = usableAssetUrl(value);
  if (url) into.push({ url, altText: null, caption: null });
}

/** `<img src="…" alt="…">`, read from the raw field before markup is stripped. */
const HTML_IMG = /<img\b[^>]*>/gi;
const HTML_ATTRIBUTE = (name: string) => new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
/** `![alt](https://…)` — markdown image syntax, which markup stripping also loses. */
const MARKDOWN_IMG = /!\[([^\]]*)\]\(\s*([^)\s]+)[^)]*\)/g;

/**
 * Visuals carried inside a text field rather than a media field.
 *
 * `cleanText` deletes markup so the product can render without
 * `dangerouslySetInnerHTML`, which means an `<img>` inside a question body would
 * vanish without trace. It is read here, before that happens, and turned into an
 * ordinary canonical asset — the image survives and the renderer stays safe,
 * because only the URL and the alt text are kept and everything else in the tag
 * is discarded.
 */
export function extractInlineImages(raw: unknown): MediaCandidate[] {
  if (typeof raw !== "string" || !raw) return [];
  const found: MediaCandidate[] = [];

  for (const tag of raw.match(HTML_IMG) ?? []) {
    const src = HTML_ATTRIBUTE("src").exec(tag);
    const url = usableAssetUrl(src ? (src[2] ?? src[3] ?? src[4]) : null);
    if (!url) continue;
    const alt = HTML_ATTRIBUTE("alt").exec(tag);
    found.push({ url, altText: alt ? cleanText(alt[2] ?? alt[3] ?? alt[4]) || null : null, caption: null });
  }

  for (const match of raw.matchAll(MARKDOWN_IMG)) {
    const url = usableAssetUrl(match[2]);
    if (!url) continue;
    found.push({ url, altText: cleanText(match[1]) || null, caption: null });
  }

  return found;
}

export interface NormalizeAssetsOptions {
  /** `aloc`, `aloc-station`, `sdash` — the asset id namespace. */
  prefix: string;
  questionId: string;
  /** The provider record, read for every field in `PROVIDER_MEDIA_FIELDS`. */
  record?: Record<string, unknown> | null;
  /** Raw, uncleaned text fields that may carry inline `<img>` or markdown. */
  inlineSources?: unknown[];
}

/**
 * The one place a provider visual becomes a canonical `QuestionAsset`.
 *
 * Shared by all three external adapters for the same reason the text cleaner and
 * the instruction/passage classifier are: a second copy would be a second set of
 * rules, and a diagram must survive identically whichever provider a subject
 * routes to.
 *
 * Asset ids are stable and deterministic — `provider:questionId:image`, with a
 * content hash appended when a question carries more than one — so the same
 * record always produces the same id and a frozen snapshot can be compared
 * against a live one.
 *
 * The id deliberately does **not** name the field the URL came from. Provider
 * field names stop at the adapter, and an id travels all the way into the
 * student payload; `imageUrl` in a snapshot would put Station's schema on the
 * client exactly as `correctAnswer` or `hasPassage` would.
 *
 * `kind` stays `"image"`: it is what the provider actually stated, and
 * inferring "graph" or "table" from the question's wording would be invention.
 */
const ASSET_ID_SEGMENT = "image";
export function normalizeQuestionAssets(options: NormalizeAssetsOptions): QuestionAsset[] {
  const assets: QuestionAsset[] = [];
  const takenUrls = new Set<string>();
  const takenIds = new Set<string>();

  const push = (candidate: MediaCandidate) => {
    if (takenUrls.has(candidate.url)) return;
    // A worked-answer image is not a question visual and must never be shown.
    if (isSolutionAsset(candidate.url)) return;
    takenUrls.add(candidate.url);
    let id = `${options.prefix}:${options.questionId}:${ASSET_ID_SEGMENT}`;
    if (takenIds.has(id)) id = `${id}:${stableHash(candidate.url)}`;
    takenIds.add(id);
    assets.push({ id, kind: "image", url: candidate.url, altText: candidate.altText, caption: candidate.caption });
  };

  const record = options.record ?? {};
  for (const field of PROVIDER_MEDIA_FIELDS) {
    if (!(field in record)) continue;
    const candidates: MediaCandidate[] = [];
    collectCandidates(record[field], candidates);
    for (const candidate of candidates) push(candidate);
  }

  for (const source of options.inlineSources ?? []) {
    for (const candidate of extractInlineImages(source)) push(candidate);
  }

  return assets;
}

export interface NormalizeResult {
  question?: CanonicalQuestion;
  discarded?: DiscardReason;
}

/**
 * Converts one raw ALOC record into a CanonicalQuestion, or reports why it was
 * rejected. A malformed record never throws: one bad question must not fail an
 * entire batch.
 */
export function normalizeAlocQuestion(raw: unknown, context: NormalizeContext): NormalizeResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { discarded: "invalid_structure" };
  const record = raw as AlocRawQuestion;

  const providerQuestionId = typeof record.id === "number" || typeof record.id === "string"
    ? String(record.id).trim()
    : "";
  if (!providerQuestionId) return { discarded: "missing_id" };

  const prompt = cleanText(record.question);
  if (!prompt) return { discarded: "empty_prompt" };

  const { options, error } = normalizeOptions(record.option ?? record.options, providerQuestionId);
  if (error) return { discarded: error };

  const correctOptionKey = resolveAnswerKey(record.answer, options);
  if (!correctOptionKey) return { discarded: "unresolved_answer" };

  const section = normalizeSection(record.section, record.hasPassage, { prompt });

  return {
    question: {
      id: `aloc:${context.subjectSlug}:${providerQuestionId}`,
      source: { provider: "aloc", providerQuestionId, internalQuestionId: null },
      examBody: context.examBody,
      subject: { id: context.subjectSlug, slug: context.subjectSlug, name: context.subjectName },
      topic: null,
      year: normalizeYear(record.examyear),
      instruction: section.instruction,
      prompt,
      passage: section.passage,
      discardedContext: contextDiagnostic(section.discardedContext),
      assets: normalizeQuestionAssets({
        prefix: "aloc",
        questionId: providerQuestionId,
        record: record as Record<string, unknown>,
        // Read before `cleanText` strips markup, so an `<img>` inside the
        // question body or its section text survives instead of vanishing.
        inlineSources: [record.question, record.section],
      }),
      options,
      correctOptionKey,
      explanation: cleanText(record.solution) || null,
      difficulty: null,
    },
  };
}
