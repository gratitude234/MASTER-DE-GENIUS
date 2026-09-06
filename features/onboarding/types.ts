export type OnboardingSubject = {
  id: string;
  slug: string;
  name: string;
  isCompulsory: boolean;
  displayOrder: number;
};

export type OnboardingActionState = { error?: string };
export const initialOnboardingState: OnboardingActionState = {};
