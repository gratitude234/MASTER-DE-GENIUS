/**
 * Live ALOC connectivity and normalization check.
 *
 *   npm run aloc:smoke
 *   npm run aloc:smoke -- --subject=chemistry --count=5
 *   npm run aloc:smoke -- --verify-subjects
 *
 * Never part of a production build. It prints diagnostics only: the access
 * token is never logged, echoed, or included in any error output.
 */
import { readFileSync, existsSync } from "node:fs";
import { registerAliasHook } from "./alias-hook.mjs";

registerAliasHook();

// Next.js loads .env.local for the app; a standalone script must do it itself.
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const found = args.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

if (!process.env.ALOC_ACCESS_TOKEN?.trim()) {
  console.error("ALOC connectivity: SKIPPED — ALOC_ACCESS_TOKEN is not set.");
  console.error("Set it in .env.local (never prefixed with NEXT_PUBLIC_) and re-run.");
  process.exit(1);
}

const { AlocQuestionProvider } = await import("../features/questions/providers/aloc/index.ts");
const { subjectMappingEntries, quarantinedSubjectEntries } = await import("../features/questions/providers/aloc/mapping.ts");

const provider = new AlocQuestionProvider();

function describeError(error) {
  return `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`;
}

async function verifySubjects() {
  console.log("Verifying every mapped subject against the live API (1 question each).\n");
  const results = [];
  for (const [slug, mapping] of subjectMappingEntries()) {
    try {
      const questions = await provider.fetchQuestions({
        examBody: "jamb", subjectSlug: slug, count: 1,
      });
      results.push({ slug, aloc: mapping.aloc, ok: questions.length > 0, detail: `${questions.length} usable` });
    } catch (error) {
      results.push({ slug, aloc: mapping.aloc, ok: false, detail: describeError(error) });
    }
  }

  const width = Math.max(...results.map((r) => r.slug.length));
  for (const result of results) {
    console.log(`  ${result.ok ? "OK  " : "FAIL"}  ${result.slug.padEnd(width)}  -> ${result.aloc.padEnd(12)} ${result.detail}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nMapped subjects: ${results.length}   confirmed: ${results.length - failed.length}   unconfirmed: ${failed.length}`);

  // Quarantined mappings are probed by candidate identifier only. They are never
  // enabled in the product until promoted by hand.
  const quarantined = quarantinedSubjectEntries();
  if (quarantined.length) {
    const { alocRequest, requireAlocConfig, envelopeRecords } = await import("../features/questions/providers/aloc/transport.ts");
    const config = requireAlocConfig();
    console.log("\nQuarantined mappings (candidates, never offered to students):");
    for (const [slug, entry] of quarantined) {
      try {
        const body = await alocRequest({
          path: "/q", query: { subject: entry.candidate, type: "utme" },
          subject: entry.candidate, examType: "utme", config,
        });
        const records = envelopeRecords(body);
        if (records.length) {
          console.log(`  CONFIRMED  ${slug} -> ${entry.candidate}  (${records.length} record(s) returned)`);
          console.log("             Promote it in mapping.ts, then update tests/aloc-subject-availability.test.mjs.");
        } else {
          console.log(`  EMPTY      ${slug} -> ${entry.candidate}  (accepted but returned nothing)`);
        }
      } catch (error) {
        console.log(`  REJECTED   ${slug} -> ${entry.candidate}  ${describeError(error)}`);
      }
    }
  }

  process.exit(failed.length ? 1 : 0);
}

if (args.includes("--verify-subjects")) await verifySubjects();

const subjectSlug = flag("subject", "physics");
const count = Number.parseInt(flag("count", "3"), 10);

try {
  const started = Date.now();
  const questions = await provider.fetchQuestions({ examBody: "jamb", subjectSlug, count });
  const durationMs = Date.now() - started;

  const ids = new Set(questions.map((q) => q.source.providerQuestionId));
  const years = [...new Set(questions.map((q) => q.year).filter(Boolean))].sort();
  const answersValid = questions.every((q) => q.options.some((option) => option.key === q.correctOptionKey));
  const keysLeaked = questions.some((q) => q.options.some((option) => option.text === undefined));

  console.log("");
  console.log(`ALOC connectivity:  OK  (${durationMs}ms)`);
  console.log(`Exam:               JAMB -> utme`);
  console.log(`Subject:            ${subjectSlug} -> ${questions[0]?.subject.name ?? "unknown"}`);
  console.log(`Requested:          ${count}`);
  console.log(`Valid normalized:   ${questions.length}`);
  console.log(`Unique:             ${ids.size}`);
  console.log(`Years:              ${years.length ? years.join(", ") : "none reported"}`);
  console.log(`With passage:       ${questions.filter((q) => q.passage).length}`);
  console.log(`With explanation:   ${questions.filter((q) => q.explanation).length}`);
  console.log(`Option counts:      ${[...new Set(questions.map((q) => q.options.length))].sort().join(", ") || "n/a"}`);
  console.log(`Answer validation:  ${answersValid && !keysLeaked ? "OK" : "FAILED"}`);

  if (questions.length < count) {
    console.log(`\nNote: ${questions.length}/${count} unique questions were available. The engine treats this as an inventory shortage rather than duplicating questions.`);
  }
  if (!answersValid) {
    console.error("\nAnswer validation failed: a correct key does not match any delivered option.");
    process.exit(1);
  }
  process.exit(0);
} catch (error) {
  console.error(`\nALOC connectivity: FAILED`);
  console.error(describeError(error));
  process.exit(1);
}
