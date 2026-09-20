/**
 * Deterministic classification of provider question context.
 *
 * Two questions were served to students with this in the blue PASSAGE card:
 *
 *     Mathematics 2004    M                    Mathematics 2016    12.02
 *                         i                                        ×
 *                         d                                        20.06
 *                         p
 *                         o                                        26.04
 *                         …                                        ×
 *                         = … (1,1)                                60.06
 *
 * Neither is a passage. Both arrived in ALOC Station's `section` field as a
 * MathJax-generated MathML document, pretty-printed one element per line:
 *
 *     <math xmlns="http://www.w3.org/1998/Math/MathML">
 *       <mi>M</mi>
 *       <mi>i</mi>
 *       …
 *
 * "Midpoint" is eight separate `<mi>` elements because a multi-letter name in
 * TeX maths mode is a product of single-letter identifiers, so the character
 * fragmentation is upstream — MASTER did not create it. What MASTER did was
 * keep the converter's indentation newlines as if they were content, and
 * classify the result as source material on length alone.
 *
 * The 2004 section was the *worked solution*, ending in `(1, 1)` — option A.
 * The card was showing the answer.
 *
 * This module decides what a context actually is. It is pure and synchronous,
 * with no AI and no network: the same context must always produce the same
 * verdict. Nothing here writes examination content. Mathematical meaning is
 * never reconstructed, simplified or evaluated — material that cannot be shown
 * faithfully is discarded, and `checkQuestionIntegrity` then decides whether
 * the question survives without it.
 */

/** What a provider context turned out to be. Diagnostic; never shown to a student. */
export type QuestionContextKind =
  /** Prose the student must read: an extract, a poem, a comprehension passage. */
  | "passage"
  /** Legitimate non-prose material the question needs: a formula, a table, data. */
  | "given"
  /** A worked answer. Never shown — it is the answer key in prose. */
  | "solution"
  /** Material already fully present in the prompt. */
  | "duplicate"
  /** Broken mathematical layout: serialized equations, fragmented characters. */
  | "malformed"
  /** A label with no body — "Midpoint =", "Given that:". */
  | "incomplete"
  /** Markup or converter residue that should never have left the provider. */
  | "artefact"
  /** Nothing usable. */
  | "empty";

export interface ContextClassification {
  kind: QuestionContextKind;
  /** The text as the student would see it. Empty when discarded. */
  text: string;
  /** Whether this context must be kept away from the student. */
  discard: boolean;
  /** What triggered the verdict, for server diagnostics and the admin inspector. */
  detail?: string;
}

/**
 * Whether a context block is prose the student reads, as opposed to material
 * they consult.
 *
 * Every snapshot frozen before `kind` existed has no value at all, and those
 * are all genuine prose passages — the malformed ones are what this work
 * removes — so an absent kind reads as prose and history renders unchanged.
 */
export function isProseContext(
  context: { kind?: QuestionContextKind | null } | null | undefined,
): boolean {
  return context?.kind !== "given";
}

/**
 * The heading a context block carries.
 *
 * One function, used by Practice, the Mock runner, answer review and the admin
 * inspector, for the same reason one component renders every question visual:
 * four copies is how a formula ends up labelled "Passage" on one screen and
 * "Given" on another. "PASSAGE" is reserved for prose — a formula, a table or a
 * set of values is shown under a neutral label instead.
 */
export function contextHeading(
  context: { kind?: QuestionContextKind | null; title?: string | null } | null | undefined,
): string {
  if (context?.title) return context.title;
  return isProseContext(context) ? "Passage" : "Given";
}

/**
 * The part of a classification that may travel beyond the adapter.
 *
 * Deliberately not the text. A refused context is often the worked answer, so
 * carrying it forward "for diagnostics" would put the answer key into the
 * student snapshot by another route. Only the verdict and a short phrase move.
 */
export function contextDiagnostic(
  classification: ContextClassification | undefined,
): { kind: QuestionContextKind; detail?: string } | null {
  if (!classification) return null;
  return { kind: classification.kind, detail: classification.detail };
}

export interface ClassifyContextInput {
  /** The provider's untouched value, read for markup the text cleaner removes. */
  raw?: unknown;
  /** The same value after `cleanText`. */
  text: string;
  /** The question prompt, for duplicate detection. */
  prompt?: string;
}

/* -------------------------------------------------------------------------
 * Markup origin
 * ---------------------------------------------------------------------- */

/**
 * MathML element names. Their presence in the *raw* value is machine-readable
 * proof that the field holds mathematical markup rather than prose, which no
 * amount of inspection of the flattened text could establish as certainly.
 *
 * The name must be followed by whitespace, `/` or `>`, so ordinary mathematical
 * text such as "x < 5 and y > 2" — which carries no tags at all — never matches.
 */
const MATHML_ELEMENT =
  /<\/?(?:math|mi|mn|mo|ms|mrow|mfrac|msup|msub|msubsup|munder|mover|munderover|mspace|mtable|mtr|mtd|mtext|msqrt|mroot|mpadded|mphantom|mfenced|menclose|mstyle|merror|maction|mmultiscripts|mprescripts|mlabeledtr|semantics|annotation)(?=[\s/>])/i;

/** MathJax stamps its own output, so a converted document is identifiable even in a fragment. */
const MATHJAX_MARKER = /\bdata-mjx-[a-z]+\s*=/i;

/** Whether a raw provider value is mathematical markup rather than prose. */
export function hasMathMarkup(raw: unknown): boolean {
  if (typeof raw !== "string" || !raw) return false;
  return MATHML_ELEMENT.test(raw) || MATHJAX_MARKER.test(raw);
}

/**
 * Markup that survived cleaning, or converter residue that never was markup:
 * an unclosed comment, a leftover tag, a stray TeX escape such as the `\=` and
 * `\p` the live corpus holds where a converter emitted `\\` line breaks.
 */
const RESIDUAL_MARKUP = /<!--|--!?>|<\/?[a-z][a-z0-9-]*\s*\/?>|\\[a-zA-Z=]/i;

/* -------------------------------------------------------------------------
 * Worked answers
 * ---------------------------------------------------------------------- */

/**
 * A context labelled as the solution. Thirteen distinct ones are in the live
 * frozen corpus and eleven rows leak the correct option text outright.
 *
 * The label must be terminated by punctuation or a line break, so a passage
 * that merely begins "Solutions to poverty have been debated…" is prose and is
 * left alone.
 */
const WORKED_SOLUTION = /^\s*solutions?\s*(?:[:.\-–—]|\n|$)/i;

export function isWorkedSolution(text: string): boolean {
  return WORKED_SOLUTION.test(text);
}

/* -------------------------------------------------------------------------
 * Character-fragment repair
 * ---------------------------------------------------------------------- */

/**
 * Consecutive one-character lines needed before fragmentation is assumed.
 *
 * Four is the smallest run that cannot plausibly be a deliberate layout: a
 * lettered list is at most "A/B/C/D", and that is refused separately below.
 */
const MIN_FRAGMENT_RUN = 4;

export interface RepairedFragment {
  text: string;
  repaired: boolean;
}

/**
 * Joins runs of consecutive single-character lines back into tokens.
 *
 * This exists to *recognise* fragmentation, not to repair a question for
 * display. A MathML document carries no inter-token spacing, so joining
 * `<mi>C</mi><mi>l</mi>…` yields "ClassInterval", and the `<mtable>` rows that
 * made it a table are gone either way — a repaired fragment reads like content
 * while no longer meaning what the paper meant. Callers therefore use the
 * repaired text to judge the context (is it a truncated label? a duplicate of
 * the prompt?) and discard it rather than show it.
 *
 * Two deterministic guards keep real content intact:
 *
 *   - a run must be at least four lines long;
 *   - the joined run must contain a lowercase letter. "A/B/C/D" is a
 *     legitimate list and must never become "ABCD"; "Midpoint" is not a list,
 *     because no list is written one lowercase letter per line.
 *
 * Within a run, letters and digits concatenate and any other character — an
 * operator, a bracket — becomes its own token, so "M i d p o i n t =" joins to
 * "Midpoint =" rather than "Midpoint=".
 */
export function joinCharacterFragments(text: string): RepairedFragment {
  if (!text.includes("\n")) return { text, repaired: false };

  const lines = text.split("\n");
  const output: string[] = [];
  let repaired = false;
  let index = 0;

  while (index < lines.length) {
    let end = index;
    while (end < lines.length && lines[end].trim().length === 1) end += 1;
    const run = end - index;

    if (run < MIN_FRAGMENT_RUN) {
      output.push(lines[index]);
      index += 1;
      continue;
    }

    const characters = lines.slice(index, end).map((line) => line.trim());
    // A run written entirely in capitals or symbols is a list or a column, not
    // a word broken apart. Nothing is joined and the lines are kept as they are.
    if (!characters.some((character) => /[a-z]/.test(character))) {
      for (let cursor = index; cursor < end; cursor += 1) output.push(lines[cursor]);
      index = end;
      continue;
    }

    const tokens: string[] = [];
    for (const character of characters) {
      const alphanumeric = /[A-Za-z0-9]/.test(character);
      if (alphanumeric && tokens.length > 0 && /[A-Za-z0-9]$/.test(tokens[tokens.length - 1])) {
        tokens[tokens.length - 1] += character;
      } else {
        tokens.push(character);
      }
    }
    output.push(tokens.join(" "));
    repaired = true;
    index = end;
  }

  return { text: repaired ? output.join("\n") : text, repaired };
}

/* -------------------------------------------------------------------------
 * Prose
 * ---------------------------------------------------------------------- */

/** A word for the purpose of recognising prose: two or more letters. */
const PROSE_WORD = /[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ'’-]+/g;

/**
 * Words needed before a context reads as prose.
 *
 * Six is one below the shortest genuine passage in the live corpus —
 * "Questions 21 - 30 are based on Chukwuemeka Ike's The Potter's Wheel", which
 * has nine — and comfortably above every malformed one, which have between
 * zero and three between them.
 *
 * This threshold only chooses the *label* on kept material: prose is shown as a
 * passage and everything else as a given. Both are shown, so misjudging it
 * cannot lose a student any context — which is why a plain count is safe here
 * and is never what decides whether something is discarded.
 */
const MIN_PROSE_WORDS = 6;

export function isProse(text: string): boolean {
  return (text.match(PROSE_WORD) ?? []).length >= MIN_PROSE_WORDS;
}

/** A relation or an operator — what makes a line of symbols say something. */
const RELATION = /[=<>≤≥≠≈∝+×÷±∫∑√]|(?<=[\w)\]])\s*[/-]\s*(?=[\w([])/;
/** Two or more separate numbers, which is the shape of tabulated data. */
const TABULATED = /\d+(?:\.\d+)?\D+?\d/;

/**
 * Whether short, non-prose text is material rather than a label.
 *
 * ALOC Station puts its subject name in `section` for some records, so a bare
 * "Biology" arrives where a formula might. "Area = πr²" states a relation and
 * "45 300 60 200" is data; "Biology" is neither, and showing it as context
 * would put provider metadata in front of a student.
 *
 * Only consulted for text too short to be a passage, so it can never discard
 * something long enough to be source material.
 */
export function carriesMaterial(text: string): boolean {
  return RELATION.test(text) || TABULATED.test(text);
}

/* -------------------------------------------------------------------------
 * Vertically serialized mathematics
 * ---------------------------------------------------------------------- */

/** Lines needed before a stack of symbols reads as a broken layout rather than content. */
const MIN_SERIALIZED_LINES = 4;

/**
 * An equation that a converter laid out downwards: four or more lines, none of
 * which carries a word.
 *
 * "12.02 / × / 20.06 / 26.04 / × / 60.06" is the production case. A poem is
 * excluded by the same rule from the other side — every one of its lines
 * carries words — and so is any table whose headings are words.
 */
export function isVerticallySerialized(text: string): boolean {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < MIN_SERIALIZED_LINES) return false;
  return !lines.some((line) => /[A-Za-zÀ-ɏ]{3,}/.test(line));
}

/* -------------------------------------------------------------------------
 * Incomplete context
 * ---------------------------------------------------------------------- */

/**
 * A binary operator or an introducer, which cannot be the last thing a complete
 * context says. "Midpoint =" and "Given that:" promise a body that never comes;
 * "Area = πr²", "v = u + at" and "x = 5" all end on their value.
 */
const DANGLING_TAIL = /[=+\-*/×÷:;<>^,−≤≥±]$/;

/**
 * Whether a context is a label with nothing after it.
 *
 * Restricted to non-prose text, because a genuine rubric legitimately ends on a
 * colon — "Use the information below to answer questions:" is complete, and the
 * material it introduces is a separate field.
 */
export function isIncompleteContext(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (isProse(trimmed)) return false;
  return DANGLING_TAIL.test(trimmed);
}

/* -------------------------------------------------------------------------
 * Duplication of the prompt
 * ---------------------------------------------------------------------- */

/**
 * The form context and prompt are compared in.
 *
 * Presentation only, and only what is needed to see through a converter's
 * layout: comments and tags removed, the many multiplication and minus glyphs
 * unified, case folded, and all whitespace removed so that an expression broken
 * across lines compares equal to the same expression written inline.
 *
 * Nothing is evaluated, simplified or reordered. This comparison decides only
 * whether the student would be reading the same characters twice.
 */
function comparisonForm(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/gi, "")
    .replace(/[×✕✖⋅·*]/g, "×")
    .replace(/[−–—]/g, "-")
    .replace(/[÷]/g, "/")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Numbers, names and single operators — the units a duplicate must account for. */
const MEANINGFUL_TOKEN = /[a-z0-9]+(?:\.[a-z0-9]+)*|[×+\-/=^()]/g;

/**
 * Whether the context says nothing the prompt does not already say.
 *
 * Every meaningful token of the context must appear in the prompt, and the
 * context must carry at least two of them with at least one longer than a
 * single character — one shared digit is a coincidence, not a duplication.
 *
 * Deliberately one-directional: a prompt that says more than the context is
 * still a prompt that already contains it. Anything that cannot be established
 * this way is not a duplicate, and the caller keeps the context.
 */
export function contextDuplicatesPrompt(text: string, prompt: string | undefined): boolean {
  if (!prompt) return false;
  const context = comparisonForm(text);
  // Only the prompt loses its spacing, and only after the context has been cut
  // into tokens. Collapsing both first would run "20.06" and "26.04" together
  // into one token that appears in neither.
  const target = comparisonForm(prompt).replace(/ /g, "");
  if (!context || !target) return false;

  const tokens = context.match(MEANINGFUL_TOKEN) ?? [];
  if (tokens.length < 2) return false;
  if (!tokens.some((token) => token.length > 1)) return false;

  return tokens.every((token) => target.includes(token));
}

/* -------------------------------------------------------------------------
 * Classification
 * ---------------------------------------------------------------------- */

/**
 * Decides what a provider context is and whether a student may see it.
 *
 * Ordered by certainty, and answer safety first: a worked solution is refused
 * before anything else is considered, because showing one is worse than showing
 * nothing. Markup origin is read from the raw value, since `cleanText` has by
 * then removed the only unambiguous evidence of what the field held.
 *
 * A discarded context is not a rejected question. The caller drops the context
 * and re-validates the question through `checkQuestionIntegrity`, which already
 * knows how to tell a self-contained prompt from one that points at material
 * the student cannot see.
 */
export function classifyQuestionContext(input: ClassifyContextInput): ContextClassification {
  const original = (input.text ?? "").trim();
  const discarded = (kind: QuestionContextKind, detail: string): ContextClassification =>
    ({ kind, text: "", discard: true, detail });

  if (!original) return discarded("empty", "no usable text");

  if (isWorkedSolution(original)) {
    return discarded("solution", "context is labelled a worked solution");
  }

  if (RESIDUAL_MARKUP.test(original)) {
    return discarded("artefact", "markup or converter residue survived cleaning");
  }

  // Fragmentation is judged on the repaired form, never shown from it.
  const { text: repaired, repaired: wasFragmented } = joinCharacterFragments(original);

  if (isIncompleteContext(repaired)) {
    return discarded("incomplete", "context ends on an operator or introducer with no body");
  }

  /*
   * Duplication is tested before brokenness because it says more. "This is
   * malformed" leaves open whether the question needed it; "every token of this
   * is already in the prompt" settles it — nothing is lost by dropping it.
   */
  if (contextDuplicatesPrompt(repaired, input.prompt)) {
    return discarded("duplicate", "every token is already present in the prompt");
  }

  if (isVerticallySerialized(repaired)) {
    return discarded("malformed", "equation laid out one operand per line");
  }

  if (wasFragmented) {
    return discarded("malformed", "text arrived fragmented one character per line");
  }

  /*
   * Mathematical markup is never prose, whatever the flattened text looks like.
   *
   * What survives `cleanText` is only the text nodes: an `<mtable>` whose
   * meaning was carried by its rows leaves behind a bare word, and showing that
   * word as though it were the table would be worse than showing nothing. It is
   * kept only when it still states a relation or carries data.
   */
  if (hasMathMarkup(input.raw)) {
    return carriesMaterial(original)
      ? { kind: "given", text: original, discard: false }
      : discarded("malformed", "mathematical markup did not survive as readable text");
  }

  return isProse(original)
    ? { kind: "passage", text: original, discard: false }
    : { kind: "given", text: original, discard: false };
}
