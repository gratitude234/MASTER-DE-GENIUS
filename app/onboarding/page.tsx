import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand/brand-mark";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { requireUser } from "@/lib/auth";
import { getJambOnboardingCatalog } from "@/features/onboarding/queries";

export default async function OnboardingPage() {
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase.from("profiles").select("onboarding_completed").eq("id", user.id).maybeSingle();
  if (profile?.onboarding_completed) redirect("/home");

  const { subjects } = await getJambOnboardingCatalog();

  return (
    // Onboarding is a focused task, not a workspace: the same centred 520px
    // column at every width, with no shell around it to navigate away from.
    <main className="grid min-h-dvh place-items-center bg-slate-50 px-6 py-8">
      <div className="screen-enter w-full max-w-[520px]">
        <div className="mb-7 flex justify-center"><BrandMark /></div>
        <OnboardingFlow subjects={subjects} />
      </div>
    </main>
  );
}
