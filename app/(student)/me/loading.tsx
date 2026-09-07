import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonCard, SkeletonHeader, SkeletonPage } from "@/components/ui/route-skeleton";

export default function Loading() {
  return (
    <SkeletonPage label="Loading your profile" className="mx-auto max-w-3xl">
      <SkeletonHeader />
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-4">
          <Skeleton className="h-14 w-14 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3.5 w-56 max-w-full" />
          </div>
        </div>
      </div>
      <SkeletonCard lines={4} />
      <Skeleton className="h-12 w-full rounded-xl" />
    </SkeletonPage>
  );
}
