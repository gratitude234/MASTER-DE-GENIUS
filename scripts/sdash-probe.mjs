/**
 * Minimal live verification of the four approved Sdash WAEC mappings.
 *
 * Deliberately not part of `npm test`: the normal suite mocks transport and must
 * never spend provider credits or depend on somebody's key. This script exists
 * so a mapping can be re-confirmed by hand after a plan change.
 *
 * It makes exactly one request per subject with `limit=1` — four calls, the
 * smallest possible spend — and never calls the subject catalogue. The access
 * token is read from the environment and never printed.
 *
 *   npm run sdash:probe -- --confirm-spend
 */

const CONFIRMATION = "--confirm-spend";
const baseUrl = (process.env.SDASH_BASE_URL || "https://sdashapi.com/api/v1").replace(/\/+$/, "");
const accessToken = process.env.SDASH_API_KEY?.trim();

/** MASTER slug -> Sdash identifier. Mirrors providers/sdash/mapping.ts. */
const PROBES = [
  { subjectSlug: "biology", sdash: "biology" },
  { subjectSlug: "chemistry", sdash: "chemistry" },
  { subjectSlug: "physics", sdash: "physics" },
  { subjectSlug: "agricultural-science", sdash: "agriculture" },
];

if (!process.argv.includes(CONFIRMATION)) {
  console.error(`Refusing to spend provider credits. Re-run with ${CONFIRMATION} after reviewing the four probes.`);
  process.exitCode = 2;
} else if (!accessToken) {
  console.error("SDASH_API_KEY is missing from .env.local. Do not prefix it with NEXT_PUBLIC_.");
  process.exitCode = 2;
} else {
  const results = [];
  for (const probe of PROBES) {
    const url = `${baseUrl}/q?subject=${encodeURIComponent(probe.sdash)}&type=wassce&limit=1`;
    const startedAt = Date.now();
    let status = null;
    let body = null;
    try {
      const response = await fetch(url, {
        headers: { AccessToken: accessToken, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      status = response.status;
      const raw = await response.text();
      try { body = JSON.parse(raw); } catch { body = null; }
    } catch (error) {
      status = null;
      body = { error: error instanceof Error ? error.name : "network error" };
    }

    const record = Array.isArray(body?.data) ? body.data[0] : body?.data;
    results.push({
      subject: probe.subjectSlug,
      sdashSubject: probe.sdash,
      status,
      // Structural facts only. No question text, no options, no answer key.
      examtype: typeof record?.examtype === "string" ? record.examtype : null,
      examyear: record?.examyear != null ? String(record.examyear) : null,
      optionKeys: record?.option && typeof record.option === "object" ? Object.keys(record.option).join("") : null,
      hasSection: Boolean(record?.section),
      hasImage: Boolean(record?.image),
      hasSolution: Boolean(record?.solution),
      durationMs: Date.now() - startedAt,
    });
  }

  console.table(results);
  console.info(`Credits consumed: ${PROBES.length} request(s), limit=1 each.`);
  if (results.some((result) => result.status !== 200)) process.exitCode = 1;
}
