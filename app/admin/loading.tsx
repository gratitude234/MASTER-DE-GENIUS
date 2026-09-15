import { SkeletonCard, SkeletonHeader, SkeletonPage } from "@/components/ui/route-skeleton";

export default function AdminLoading() {
  return (
    <SkeletonPage label="Loading admin workspace">
      <SkeletonHeader />
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <SkeletonCard key={index} lines={1} />)}
      </div>
      <SkeletonCard lines={6} />
    </SkeletonPage>
  );
}
