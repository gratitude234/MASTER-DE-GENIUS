import "server-only";

import { QuestionProviderUnsupportedFilterError } from "@/features/questions/errors";
import type { ExamBody } from "@/types/domain";

/**
 * MASTER slug -> Sdash identifier, and nothing else.
 *
 * Application slugs are stable product identifiers; Sdash names are a vendor
 * detail. Translation happens here and only here, so the rest of the codebase
 * never learns that Agricultural Science is called `agriculture` upstream.
 *
 * Every row below was confirmed against a live `type=wassce` response, not read
 * off a documentation page. A mapping with no confirmed response does not
 * belong in this file.
 */

/** Exam bodies with a verified Sdash mapping. WAEC only in this milestone. */
const EXAM_TYPES: Partial<Record<ExamBody, string>> = {
  waec: "wassce",
};

interface SubjectMapping {
  /** The `subject` query parameter Sdash expects. */
  sdash: string;
  /** Display name, identical to the M1 subject catalogue seed. */
  name: string;
  /** The examination year the live verification returned, for the notes. */
  verifiedYear: number;
}

const SUBJECTS: Record<string, SubjectMapping> = {
  biology: { sdash: "biology", name: "Biology", verifiedYear: 2018 },
  chemistry: { sdash: "chemistry", name: "Chemistry", verifiedYear: 2012 },
  physics: { sdash: "physics", name: "Physics", verifiedYear: 2025 },
  "agricultural-science": { sdash: "agriculture", name: "Agricultural Science", verifiedYear: 2025 },
};

interface WithheldSubject {
  /** The identifier Sdash would probably accept, kept only so it can be probed. */
  candidate: string | null;
  name: string;
  reason: string;
}

/**
 * Subjects deliberately not enabled, with the evidence for each.
 *
 * A withheld subject behaves exactly like an unmapped one: no request is ever
 * sent for it and the product never offers it. The candidate identifier lives
 * here rather than in `SUBJECTS` so it can be probed later without any chance
 * of reaching a student session first.
 */
const WITHHELD: Record<string, WithheldSubject> = {
  "use-of-english": {
    candidate: "english",
    name: "Use of English",
    reason:
      "Sdash answered type=wassce&subject=english with HTTP 403: the subject is outside the Sandbox tier. " +
      "That proves a plan restriction, not usable inventory.",
  },
  "further-mathematics": {
    candidate: null,
    name: "Further Mathematics",
    reason: "Not present in the current Sdash subject catalogue; no verified source exists.",
  },
};

/**
 * Exam types Sdash accepts. Only `wassce` is enabled: JAMB routing must not
 * change in this milestone, and NECO was never part of it.
 */
export function sdashExamType(examBody: ExamBody): string {
  const type = EXAM_TYPES[examBody];
  if (!type) {
    throw new QuestionProviderUnsupportedFilterError(
      `Sdash has no enabled exam mapping for "${examBody}".`,
      "This exam is not available from the current question source yet.",
    );
  }
  return type;
}

/** True only for an exam and subject pair verified against a live response. */
export function isSdashExamSubjectMapped(examBody: ExamBody, subjectSlug: string): boolean {
  return examBody in EXAM_TYPES && subjectSlug in SUBJECTS && !(subjectSlug in WITHHELD);
}

export function sdashSubject(examBody: ExamBody, subjectSlug: string): SubjectMapping {
  const withheld = WITHHELD[subjectSlug];
  if (withheld) {
    throw new QuestionProviderUnsupportedFilterError(
      `Sdash mapping for "${subjectSlug}" is withheld. ${withheld.reason}`,
      "This subject is not available from the current question source yet.",
    );
  }

  const subject = SUBJECTS[subjectSlug];
  if (!subject || !isSdashExamSubjectMapped(examBody, subjectSlug)) {
    throw new QuestionProviderUnsupportedFilterError(
      `Sdash has no verified ${examBody} mapping for subject "${subjectSlug}".`,
      "This subject is not available from the current question source yet.",
    );
  }
  return subject;
}

/**
 * Exam type aliases accepted in a response's `examtype` field.
 *
 * A WASSCE request must never be answered with a UTME question, so the
 * normalizer checks what came back. Sdash labels WASSCE responses "WASSCE";
 * "waec" is accepted alongside it because the same body uses both spellings.
 */
export function sdashExamTypeAliases(examType: string): ReadonlySet<string> {
  return examType === "wassce" ? new Set(["wassce", "waec"]) : new Set([examType]);
}

/** Exposed for the admin panel, the probe script and tests. */
export function sdashSubjectEntries(examBody?: ExamBody): [string, SubjectMapping][] {
  return Object.entries(SUBJECTS).filter(([slug]) => !examBody || isSdashExamSubjectMapped(examBody, slug));
}

/** Exposed so the probe script can test a candidate without enabling it. */
export function withheldSubjectEntries(): [string, WithheldSubject][] {
  return Object.entries(WITHHELD);
}
