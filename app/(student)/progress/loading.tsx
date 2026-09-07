import { SkeletonCard, SkeletonHeader, SkeletonHero, SkeletonPage } from "@/components/ui/route-skeleton";

export default function Loading() {
  return (
    <SkeletonPage label="Loading your results" className="mx-auto max-w-4xl space-y-6">
      <SkeletonHeader />
      <SkeletonHero />
      <SkeletonCard lines={2} />
      <SkeletonCard lines={4} />
      {Array.from({ length: 3 }, (_, index) => <SkeletonCard key={index} lines={2} />)}
    </SkeletonPage>
  );
}
