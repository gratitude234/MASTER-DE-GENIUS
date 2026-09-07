import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonPage } from "@/components/ui/route-skeleton";

/**
 * Presentation only. This screen never reads, resumes or writes session state —
 * the runner owns all of that once it mounts.
 */
export default function Loading() {
  return (
    <SkeletonPage label="Loading your practice session" className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-24 rounded-full" />
      </div>
      <Skeleton className="h-1.5 w-full rounded-full" />
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-4/5" />
      </div>
      {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-14 w-full rounded-2xl" />)}
    </SkeletonPage>
  );
}
