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
    <main className="min-h-dvh bg-slate-50 px-4 py-5 sm:px-6 sm:py-8">
      <div className="mx-auto mb-6 max-w-3xl"><BrandMark /></div>
      <OnboardingFlow subjects={subjects} />
    </main>
  );
}
