import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonCard, SkeletonHeader, SkeletonHero, SkeletonPage } from "@/components/ui/route-skeleton";

export default function Loading() {
  return (
    <SkeletonPage label="Loading practice setup" className="mx-auto max-w-3xl">
      <SkeletonHeader />
      <Skeleton className="h-12 w-full rounded-xl" />
      <SkeletonHero />
      <SkeletonCard lines={2} />
      <SkeletonCard lines={2} />
      <Skeleton className="h-12 w-full rounded-xl" />
    </SkeletonPage>
  );
}
