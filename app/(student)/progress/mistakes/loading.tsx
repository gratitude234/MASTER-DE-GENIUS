import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonCard, SkeletonHeader, SkeletonPage } from "@/components/ui/route-skeleton";

export default function Loading() {
  return (
    <SkeletonPage label="Loading your mistake bank" className="mx-auto max-w-4xl">
      <SkeletonHeader />
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-12 rounded-xl" />)}
      </div>
      {Array.from({ length: 4 }, (_, index) => <SkeletonCard key={index} lines={3} />)}
    </SkeletonPage>
  );
}
