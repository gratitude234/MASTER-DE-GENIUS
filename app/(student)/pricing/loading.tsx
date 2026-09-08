import { SkeletonCard, SkeletonHeader, SkeletonHero, SkeletonPage } from "@/components/ui/route-skeleton";

export default function Loading() {
  return (
    <SkeletonPage label="Loading plans and pricing" className="mx-auto max-w-[1000px]">
      <SkeletonHeader />
      <div className="grid gap-3 lg:grid-cols-2">
        <SkeletonCard lines={4} />
        <SkeletonHero />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <SkeletonCard lines={3} />
        <SkeletonCard lines={3} />
        <SkeletonCard lines={3} />
      </div>
    </SkeletonPage>
  );
}
