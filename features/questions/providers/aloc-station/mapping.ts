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

// Conservative initial allow-list. Each identifier must pass the authenticated
// Station probe before its exam body is exposed in onboarding.
const SUBJECTS: Record<string, SubjectMapping> = {
  "use-of-english": { station: "english", name: "Use of English" },
  mathematics: { station: "mathematics", name: "Mathematics" },
  physics: { station: "physics", name: "Physics" },
  chemistry: { station: "chemistry", name: "Chemistry" },
  biology: { station: "biology", name: "Biology" },
  economics: { station: "economics", name: "Economics" },
  government: { station: "government", name: "Government" },
  commerce: { station: "commerce", name: "Commerce" },
  "literature-in-english": { station: "english-literature", name: "Literature in English" },
  "principles-of-accounts": { station: "accounting", name: "Principles of Accounts" },
  geography: { station: "geography", name: "Geography" },
  "christian-religious-studies": { station: "christian-religious-studies", name: "Christian Religious Studies" },
  "islamic-studies": { station: "islamic-studies", name: "Islamic Studies" },
  history: { station: "history", name: "History" },
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

export function stationSubject(subjectSlug: string): SubjectMapping {
  const subject = SUBJECTS[subjectSlug];
  if (!subject) {
    throw new QuestionProviderUnsupportedFilterError(
      `ALOC Station has no verified mapping for subject "${subjectSlug}".`,
      "This subject is not available from the current question source yet.",
    );
  }
  return subject;
}

export function isStationSubjectMapped(subjectSlug: string): boolean {
  return subjectSlug in SUBJECTS;
}

export function stationSubjectEntries(): [string, SubjectMapping][] {
  return Object.entries(SUBJECTS);
}
