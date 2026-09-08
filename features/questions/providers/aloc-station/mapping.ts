import "server-only";

import { QuestionProviderUnsupportedFilterError } from "@/features/questions/errors";
import type { ExamBody } from "@/types/domain";

const EXAM_TYPES: Partial<Record<ExamBody, string>> = {
  jamb: "jamb",
  waec: "waec",
  neco: "neco",
};

interface SubjectMapping {
  station: string;
  name: string;
}

// Station identifiers and exam inventory were verified against the zero-credit
// /subjects discovery endpoint on 2026-09-08. Keep the app slug stable while
// translating only at the provider boundary.
const SUBJECTS: Record<string, SubjectMapping> = {
  "use-of-english": { station: "english-language", name: "Use of English" },
  mathematics: { station: "mathematics", name: "Mathematics" },
  physics: { station: "physics", name: "Physics" },
  chemistry: { station: "chemistry", name: "Chemistry" },
  biology: { station: "biology", name: "Biology" },
  economics: { station: "economics", name: "Economics" },
  government: { station: "government", name: "Government" },
  commerce: { station: "commerce", name: "Commerce" },
  "literature-in-english": { station: "literature-in-english", name: "Literature in English" },
  "principles-of-accounts": { station: "accounting", name: "Principles of Accounts" },
  geography: { station: "geography", name: "Geography" },
  "christian-religious-studies": { station: "christian-religious-studies", name: "Christian Religious Studies" },
  history: { station: "history", name: "History" },
  "civic-education": { station: "civic-education", name: "Civic Education" },
  insurance: { station: "insurance", name: "Insurance" },
};

const EXAM_SUBJECTS: Record<"jamb" | "waec" | "neco", ReadonlySet<string>> = {
  jamb: new Set([
    "use-of-english", "mathematics", "physics", "chemistry", "biology",
    "economics", "government", "commerce", "literature-in-english",
    "principles-of-accounts", "geography", "christian-religious-studies",
  ]),
  waec: new Set([
    "mathematics", "economics", "government", "commerce", "literature-in-english",
    "principles-of-accounts", "geography", "christian-religious-studies",
    "civic-education", "history", "insurance",
  ]),
  neco: new Set(["civic-education", "commerce", "government"]),
};

export function stationExamType(examBody: ExamBody): string {
  const type = EXAM_TYPES[examBody];
  if (!type) {
    throw new QuestionProviderUnsupportedFilterError(
      `ALOC Station has no enabled exam mapping for "${examBody}".`,
      "This exam is not available from the current question source yet.",
    );
  }
  return type;
}

export function isStationExamSubjectMapped(examBody: ExamBody, subjectSlug: string): boolean {
  if (examBody !== "jamb" && examBody !== "waec" && examBody !== "neco") return false;
  return EXAM_SUBJECTS[examBody].has(subjectSlug) && subjectSlug in SUBJECTS;
}

export function stationSubject(examBody: ExamBody, subjectSlug: string): SubjectMapping {
  const subject = SUBJECTS[subjectSlug];
  if (!subject || !isStationExamSubjectMapped(examBody, subjectSlug)) {
    throw new QuestionProviderUnsupportedFilterError(
      `ALOC Station has no verified ${examBody} mapping for subject "${subjectSlug}".`,
      "This subject is not available from the current question source yet.",
    );
  }
  return subject;
}

export function isStationSubjectMapped(subjectSlug: string): boolean {
  return subjectSlug in SUBJECTS;
}

export function stationSubjectEntries(examBody?: ExamBody): [string, SubjectMapping][] {
  return Object.entries(SUBJECTS).filter(([slug]) => !examBody || isStationExamSubjectMapped(examBody, slug));
}
