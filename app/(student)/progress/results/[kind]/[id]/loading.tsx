import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonCard, SkeletonHero, SkeletonPage } from "@/components/ui/route-skeleton";

export default function Loading() {
  return (
    <SkeletonPage label="Loading your result" className="mx-auto max-w-4xl space-y-6">
      <Skeleton className="h-4 w-24" />
      <SkeletonHero />
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-[74px] rounded-2xl" />)}
      </div>
      <SkeletonCard lines={2} />
      <SkeletonCard lines={2} />
      <SkeletonCard lines={3} />
    </SkeletonPage>
  );
}
