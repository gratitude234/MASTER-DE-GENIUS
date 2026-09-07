import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonCard, SkeletonHeader, SkeletonHero, SkeletonPage } from "@/components/ui/route-skeleton";

export default function Loading() {
  return (
    <SkeletonPage label="Loading your dashboard">
      <SkeletonHeader />
      <SkeletonHero />
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-[84px] rounded-2xl" />)}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <SkeletonCard className="min-h-[190px]" />
        <SkeletonCard className="min-h-[190px]" />
      </div>
    </SkeletonPage>
  );
}
