import { SkeletonCard, SkeletonHeader, SkeletonHero, SkeletonPage } from "@/components/ui/route-skeleton";
export default function Loading() { return <SkeletonPage label="Loading Master Classes"><SkeletonHeader /><SkeletonHero /><SkeletonCard /><SkeletonCard /></SkeletonPage>; }
