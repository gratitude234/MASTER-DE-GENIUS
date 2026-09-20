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
| `missing_referenced_asset` | "diagram/figure/graph/table/map/image … above\|below" | an asset |
| `missing_referenced_context` | "statement(s)/sentence/information … above", "from the above", "shown above" | a passage or an asset |
| `missing_underlined_context` | "underlined word/phrase/expression", "the word in italics" or "in bold" inside a sentence | nothing — see below |
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
