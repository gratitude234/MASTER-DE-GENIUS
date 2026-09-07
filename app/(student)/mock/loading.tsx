import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonCard, SkeletonHeader, SkeletonPage } from "@/components/ui/route-skeleton";

export default function Loading() {
  return (
    <SkeletonPage label="Loading mock exam setup" className="mx-auto max-w-3xl">
      <SkeletonHeader />
      <SkeletonCard lines={4} />
      <SkeletonCard lines={3} />
      <Skeleton className="h-[52px] w-full rounded-xl" />
    </SkeletonPage>
  );
}
