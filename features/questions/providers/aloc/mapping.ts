import { QuestionProviderUnsupportedFilterError } from "@/features/questions/errors";
import type { ExamBody } from "@/types/domain";

/**
 * Legacy ALOC exam identifiers. Only JAMB/UTME is verified for M7; the remaining
 * exam bodies deliberately fail loudly rather than querying the wrong content.
 */
const EXAM_TYPES: Partial<Record<ExamBody, string>> = {
  jamb: "utme",
};

interface SubjectMapping {
  /** Legacy ALOC subject identifier sent as the `subject` query parameter. */
  aloc: string;
  /** Display name, kept identical to the M1 subject catalogue seed. */
  name: string;
}

/**
 * Internal subject slug -> legacy ALOC subject.
 *
 * These identifiers follow the published legacy subject list. They have NOT been
 * confirmed against a live response, because the ALOC access token available
 * during M7 was rejected by the API. Run
 * `npm run aloc:smoke -- --verify-subjects` once a valid token exists: it probes
 * every entry below and reports which ones the live API actually accepts.
 * Treat every row as provisional until that check has been run.
 */
const SUBJECTS: Record<string, SubjectMapping> = {
  "use-of-english": { aloc: "english", name: "Use of English" },
  mathematics: { aloc: "mathematics", name: "Mathematics" },
  physics: { aloc: "physics", name: "Physics" },
  chemistry: { aloc: "chemistry", name: "Chemistry" },
  biology: { aloc: "biology", name: "Biology" },
  economics: { aloc: "economics", name: "Economics" },
  government: { aloc: "government", name: "Government" },
  commerce: { aloc: "commerce", name: "Commerce" },
  "literature-in-english": { aloc: "englishlit", name: "Literature in English" },
  "principles-of-accounts": { aloc: "accounting", name: "Principles of Accounts" },
  geography: { aloc: "geography", name: "Geography" },
  "christian-religious-studies": { aloc: "crk", name: "Christian Religious Studies" },
  "islamic-studies": { aloc: "irk", name: "Islamic Studies" },
  history: { aloc: "history", name: "History" },
};

interface QuarantinedSubject {
  /** The identifier we suspect is correct, kept only so it can be probed. */
  candidate: string;
  name: string;
  reason: string;
}

/**
 * Subjects held back from the mapping above until their upstream identifier is
 * confirmed against a live response.
 *
 * A quarantined subject is treated exactly like an unmapped one: no request is
 * ever sent for it, and the UI does not offer it while this provider is active.
 * The candidate identifier lives here (never in `SUBJECTS`) so it can be probed
 * with `npm run aloc:smoke -- --verify-subjects` without any chance of it
 * reaching a real student session first.
 *
 * To promote one: confirm it with the smoke script, move the row into
 * `SUBJECTS`, and update the regression test that asserts it is quarantined.
 */
const QUARANTINED: Record<string, QuarantinedSubject> = {
  "agricultural-science": {
    candidate: "agriculture",
    name: "Agricultural Science",
    reason: "Upstream identifier unverified: no authenticated ALOC response has confirmed it.",
  },
};

export function alocExamType(examBody: ExamBody): string {
  const type = EXAM_TYPES[examBody];
  if (!type) {
    throw new QuestionProviderUnsupportedFilterError(
      `ALOC provider has no verified exam mapping for "${examBody}".`,
      "This exam is not available from the current question source yet.",
    );
  }
  return type;
}

export function alocSubject(subjectSlug: string): SubjectMapping {
  const quarantined = QUARANTINED[subjectSlug];
  if (quarantined) {
    throw new QuestionProviderUnsupportedFilterError(
      `ALOC mapping for "${subjectSlug}" is quarantined pending verification. ${quarantined.reason}`,
      "This subject is not available from the current question source yet.",
    );
  }

  const subject = SUBJECTS[subjectSlug];
  if (!subject) {
    throw new QuestionProviderUnsupportedFilterError(
      `ALOC does not currently have a verified mapping for this subject: "${subjectSlug}".`,
      "This subject is not available from the current question source yet.",
    );
  }
  return subject;
}

/** True only for a subject with a mapping that is not quarantined. */
export function isMappedSubject(subjectSlug: string): boolean {
  return subjectSlug in SUBJECTS && !(subjectSlug in QUARANTINED);
}

export function isQuarantinedSubject(subjectSlug: string): boolean {
  return subjectSlug in QUARANTINED;
}

/** Exposed for the smoke script and tests. Not used at request time. */
export function subjectMappingEntries(): [string, SubjectMapping][] {
  return Object.entries(SUBJECTS);
}

/** Exposed so the smoke script can probe candidates without enabling them. */
export function quarantinedSubjectEntries(): [string, QuarantinedSubject][] {
  return Object.entries(QUARANTINED);
}
