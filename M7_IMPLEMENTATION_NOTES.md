# M7 — Live ALOC question provider

This release adds a second question provider behind the existing
`QuestionProvider` abstraction. The Practice Engine, Exam Engine, Results,
mistake bank, offline queue, PWA and Supabase schema are unchanged.

> **Verified against the live API.** Real UTME questions now flow through the
> adapter for all 14 mapped subjects, including a full 60-question English paper.
> Two findings from that verification are recorded below: the Agricultural Science
> quarantine is confirmed correct, and the passage rule was corrected. Practice and
> Mock flows have still not been exercised end to end in a browser.

## Files created

| File | Purpose |
| --- | --- |
| `features/questions/errors.ts` | Provider error taxonomy with student-safe messages |
| `features/questions/providers/aloc/index.ts` | `AlocQuestionProvider`: batching, deduplication, capability guards |
| `features/questions/providers/aloc/transport.ts` | HTTP: auth header, timeout, bounded retries, error classification |
| `features/questions/providers/aloc/normalize.ts` | Raw ALOC record → `CanonicalQuestion` |
| `features/questions/providers/aloc/mapping.ts` | Exam and subject mappings |
| `scripts/aloc-smoke.mjs` | Live connectivity / normalization check |
| `scripts/alias-hook.mjs` | Lets Node run the app's TypeScript modules in scripts and tests |
| `tests/aloc-normalize.test.mjs` | 20 normalization and security tests |
| `tests/aloc-provider.test.mjs` | 12 batching, deduplication and registry tests |
| `tests/aloc-transport.test.mjs` | 15 timeout, retry and secret-leak tests |
| `tests/aloc-subject-availability.test.mjs` | 9 subject-quarantine regression tests |

## Files changed

| File | Change |
| --- | --- |
| `features/questions/providers/index.ts` | Registers `aloc`; `internal` unchanged |
| `features/questions/service.ts` | Refuses filters the active provider cannot honour; exposes safe capability metadata |
| `features/practice/api.ts`, `features/exams/api.ts` | Map provider errors to student-safe responses |
| `features/questions/providers/types.ts` | Optional `supportsSubject` on the provider interface |
| `app/(student)/practice/page.tsx` | Passes provider capabilities and unavailable subjects |
| `components/practice/practice-setup.tsx` | Hides unsupported filters; disables unavailable subjects |
| `features/exams/types.ts`, `features/exams/service.ts` | `available` flag per mock subject |
| `components/exam/mock-exam-setup.tsx` | Blocks a mock the active source cannot build |
| `.env.example`, `package.json` | ALOC configuration and `npm run aloc:smoke` |

`features/practice/service.ts` and `features/questions/delivery.ts` were **not**
modified. `features/exams/service.ts` gained one line: an `available` flag on each
mock subject, so the UI can refuse a paper before an attempt is created.

## Endpoint strategy

Base URL `https://questions.aloc.com.ng/api/v2`, header `AccessToken: <token>`.

- `GET /q?subject=<s>&type=utme` — a single question (used when one is needed)
- `GET /q/{n}?subject=<s>&type=utme` — a batch, `n` capped at 40
- `year=<yyyy>` is appended when the student selects a year

`/m` is not used: its payload shape could not be verified.

Sessions larger than one response are assembled from several bounded calls:

```
English needs 60  ->  /q/40  ->  normalize, dedupe  ->  /q/20  ->  normalize, dedupe  ->  stop at 60
```

Bounds: at most 8 upstream requests per session, and the loop stops after two
consecutive rounds that add no new question (ALOC returns random questions, so
repeats mean the usable pool is exhausted). A shortage is returned as a short
list; questions are never duplicated to pad a request. The Mock Exam Engine
still rejects an incomplete paper with its existing `MOCK_INVENTORY_SHORTAGE`.

## Exam mapping

| Internal | ALOC | Status |
| --- | --- | --- |
| `jamb` | `utme` | Implemented |
| `waec`, `neco`, `post_utme`, `school` | — | Unsupported error, never a wrong query |

## Subject mapping

Fourteen JAMB subjects are mapped inside the adapter:

`use-of-english→english`, `mathematics→mathematics`, `physics→physics`,
`chemistry→chemistry`, `biology→biology`, `economics→economics`,
`government→government`, `commerce→commerce`,
`literature-in-english→englishlit`, `principles-of-accounts→accounting`,
`geography→geography`, `christian-religious-studies→crk`,
`islamic-studies→irk`, `history→history`.

The remaining catalogue subjects (French, Hausa, Igbo, Yoruba, Arabic, Music,
Fine Art, Home Economics) raise an unsupported-subject error.

**These identifiers are provisional.** They follow the published legacy subject
list but have not been confirmed against a live response. Run
`npm run aloc:smoke -- --verify-subjects` once a valid token exists; it probes
every mapping and reports which the API accepts.

### Quarantined mappings

**Agricultural Science is quarantined and is not served by ALOC.** Its suspected
identifier (`agriculture`) is unverified, so it is held in a separate
`QUARANTINED` table rather than in the active mapping. A quarantined subject
behaves exactly like an unmapped one: no request is ever sent for it, and the
product does not offer it while ALOC is active.

The candidate identifier is kept only so it can be probed:
`npm run aloc:smoke -- --verify-subjects` now reports a
"Quarantined mappings" section that tests each candidate directly through the
transport, without any chance of it reaching a student session first.

To promote one: confirm it with the smoke script, move the row into `SUBJECTS`,
and update `tests/aloc-subject-availability.test.mjs` — the regression test
asserts the quarantine, so lifting it has to be deliberate.

## Normalization

`CanonicalQuestion.source` is `{ provider: "aloc", providerQuestionId: String(id),
internalQuestionId: null }`. Option ids are deterministic (`aloc:<id>:<KEY>`),
never random. Option keys normalize from `a`, `A`, `option_a`, `C)` to `A`–`E`;
four- and five-option questions are both supported, and an empty fifth option is
dropped rather than delivered blank.

The answer key resolves by letter first, then by an unambiguous match against
option text. Anything else discards the question — including numeric answers,
which are an unverified format. **No question is ever graded on a guessed key.**

A record is discarded (never crashing the batch) when it has a missing id, an
empty prompt, fewer than two usable options, duplicate option keys, an
unresolvable answer, or an invalid structure. Discard reasons are counted and
logged per request.

`section` becomes a passage only when it carries at least 40 characters of body
text; questions quoting the same passage share one deterministic id derived from
the body hash. Shorter instruction text yields `passage: null` rather than a
fabricated passage.

Question text is normalized to safe plain text: line-break tags become newlines,
remaining markup is stripped, then entities are decoded. Decoding **after**
stripping is deliberate — it keeps `&lt;` as a literal `<` rather than letting it
look like a tag, so `x < 5` survives. The product keeps its single safe React
renderer; no `dangerouslySetInnerHTML` was introduced.

The upstream `examyear` is preserved in `CanonicalQuestion.year` and is never
replaced with the student's target exam year.

## Capabilities

```ts
{ years: true, topics: false, difficulty: false, passages: true, assets: false, explanations: true }
```

`topics` and `difficulty` are false because the legacy API cannot filter on them.

`explanations` is **true**, confirmed live: UTME records carry a populated
`solution` field (5/5 Physics, 35/60 English in sampled runs). `assets` stays
false because every observed `image` field was empty, so the capability is not
claimed; the normalizer still passes an image through if one appears.

A filter the provider cannot honour is refused in `fetchCanonicalQuestions`
**before** a session is created, and again inside the provider as defence in
depth. Practice Setup hides the topic picker (replacing it with a
whole-subject note) and hides the difficulty control, so a student cannot ask for
`Physics → Waves` and receive unrelated Physics questions under that label.

### Subject availability

The provider interface gained an optional `supportsSubject(examBody, subjectSlug)`.
A provider that omits it — including `InternalQuestionProvider` — covers the whole
catalogue, so nothing about the internal path changed. ALOC implements it as
"JAMB, and a mapping that is neither missing nor quarantined".

The product reads it in two places:

- **Practice Setup** renders an unavailable subject as a disabled button labelled
  "Not available yet", never selects one by default, refuses to select one on
  click, and never sends it to the API.
- **Mock Setup** marks the affected subject in the structure grid, explains the
  block in student language, and disables "Begin Full Mock" so no attempt is
  created that the source cannot fill.

Both are presentation gates over the same server-side truth; the provider still
refuses the request on its own, so bypassing the UI changes nothing.

## Timeout, retries and errors

One central `REQUEST_TIMEOUT_MS = 10_000` via `AbortController`. At most 3
attempts. Retried: 429, 500, 502, 503, 504, network failures, timeouts.
Never retried: 400, 401, 403, 404, and the 406 token rejection. `Retry-After` is
honoured (capped at 60s); otherwise exponential backoff with jitter.

The legacy API does not use HTTP status codes consistently — a rejected token
returns HTTP 406 while the body reports 400 or 406 — so classification reads both
and prefers the body code when usable.

Errors reach students as `QuestionProviderError.studentMessage` only
("Questions are temporarily unavailable. Please try again shortly."). Upstream
status codes, vendor wording and the provider name stay in server logs.

## Logging

One line per upstream call (path, exam, subject, attempt, status, duration,
outcome) and one summary per session (requested, requests, received, unique,
discard reasons). Tokens, Supabase keys, auth headers and answer keys are never
logged; a test asserts the token appears in no log line or error message.

## Live verification status

The access token was rejected during initial implementation but is now active.
Everything below was run against the real API.

| Check | Result |
| --- | --- |
| Endpoint reachable | Confirmed |
| Header name | Confirmed — `AccessToken`; `Authorization: Bearer` is not read |
| Token accepted | Confirmed |
| Response schema | **Confirmed** — see below |
| All 14 mapped subjects | **Confirmed** — 14/14 return usable questions |
| 60-question English assembly | **Confirmed** — 3 calls, 62 received, 60 unique |
| Agricultural Science quarantine | **Confirmed correct** — see below |
| Practice flow in a browser (A/B) | Not run |
| Mock flow in a browser (C) | Not run |

### Confirmed response schema

```json
{ "subject": "chemistry", "status": 200,
  "data": { "id": 485, "question": "...", "option": { "a": "...", "e": null },
            "section": "", "image": "", "answer": "b", "solution": "...",
            "examtype": "utme", "examyear": "2018" } }
```

`/q` returns an object, `/q/{n}` an array. English records carry three extra
fields: `questionNub`, `hasPassage` and `category`. Every field name assumed
during implementation was correct.

### Finding 1 — the Agricultural Science quarantine is correct

Probing the candidate identifier confirms it does not exist:

```
GET /q?subject=agriculture&type=utme
HTTP 200  PDOException: SQLSTATE[42S02]: Base table or view not found:
          Table 'alocng_storage02.agriculture' doesn't exist
```

`agriculturalscience` fails identically, and both match a deliberately bogus
control subject. ALOC maps each subject to a MySQL table and leaks a raw
Laravel stack trace for an unknown one — returned with **HTTP 200**. The
transport already treated a 200 without `data` as a failure, so this never
produced questions; its message now names the likely cause and still never
echoes the upstream body, which contains server paths.

Agricultural Science therefore stays quarantined. No identifier for it is known.

### Finding 2 — `section` is not a passage field (fixed)

Live English records put **instruction text** in `section`
("In each of questions 86 to 100, choose the option opposite in meaning to the
underlined word(s)."), and mark real comprehension questions with
`hasPassage: 1`. In a 34-record sample, 32 had a `section` longer than the
40-character threshold the normalizer originally used, and **all 32 had
`hasPassage: 0`** — so every one would have been rendered to students as a
comprehension passage it is not.

`normalizePassage` now treats `hasPassage` as authoritative when present and
falls back to the length heuristic only when the field is absent. A live
10-question English run reports `With passage: 0`, down from ~9 fabricated ones.

### Sampled live runs

```
physics, 5   -> 1 request,  5 received,  5 unique, 0 discarded, 5 explanations
english, 10  -> 1 request, 10 received, 10 unique, 0 discarded, 0 passages
english, 60  -> 3 requests (40/27/6), 62 received, 60 unique,
                discarded: empty_prompt=1, unresolved_answer=1
```

The 60-question run is the mock's hardest requirement and it succeeds. It also
demonstrates the defensive path working on real data: two malformed upstream
records were dropped without failing the batch, and the shortfall was refilled.

## Verification performed

| Gate | Result |
| --- | --- |
| `npm test` | **84 passed**, 0 failed (was 25 at M6) |
| `npm run lint` | Passed, zero warnings |
| `npm run typecheck` | Passed |
| `npm run build` | Passed, all routes compiled |

No lint rule was disabled and no TypeScript error was suppressed.

## Environment variables

```env
QUESTION_PROVIDER=aloc
ALOC_ACCESS_TOKEN=<server-only, never NEXT_PUBLIC_>
ALOC_BASE_URL=https://questions.aloc.com.ng/api/v2
```

Missing `ALOC_ACCESS_TOKEN` while `QUESTION_PROVIDER=aloc` fails with an explicit
configuration error rather than a cryptic 401. Setting `QUESTION_PROVIDER=internal`
restores the M6 behaviour with no code change.

### Vercel

Add to Project Settings → Environment Variables:

| Variable | Production value | Scope |
| --- | --- | --- |
| `QUESTION_PROVIDER` | `aloc` | All |
| `ALOC_BASE_URL` | `https://questions.aloc.com.ng/api/v2` | All |
| `ALOC_ACCESS_TOKEN` | the token | All — **secret, never committed** |

`.env.local` is git-ignored. The token must never enter the repository.

## Known limitations

- **Browser flows are unverified.** Practice, Timed Practice and the full Mock
  have not been driven end to end through the UI against a live Supabase project.
- **Agricultural Science has no known identifier.** It is not a mapping error to
  fix by guessing; the subject appears absent from the legacy dataset.
- **Agricultural Science is unavailable** through ALOC pending verification of its
  upstream identifier. A student who selected it can still practise their other
  subjects, but the full mock is blocked while it is one of their four.
- **Topic and difficulty practice are unavailable** while ALOC is active. The UI
  hides both rather than ignoring them.
- **Explanations are unconfirmed.** Practice mode shows correctness with no
  explanation when the source supplies none. No explanation is ever fabricated.
- **Per-subject inventory beyond English is unmeasured.** English supplies 60
  unique questions in 3 calls; the other subjects were only sampled at 1. If any
  cannot fill 40, mock creation reports a shortage rather than weakening the
  blueprint.
- **Legacy API is scheduled for shutdown** (announced on the ALOC site, roughly
  a year out). The adapter is split into transport / normalize / mapping so the
  transport can be replaced by ALOC Station without touching the engines.
- **No database mirroring.** Questions are used operationally and frozen only
  into the session snapshots the Practice and Exam engines already persist.

## Deferred

- Sdash provider (`SDASH_API_KEY` remains a reserved placeholder)
- ALOC Station migration
- WAEC / NECO / Post-UTME exam mappings
- An owned question bank
