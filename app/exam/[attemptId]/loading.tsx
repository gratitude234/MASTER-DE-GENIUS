import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonPage } from "@/components/ui/route-skeleton";

/**
 * Presentation only. It must never read, resume, submit or otherwise inspect
 * attempt state — the runner owns the whole session lifecycle once it mounts.
 */
export default function Loading() {
  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="safe-area-top border-b border-slate-800 bg-slate-950 px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <Skeleton className="h-4 w-32 bg-white/15" />
          <Skeleton className="h-7 w-20 rounded-full bg-white/15" />
        </div>
      </div>
      <SkeletonPage label="Loading your exam" className="mx-auto max-w-3xl px-4 py-5">
        <Skeleton className="h-9 w-full rounded-xl" />
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-4/5" />
        </div>
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-14 w-full rounded-xl" />)}
      </SkeletonPage>
    </div>
  );
}
