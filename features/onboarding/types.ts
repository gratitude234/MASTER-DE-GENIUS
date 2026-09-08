export type OnboardingSubject = {
  id: string;
  slug: string;
  name: string;
  isCompulsory: boolean;
  displayOrder: number;
};

export type OnboardingExamCode = "jamb" | "waec";

export type OnboardingExam = {
  id: string;
  code: OnboardingExamCode;
  name: string;
  shortName: string;
  description: string | null;
  available: boolean;
  subjects: OnboardingSubject[];
};

export type OnboardingSelection = {
  examCode: OnboardingExamCode;
  examYear: number;
  targetScore: number;
  subjectIds: string[];
} | null;

export type OnboardingActionState = { error?: string };
export const initialOnboardingState: OnboardingActionState = {};
