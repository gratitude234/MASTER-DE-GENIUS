import { SkeletonHero, SkeletonPage } from "@/components/ui/route-skeleton";

export default function Loading() {
  return (
    <SkeletonPage label="Checking your payment" className="mx-auto max-w-[640px]">
      <SkeletonHero />
    </SkeletonPage>
  );
}
