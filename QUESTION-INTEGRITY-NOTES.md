# Question integrity — instructions, context and rejection

Students were being served questions that were structurally valid but impossible
to answer:

```
prompt:  "mischief"                                   options: Christmas / ritual / Brochure / Champagne
prompt:  "The image in the quotation above depicts the speaker's"   (no quotation on screen)
```

MASTER must never knowingly present a question that cannot be understood from
what the student can see. Two layers now enforce that: legitimate context is
**preserved**, and what is still incomplete is **rejected and replaced**.

Nothing in this system writes examination content. Missing instructions,
passages and diagrams are detected, never reconstructed.

## 1. Instruction is a first-class canonical field

`CanonicalQuestion.instruction` is separate from `passage`:

| field | meaning | example |
| --- | --- | --- |
| `instruction` | the task | "Choose the option opposite in meaning to the word given." |
| `passage` | source material the student must read | a comprehension extract |
| `prompt` | the question itself | "mischief" |
| `assets` | what the student must look at | a diagram |

It is not secret, so it flows into the student snapshot with everything else
that is safe. No migration was needed: session snapshots are `jsonb`, and the
optional property simply appears in new ones.

## 2. How ALOC `section` is classified

`section` is not a passage field. Live responses put instruction text in it for
most English questions, and only comprehension questions carry `hasPassage: 1`.
The instruction used to be recognised and then discarded — that is what produced
the orphaned "mischief".

`normalizeSection()` now returns both halves, deterministically:

| input | result |
| --- | --- |
| `hasPassage` truthy | passage (the provider's flag is authoritative) |
| `hasPassage` falsy | instruction |
| flag absent, rubric-shaped text (≤ 300 chars) | instruction |
| flag absent, ≥ 40 chars | passage |
| anything shorter | discarded |

Rubric recognition does not match whole sentences, which would only ever
recognise the fixtures it was written from. Two independent markers:

1. **a task verb opening a sentence** — `choose|select|pick|complete|fill|read|study|…`
   anchored to the start of the text *or* of any later sentence, so
   "For each of the following questions, **select** from the options lettered A to D…"
   is recognised even though the imperative is not the first word;
2. **examination register** — wording that appears in a rubric and effectively
   never in narrative prose: "nearest/opposite in meaning", "options lettered
   A to D", "from the alternatives provided", "most appropriate", "best
   completes", "numbered gaps", "possible interpretations", "in italics".

Anchoring the verb to a sentence boundary is what keeps prose out: "He had to
choose between two paths" and "She weighed the options carefully" both stay
passages. Text matching neither marker is left to the length rule, so an
unrecognised rubric is still shown to the student as a passage rather than
discarded — the recogniser can miss, but it cannot lose context. And because a
truthy `hasPassage` short-circuits everything, no recogniser can demote real
source material.

Residual, documented limits: a rubric longer than 300 characters is treated as a
passage (mislabelled, never lost), and a short passage whose first sentence
begins with an imperative would be read as a rubric when the provider sends no
flag at all.

ALOC Station uses the same classifier, with one Station-specific rule: its
dedicated `passage` field is authoritative, and any `section` text beside it is
the instruction. Provider field names (`section`, `questionHtml`, `hasPassage`,
`correctAnswer`, `difficultyLevel`) never leave the adapter.

## 3. What the validator rejects

`features/questions/integrity.ts` — pure, synchronous, no AI, no network. It is
the only place this decision is made; UI components carry no ad-hoc checks.

| reason | trigger | satisfied by |
| --- | --- | --- |
| `missing_passage_context` | "passage/quotation/extract/poem/text … above\|below" | a passage |
| `missing_referenced_asset` | a question that depends on a visual — see "Question visuals" below, which widened this from the original "… above\|below" rule | an asset |
| `missing_referenced_context` | "statement(s)/sentence/information … above", "from the above", "shown above" | a passage or an asset |
| `missing_underlined_context` | "underlined word/phrase/expression", "the word in italics" or "in bold" inside a sentence | nothing — see below |
| `duplicate_option_content` | two options a student would read as the same answer — see "Question visuals" below | nothing — the question is unanswerable |
| `orphan_fragment` | a bare lexical fragment with no instruction, passage or asset | an instruction |

The orphan-fragment heuristic is deliberately **not** a length rule. A prompt is
a fragment only when *all* of these hold: at most three words, no sentence
punctuation, no blank, no digits or mathematical symbols, no finite verb, and no
interrogative or imperative opening. "2 + 2 = ?", "Simplify 3x + 6", "The capital
of Nigeria is" and "H₂SO₄ is a strong" all stay valid.

### Intentionally unsupported: rich-text emphasis

The canonical model is plain text — provider markup is stripped so the product
renders safely without `dangerouslySetInnerHTML`. A question that says "the
underlined word", or "the word in italics" for the same task, inside a full
sentence therefore cannot be answered: the emphasis is gone and which word was
meant is unknowable. Those questions are rejected rather than guessed at. The
common ALOC shape where the prompt *is* the expression ("mischief") and only the
instruction mentions the emphasis is still served: nothing is ambiguous there.

## 4. Replacement, and the fetch bound

`assembleDeliverableQuestions()` in `features/questions/service.ts` fetches,
validates and tops up. A student who asked for 20 gets 20 valid questions, not 17.

- Each round requests only the shortfall.
- Every source id already seen — accepted, rejected, excluded or admin-blocked —
  is carried into the next round's exclusion list, so a replacement is never a
  duplicate and a bad record is never re-fetched.
- **Bound: 3 provider invocations** (1 + `MAX_INTEGRITY_TOPUP_ROUNDS`), and a
  round that returns no new candidate ends the loop immediately. Each provider
  invocation is itself already bounded (legacy ALOC ≤ 8 upstream requests,
  Station ≤ 12), so the worst case is finite and a provider with bad inventory is
  never hammered.
- Requested filters (exam, subject, year, topic, difficulty) are never relaxed to
  top up. A genuine shortage surfaces through the existing paths: the mock
  inventory-shortage error, or a shorter practice session.

Rejected questions never enter a frozen session, so they cannot consume an answer
slot, affect a score, or reach progress, weakness analytics or the mistake bank.

Billing is untouched: the plan allowance is reserved once per request, outside
this loop, so replacement rounds cannot double-charge.

## 5. Diagnosing a bad question

One aggregated `console.warn` per assembly, only when something was refused:

```
[questions] integrity provider=aloc exam=jamb subject=use-of-english requested=20
  delivered=20 rejected=3 rounds=2 reasons=orphan_fragment=2,missing_passage_context=1 ids=91 104 233
```

It carries provider, provider question id, exam, subject and reason — never an
answer key, an explanation or anything identifying a student. The admin external
question inspector (`/admin/questions/external`) shows the same verdict for a
question that was already served, alongside the frozen instruction.

Integrity rejection is **not** an admin block: it creates nothing, and the
blocklist stays a human decision. Existing blocks are still applied in every
round, including replacement rounds.

## 6. Internal questions

Internal questions are protected by the same validator — the guard lives in the
shared service both Practice and Mock use, not in any provider.

No `instruction` column was added. Internal authoring writes the whole question
in `question_text`, and the admin editor has no passage authoring either
(passage membership is set outside it), so a column plus editor support would
have been schema complexity with no author to use it. An internal question whose
prompt is a bare word with no instruction is rejected exactly like a provider
one; the fix is to author the instruction into the question text.

---

# Question visuals — preservation, dependency and duplicate options

Three questions were delivered to students in this state:

```
Mathematics 2018  "Using the table,What is the modal age?"     A 4  B 5  C 5  D 7
Mathematics 2009  "The histogram above represents the number of candidates…"
Chemistry   2025  "From the graph, it can be inferred that"
```

No table, no histogram, no graph. All three came from ALOC Station, and **all
three had an image upstream**. Section 3 above was not wrong; it was incomplete,
in two independent places.

## 1. The visual was discarded at the adapter

`normalizeStationQuestion` read `record.assets ?? record.image`. A Station
record has neither. Its seventeen keys are:

```
id, text, options, correctAnswer, examType, subject, year, educationLevel,
classLevel, section, imageUrl, questionNumber, country, category, institution,
state, provenance
```

The field is **`imageUrl`**, verified live on 2026-09-20 against both
`/questions` (the endpoint Practice uses) and `/questions/{id}`. Every Station
diagram, graph, histogram, table, venn diagram and pie chart in the catalogue
was therefore dropped at one line — across 3,978 unique questions served so far,
**not one** carried an asset.

The provider had all three images:

| question | provider id | `imageUrl` |
| --- | --- | --- |
| Maths 2018 Q46 | `2ac31703…` | `…/JAMB_MATH_2018_Q46_ypiyhc.jpg` |
| Maths 2009 Q47 | `213f8f9e…` | `…/JAMB_MATH_2009_Q47_kmqtw2.jpg` |
| Chemistry 2025 Q34 | `bd6e7acb…` | `…/Chemistry_2025_Q34_sawho2.png` |

Field selection now lives in one shared `normalizeQuestionAssets`, beside the
text cleaner and the instruction/passage classifier, so a single adapter cannot
quietly disagree with the others again. It reads every observed media field,
accepts a string, an object or an array, and also recovers an `<img>` or a
markdown image from a text field — `cleanText` strips markup, so a visual inside
the question body would otherwise vanish with the tag.

Two things are deliberately refused:

- **Non-HTTPS URLs.** The product is served over HTTPS and hands the URL straight
  to the browser, so an `http://` image is blocked as mixed content. Admitting
  one would satisfy the dependency check while the student still saw nothing —
  the exact failure being fixed. Refusing it leaves no asset, so the question is
  replaced instead.
- **Worked-answer images.** A live batch of ten returned
  `…/MATH_2008_Q30_SOLUTION_nstl3`. Shown beside the prompt, that is the answer.
  A `solution|answer|explanation|worked` path *token* excludes it; matching a
  whole token is what keeps a chemistry diagram named `…_solubility` safe.

Asset ids are `provider:questionId:image`, with a content hash appended when a
question carries several. They deliberately do **not** name the field the URL
came from: an id travels into the student payload, and `imageUrl` there would
put Station's schema on the client exactly as `correctAnswer` would.

## 2. The dependency was not recognised

`VISUAL_REFERENCE` matched a noun beside "above" or "below", and nothing else.
The three questions escaped for three different reasons: "Using the table," has
no direction word, "histogram" was not in the noun list, and "From the graph,"
has no direction word either.

Recognition is now contextual — a noun that names a visual inside a grammatical
frame that can only mean "the one in front of you":

| frame | example |
| --- | --- |
| directional | "the table above", "the above diagram", "in the figure below" |
| anchored | "the diagram given", "in the diagram shown", "the figure provided" |
| directed | "using the table", "from the graph", "study the diagram", "according to the chart" |
| predicated | "the histogram shows", "the diagram represents", "this graph is" |
| enumerated | "the following table" — but never "which of the following diagrams", where it means the options |

Nouns are split by how much they can mean anything else. `diagram, histogram,
graph, table, chart, pie chart, bar chart, venn diagram, flow chart, figure, map`
carry the predicated frame on their own; `image, picture, photograph, photo,
illustration, drawing, sketch` need an explicit anchor, because "the image
height", "his public image", "the mental picture" and "personal drawings" are
ordinary English.

Three guards stop ordinary prose being refused:

1. **Fixed phrases** — "significant figures", "figure of speech", "periodic
   table", "water table", "times table" are blanked before matching.
2. **Adjacency** — only `the|this|that|these|those` immediately before the noun
   counts, so "a circular table", "the periodic table", "the print image",
   "the mental picture" and "in a pie chart" never match.
3. **Anaphora** — a noun introduced earlier in the same text with an indefinite
   article points backwards at the words, not at a picture. "…a graph of the
   mass deposited is plotted. The slope of the graph gives?" stays deliverable;
   "The slope of the graph gives?" on its own does not.

The rules were designed and measured against the **123 questions in the live
frozen corpus that mention a visual noun at all**. Of those, 67 are genuine
references and all 67 are caught; 56 are non-referential and none is refused.
Both directions were reviewed question by question.

One documented, conservative loss: a question whose table is spelled out as text
in its own prompt ("Use the table below… Zone © (mm) / I 45 300 / …") is still
refused, because the table is not an asset. It was 1 of the 123.

The reason code stays **`missing_referenced_asset`**. It already meant exactly
this, and renaming it would have changed the admin inspector and the diagnostic
line for no gain — this is coverage, not a redesign.

## 3. Duplicate visible option content

B and C were both "5". Duplicate option *keys* were already refused by the
adapters; duplicate option *content* was not, so the question froze with two
identical answers and any student choosing the wrong "5" was marked wrong for a
reason they could not see.

`findDuplicateOptionContent` compares only presentation: zero-width characters
removed, Unicode spaces normalised, whitespace runs collapsed, ends trimmed.
Nothing is evaluated and no punctuation is stripped, so `1/2` and `0.5`,
`2+2` and `2 + 2`, `7!/3!` and `7!/3!4!`, `√((3T-K)/M)` and `√((3T-M)/K)`,
`NO₂` and `N₂O`, and `teacher's`, `teacher` and `teachers` all stay distinct.
HTML needs no handling: `cleanText` has already removed tags and decoded
entities, so `<b>5</b>`, `&nbsp;5` and `5` arrive identical and are caught.

Case is folded on the **first character only**, and only when the option list is
not marking stress. Folding the whole string would be wrong twice over: English
papers set stress questions whose options differ *only* in capitalisation — the
live corpus holds `aSSociation / associaTION / associAtion / Association.` as
four distinct answers — and chemistry distinguishes `CO` from `Co`. A capital
inside a word anywhere in the list switches the comparison to exact, which is
what keeps `dedicaTION / deDIcation / dedication / Dedication` intact while
still catching `Receive` / `receive` and `Abuja` / `" Abuja "`.

The reason is `duplicate_option_content`, and it is checked in
`checkQuestionIntegrity` rather than in an adapter, so internal questions and all
three providers are covered by one rule and rejection feeds the existing bounded
top-up.

## 4. Prompt sanitation

`cleanText` now restores a space lost after punctuation, and only between a
lowercase letter or digit and an uppercase letter. That is the narrowest rule
that fixes "table,What" while leaving every initialism in the live corpus
untouched — "A.V. Dicey", "S.I unit", "E.C.O.W.A.S", "S.V.P" and "I.S∩T∩W" all
have an uppercase letter before the stop. A digit after the stop is excluded, so
"0.02174", "2,000" and "N8,000" are unchanged, and a lowercase letter after it is
excluded, so "f(x,y)" keeps its shape.

Across 3,978 frozen prompts it changes exactly two: `table,What` → `table, What`
and `Dr.Fajir` → `Dr. Fajir`. No word is added, removed, reordered or respelled.
This is typography, not grammar, and no AI is involved.

## 5. Rendering

One component, `components/questions/question-visual.tsx`, is used by Practice,
the Mock runner, answer review and the admin external inspector. Three copies is
how a graph ends up legible in Practice and cropped in the exam.

The exam context sets the rules: `w-full` + `h-auto` + `object-contain` means
full column width, true aspect ratio and no cropping; the cap is a viewport
fraction rather than a pixel box, so a tall table stays readable on a 360px
screen instead of becoming a thumbnail; the figure clips rather than pushing the
page wide; every visual can be opened full-size, because a candidate reading an
axis label needs to zoom; and a remote image that fails to load says so in
words, because a broken-image icon next to "From the graph, it can be inferred
that" tells a student nothing about whether the question or their connection is
at fault. Alt text is the provider's when it supplied one.

The URL goes straight into `<img src>`. Nothing is fetched server-side, so the
app is not an open image proxy and there is no SSRF surface; the browser loads
it as an ordinary third-party image, and the existing service worker still
caches it for offline use.

## 6. Existing sessions

Nothing is mutated. Frozen snapshots are history — a completed session's score
was computed from what the student actually saw, and rewriting it would make the
score unexplainable.

Measured against the shipped rules:

| | practice | mock |
| --- | --- | --- |
| frozen questions | 3,565 | 3,060 |
| missing referenced visual | 35 | 51 |
| duplicate option content | 27 | 19 |
| sessions holding a missing visual | 18 (11 in progress) | 8 (1 in progress) |
| sessions holding duplicate options | 23 (14 in progress) | 12 (2 in progress) |

New sessions are clean from the first request: the visual is preserved, and
anything still incomplete is refused and replaced before freeze. No migration is
required — `student_snapshot` is `jsonb` and the optional asset simply appears in
new rows.

---

# Malformed question context — MathML, worked solutions and the PASSAGE card

Two Mathematics questions were served with this in the blue card headed
"PASSAGE":

```
Mathematics 2004                    Mathematics 2016
M                                   12.02
i                                   ×<!-- × -->
d                                   20.06
p
o                                   26.04
…                                   ×<!-- × -->
= … (1,1)                           60.06
```

Neither is a passage. The 2004 one is the **worked solution**, and it ends in
`(1, 1)` — which is option A. The card was showing the answer; the student only
saw the top of it because the card scrolls.

## 1. What the provider actually sent

Both are ALOC Station, both in `section`, verified live by id on 2026-09-20:

| | provider id | `section` |
| --- | --- | --- |
| Maths 2004 Q5 | `e2a44f19…` | 1,507 chars of MathML — the worked solution |
| Maths 2016 Q32 | `ecdd92bb…` | 276 chars of MathML — the prompt's own fraction |

```xml
<math xmlns="http://www.w3.org/1998/Math/MathML">
  <mi>M</mi>
  <mi>i</mi>
  <mi>d</mi>
  …
  <mo>&#x00D7;<!-- × --></mo>
```

It is MathJax output (`data-mjx-texclass` appears throughout), pretty-printed
one element per line. Two upstream properties explain everything on screen:

- **"Midpoint" is eight `<mi>` elements.** A multi-letter name in TeX maths mode
  is a product of single-letter identifiers, so the converter emits one per
  character. **The character fragmentation is upstream. MASTER did not create
  it** — but MASTER turned the converter's indentation into content, because
  `cleanText` preserves newlines and the text nodes were one per line.
- **`<!-- × -->` annotates the entity beside it.** `<mo>&#x00D7;<!-- × --></mo>`
  is a numeric entity plus a note saying which character it is.

## 2. Three defects, stacked

| # | where | defect |
| --- | --- | --- |
| 1 | upstream | `section` holds MathML, and for 13 records a worked solution |
| 2 | `cleanText` | `TAG` requires a letter after `<`, so `<!--` never matched and comments reached students |
| 3 | `normalizeSection` | length ≥ 40 was the *only* positive test for a passage |

Defect 3 is the classification bug. "Long enough" is not evidence of prose, so
any 40-character provider value became source material.

## 3. Classification is now positive, and reads the raw value

`features/questions/context.ts` — pure, synchronous, no AI, no network, beside
`integrity.ts` for the same reasons.

The decisive signal is read **before** `cleanText` runs: a `<math>` element in
the raw value is machine-readable proof the field is mathematical markup, which
no amount of inspecting the flattened text could establish as certainly.

Ordered by what each verdict settles, answer safety first:

| verdict | rule | live |
| --- | --- | --- |
| `solution` | begins `Solution:` / `SOLUTION` / `Solution.` | 13 |
| `artefact` | markup or TeX residue survived cleaning | 1 |
| `incomplete` | ends on an operator or `:` and is not prose | 0 |
| `duplicate` | every meaningful token is already in the prompt | 12 |
| `malformed` | ≥ 4 lines none carrying a word; or character fragmentation; or markup that left no material | 7 |
| `given` | legitimate non-prose material — a formula, a table | 0 |
| `passage` | prose | 70 |

`duplicate` is tested before `malformed` because it says more: "this is broken"
leaves open whether the question needed it, while "every token of this is
already in the prompt" settles that nothing is lost by dropping it.

### Character-fragment repair is a detector, not a repair

`joinCharacterFragments` joins runs of ≥ 4 single-character lines, and only when
the joined run contains a lowercase letter — which is exactly what keeps a
legitimate `A / B / C / D` list from becoming "ABCD", since no list is written
one *lowercase* letter per line. Letters and digits concatenate and any other
character becomes its own token, so `M i d p o i n t =` joins to `Midpoint =`.

Its output is used to **judge** a context and never to show one. MathML carries
no inter-token spacing, so joining `<mi>C</mi><mi>l</mi>…` yields
"ClassInterval", and the `<mtable>` rows that made it a table are gone either
way. A repaired fragment reads like content while no longer meaning what the
paper meant, which is worse than showing nothing.

## 4. Whether a question survives without its context

Nothing new decides this. The context is dropped and the question is re-judged
by the existing `checkQuestionIntegrity`: a prompt that points at material the
student cannot see was already its job. Measured against all 33 malformed
contexts in the live corpus, it is right every time:

- **31 kept** — "Find the midpoint of the line joining P(-3, 5) and Q(5, -3)."
  carries its own numbers, and what was removed was the answer.
- **2 rejected** — "Find the standard deviation of the above distribution."
  (the `<mtable>` *was* the table) and "Find the value of x in the figure above"
  (no `imageUrl` upstream). Both feed the existing bounded same-provider top-up.

Two reason codes were added, and no existing one was renamed:
`malformed_context` and `incomplete_context`. They re-label only the three
verdicts a context could have satisfied — `missing_passage_context`,
`missing_referenced_context`, `orphan_fragment`. A missing *diagram* stays
`missing_referenced_asset`, because the provider sent no image either way and
saying otherwise would send an admin after the wrong defect. The re-labelling
never changes a verdict, only its name.

## 5. PASSAGE is reserved for prose

`QuestionPassage` gained an optional `kind`. Absent — which is every snapshot
frozen before this — means `"passage"`, so history renders exactly as it did and
no migration is needed (`student_snapshot` is `jsonb`).

`contextHeading()` and `isProseContext()` are the single source of the label,
used by Practice, the Mock runner, answer review and the admin inspector, for
the same reason one component renders every visual: four copies is how a formula
ends up called a passage on one screen and something else on another. Non-prose
material is still **shown** — losing a formula would be its own defect — under
"Given" rather than "Passage".

`MIN_PASSAGE_LENGTH` no longer discards short material that states a relation or
carries data: "v = u + at" is not a short passage, it is a different kind of
thing. It still discards a bare label, which is how Station's occasional
`section: "Biology"` stays out.

## 6. Corpus audit

Read-only, over all 6,665 frozen questions (3,605 practice, 3,060 mock).

| | |
| --- | --- |
| frozen rows carrying a context | 458 |
| distinct contexts | 103 |
| distinct contexts discarded | 33 — **all Mathematics, all ALOC Station** |
| frozen rows affected | 44 |
| rows whose card showed a worked solution | 18 |
| rows leaking the correct option text | **11** |
| distinct contexts kept | 70 — English 58, Civic 6, Commerce 3, Accounts 2, Economics 1 |
| genuine passages wrongly discarded | **0** |
| malformed contexts still shown | **0** |

Years span 2000–2023; no year is unaffected and none dominates. Every malformed
context is a `<math>` document, and no non-MathML context is discarded.

## 7. Existing sessions

Nothing is mutated. A completed session's score was computed from what the
student actually saw, and rewriting it would make the score unexplainable.

| | |
| --- | --- |
| sessions/attempts holding an affected question | 15 |
| practice in progress | 5 |
| practice completed | 5 |
| mock in progress | 1 |
| mock submitted | 4 |
| sessions that were showing a worked solution | 10, of which **4 still in progress** |

New sessions are clean from the first request. For the four in-progress sessions
still displaying a worked answer, the recommendation is **not** to rewrite the
snapshot but to let them finish: the answer was already visible, so removing it
mid-session changes the question under the student without undoing the exposure,
and grading is unaffected either way. If that is judged unacceptable, the safe
action is to void those four sessions rather than edit them — a decision for the
product owner, not a migration.

## 8. Known, unfixed: `<sup>` in prompts

Out of scope here and reported rather than bundled, because it is a different
defect with a different cause. Station sends `Integrate (x<sup>2</sup>-√x)/x`,
`cleanText` strips the tag, and the student reads `x2` where the paper said
`x²`. 41 distinct Mathematics prompts in the live corpus show this shape. A
deterministic fix exists — map `<sup>`/`<sub>` to Unicode superscripts when the
content is a digit or sign — but it rewrites prompt text across the corpus and
touches answer-option matching, so it deserves its own change and its own
verification.
