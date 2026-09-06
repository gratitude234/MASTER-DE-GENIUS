# M7 — Live ALOC question provider

This release adds a second question provider behind the existing
`QuestionProvider` abstraction. The Practice Engine, Exam Engine, Results,
mistake bank, offline queue, PWA and Supabase schema are unchanged.

> **The live integration is not yet proven.** The ALOC access token available
> during implementation was rejected by the API, so no real question has passed
> through this adapter. Everything below is implemented, type-checked, linted,
> built and unit-tested against fixtures. See **Live verification status**.

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

**These identifiers are provisional.** They follow the published legacy subject
list but have not been confirmed against a live response. Run
`npm run aloc:smoke -- --verify-subjects` once a valid token exists; it probes
every mapping and reports which the API accepts.

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
{ years: true, topics: false, difficulty: false, passages: true, assets: false, explanations: false }
```

`topics` and `difficulty` are false because the legacy API cannot filter on them.
`assets` and `explanations` are false because neither could be confirmed against
a live response; the normalizer still passes both through when a payload
contains them, so the product under-promises rather than over-promises.

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

| Check | Result |
| --- | --- |
| Endpoint reachable | **Yes** — `questions.aloc.com.ng` responds |
| Header name confirmed | **Yes** — `AccessToken` is read; `Authorization: Bearer` is not |
| Token accepted | **No** — `HTTP 406 {"status":406,"error":"Access token not valid or deactivated"}` |
| Live smoke test | **Failed on credentials**, not on code |
| Response schema confirmed | **No** — no authenticated response was ever obtained |
| Practice flow (Flow A/B) | **Not run** — needs a working token |
| Mock flow (Flow C) | **Not run** — needs a working token |

The configured token returns byte-identical output to a deliberately invalid
token, and an unauthenticated request returns a different error
("Access token not provide on request header"), which proves the header is being
read correctly. This is a credential problem.

`npm run aloc:smoke` currently reports:

```
[questions] provider=aloc path=/q/3 exam=utme subject=physics attempt=1/3 status=406 ms=1232 failed
ALOC connectivity: FAILED
QuestionProviderAuthError: ALOC rejected the access token (status 406): Access token not valid or deactivated
```

That output is itself a partial verification: the adapter reached the real API,
classified the failure correctly, did not retry an auth error, and logged
nothing sensitive.

**Because no authenticated response was seen, the field names in the normalizer
(`id`, `question`, `option`, `answer`, `section`, `image`, `solution`,
`examyear`) follow published documentation, not observed data.** The normalizer
accepts several shapes per field and discards anything it cannot resolve, so a
schema difference degrades into visible discards rather than corrupt questions.
The first run of `npm run aloc:smoke` with a valid token will confirm or correct
this in seconds — a high `unresolved_answer` or `invalid_structure` count in the
log is the signal that a field name differs.

## Verification performed

| Gate | Result |
| --- | --- |
| `npm test` | **81 passed**, 0 failed (was 25 at M6) |
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

- **No live verification.** The token is rejected; nothing has been proven end to
  end against real data.
- **Subject identifiers are provisional** until `--verify-subjects` runs.
- **Agricultural Science is unavailable** through ALOC pending verification of its
  upstream identifier. A student who selected it can still practise their other
  subjects, but the full mock is blocked while it is one of their four.
- **Topic and difficulty practice are unavailable** while ALOC is active. The UI
  hides both rather than ignoring them.
- **Explanations are unconfirmed.** Practice mode shows correctness with no
  explanation when the source supplies none. No explanation is ever fabricated.
- **Inventory is unknown.** Whether ALOC can supply 60 unique English plus 40 per
  subject in one session is untested. If it cannot, mock creation reports a
  shortage rather than weakening the blueprint.
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
