# Session delivery: the 59/60 mock shortage and the opaque session-open failure

Two production reports, one root cause each, no shared cause.

- **A.** "Use of English does not yet have enough questions for a full mock
  (59/60 available)" on a JAMB full mock.
- **B.** "We could not open this session" on the Practice route, with the real
  reason discarded by the route's error boundary.

---

## A. The mock shortage

### Root cause

`assembleDeliverableQuestions` asked each top-up round for **exactly the
shortfall**:

```ts
count: query.count - questions.length,   // before
```

The replacements come from the same provider inventory as the first fetch and
are refused by `checkQuestionIntegrity` at the same rate, so a round could only
ever *narrow* the gap. With a rejection rate `p` and a bound of three provider
calls, the residual shortfall settles at about `60 · p³` — for the live JAMB
English rejection rate that is one question. Hence 59.

Measured against the real adapter with a simulated Station inventory of 400
records, 25% of them carrying the four live defect shapes:

| | before | after |
|---|---|---|
| 60-question mocks that assembled | 17/40 | 40/40 |
| most common failure value | **59/60** | — |
| upstream Station requests (avg) | 11.8 | 11.5 |

Round-by-round, before the fix:

```
round 1: asked=60  returned=60  -> 45 valid (15 refused)
round 2: asked=15  returned=15  -> 11 valid  (4 refused)
round 3: asked=4   returned=4   ->  3 valid  (1 refused)   budget exhausted at 59
```

The provider was never exhausted. It returned every question asked for in every
round and spent 11 of its 48 available upstream requests. **ALOC Station's
Use of English inventory is not short**; the assembler stopped asking.

### Fix

`topUpRequestCount(shortfall, considered, rejected)` in
`features/questions/service.ts` scales the request by the acceptance rate this
assembly has actually measured, plus a margin of two, floored at the shortfall
and capped at `MAX_BATCH_SIZE`. `MAX_INTEGRITY_TOPUP_ROUNDS` went 2 → 3 (four
provider calls); the extra round is spent only when a round still falls short,
so the average assembly now costs *fewer* provider requests than before.

### Cost safety: the assembly progress guard

The extra round raised the theoretical ceiling, and dirty inventory could reach
it while delivering nothing: `fresh === 0` only detects an *exhausted* pool, so
a pool that keeps yielding new-but-invalid source ids looked like progress and
spent the whole budget for zero questions.

So a completed **top-up** round that adds no valid question now ends the
assembly. Deliberately narrow — the initial round is exempt, so an all-bad first
batch still gets its replacements, and the test is "did this round add a valid
question", not "did it reject any": a round that delivers even one is productive
and the loop continues.

Measured, per subject, for a 60-question assembly:

| Inventory | Upstream Station requests |
|---|---|
| clean | 7.5 avg |
| 25% defective (live shape) | 11.5 avg |
| 40% defective | 15.2 avg |
| **uniformly dirty, nothing deliverable** | **24 (was 48)** |
| absolute ceiling, every top-up productive | 48, unchanged |

The ceiling is unchanged because a round that keeps delivering questions is a
round worth paying for. What is capped is paying for nothing.

Unchanged on purpose: integrity validation, the blueprint, the exclusion list,
single-provider assembly, the `fresh === 0` exhaustion break, and the rule that
a mock short of its blueprint is refused rather than shipped.

---

## B. The opaque session-open failure

### Root cause

`app/(student)/practice/session/[sessionId]/error.tsx` is the route's error
boundary. Anything thrown while opening the session — a query error, an
ownership miss, an unreadable snapshot, a renderer `TypeError` — produced the
same paragraph and left no server-side record of which it was. The failure was
not *caused* by the boundary; it was made undiagnosable by it.

Two reachable defects were found and fixed behind it:

1. **A frozen snapshot with no `assets` crashed the renderer.** Both runners and
   answer review read `question.assets.length` and `question.options.map`
   unconditionally. A snapshot missing either throws
   `Cannot read properties of undefined (reading 'length')` mid-render, which
   the boundary catches and reports as "We could not open this session".
   Reproduced directly against the runners; see `tests/runner-ui.test.mjs`.
2. **A session id that is not a uuid was a 500, not a 404.** PostgREST returns
   `22P02`, which the old code turned into a thrown error. A stale bookmark or a
   hand-edited link is a dead link, and is now refused as not-found.

### Classification

`features/sessions/diagnostics.ts` defines the failure vocabulary and one
structured log line. Students still see the same calm sentence; the server now
records which class occurred:

```
[session-open] failure=SNAPSHOT_INVALID kind=practice session=<id> position=7 detail="stored snapshot is null"
```

`SESSION_NOT_FOUND`, `SESSION_FORBIDDEN`, `SESSION_INCOMPLETE`,
`SNAPSHOT_INVALID`, `SNAPSHOT_SCHEMA_UNSUPPORTED`,
`QUESTION_DESERIALIZATION_FAILED`, `ENTITLEMENT_BLOCKED`, `QUOTA_BLOCKED`,
`RPC_FAILED`, `DATABASE_ERROR`, `UNKNOWN`.

The log carries a session id and never a user id: a session id is enough to find
the row, and pairing the two would put an identifiable trail of one student's
activity into the log.

`SNAPSHOT_SCHEMA_UNSUPPORTED` fires only for a snapshot declaring a
`schemaVersion` newer than this build. **Nothing writes that field yet** — it is
the rollback-detection hook, and starting to stamp a version into frozen
examination data belongs in its own reviewed change, not in an incident fix.

### Frozen-snapshot compatibility

`features/questions/snapshot.ts` is the single door every stored snapshot now
comes through, under two rules: *supply, never refuse* (a missing optional field
gets the default that reproduces how it rendered before the field existed) and
*read, never write* (the stored row is never migrated or rewritten).

Option count is deliberately **not** re-judged on read. The adapters refuse
`too_few_options` when a session is frozen, which is where that belongs;
re-applying it on the way out would let a rule tightened in a later release
retroactively close a session a student is halfway through.

---

## Counting affected sessions

Neither number is determinable from the repository. Run these against
production.

**Snapshots that today's reader would refuse** — the sessions that cannot open:

```sql
-- practice
select s.id, s.user_id, s.status, q.position
from practice_session_questions q
join practice_sessions s on s.id = q.session_id
where jsonb_typeof(q.student_snapshot) is distinct from 'object'
   or jsonb_typeof(q.student_snapshot -> 'options') is distinct from 'array'
   or jsonb_array_length(coalesce(q.student_snapshot -> 'options', '[]'::jsonb)) = 0
order by s.created_at desc;

-- mock
select a.id, a.user_id, a.status, q.overall_position
from exam_attempt_questions q
join exam_attempts a on a.id = q.attempt_id
where jsonb_typeof(q.student_snapshot) is distinct from 'object'
   or jsonb_typeof(q.student_snapshot -> 'options') is distinct from 'array'
   or jsonb_array_length(coalesce(q.student_snapshot -> 'options', '[]'::jsonb)) = 0
order by a.created_at desc;
```

**Legacy snapshots still in circulation** — these now open correctly, and the
count says how much old data is live:

```sql
select count(*) filter (where not (q.student_snapshot ? 'assets'))      as missing_assets,
       count(*) filter (where not (q.student_snapshot ? 'instruction')) as missing_instruction,
       count(distinct q.session_id)                                     as sessions_affected
from practice_session_questions q
where not (q.student_snapshot ? 'assets')
   or not (q.student_snapshot ? 'instruction');
```

**Sessions with no questions behind them** — `SESSION_INCOMPLETE`. The creation
RPC is a single plpgsql function and therefore atomic, so this should return
zero rows; a non-zero result means something wrote a session row outside it:

```sql
select s.id, s.user_id, s.status, s.question_count
from practice_sessions s
left join practice_session_questions q on q.session_id = s.id
group by s.id
having count(q.id) = 0;
```

Once deployed, the same questions are answerable from the logs:

```
grep '\[session-open\]' | grep -o 'failure=[A-Z_]*' | sort | uniq -c
```

---

## PWA

No evidence the service worker contributed, and its design specifically
prevents the failure mode it would be blamed for. `public/sw.js` never caches
authenticated HTML, RSC or API responses; navigations are network-first and fall
back to `/offline` only on a 5xx or a network failure. `/_next/static/` is
cache-first but content-hashed per build, so a stale asset cannot be served
under a new build's hash. There is no `skipWaiting`, so a new worker never
replaces a live one mid-session.

"Try again" calls the boundary's `reset()`, which re-renders the segment and
re-runs the server component. It is not a cache retry: a deterministic
server-side failure repeats identically, which is consistent with the report.

The one genuine version-mismatch path is `parseRevision` in
`features/offline/server.ts` ("This app version cannot safely save answers.
Reload to update it.") — that is a *save* path, not an *open* path, and produces
different copy.

---

## Migration

None required. Every change is application-level, and no stored row is altered.
