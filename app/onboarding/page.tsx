import { BrandMark } from "@/components/brand/brand-mark";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { requireUser } from "@/lib/auth";
import { getOnboardingCatalog } from "@/features/onboarding/queries";

export default async function OnboardingPage() {
  const { user } = await requireUser();
  const { exams, selection } = await getOnboardingCatalog(user.id);

  return (
    // Onboarding is a focused task, not a workspace: the same centred 520px
    // column at every width, with no shell around it to navigate away from.
    <main className="grid min-h-dvh place-items-center bg-slate-50 px-6 py-8">
      <div className="screen-enter w-full max-w-[520px]">
        <div className="mb-7 flex justify-center"><BrandMark /></div>
        <OnboardingFlow exams={exams} initialSelection={selection} />
      </div>
    </main>
  );
}
