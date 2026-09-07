import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Building blocks for route `loading.tsx` screens.
 *
 * Purely presentational and dependency-free by design: a loading screen must
 * never touch session, offline or exam state, so these take geometry and
 * nothing else.
 */
export function SkeletonPage({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={cn("space-y-5", className)}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Page title block: eyebrow, heading, supporting line. */
export function SkeletonHeader() {
  return (
    <div className="space-y-2.5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-64 max-w-full rounded-lg" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  );
}

/** A standard bordered card, sized by `className`. */
export function SkeletonCard({ className, lines = 3 }: { className?: string; lines?: number }) {
  return (
    <div className={cn("space-y-3 rounded-2xl border border-slate-200 bg-white p-5", className)}>
      <Skeleton className="h-4 w-32" />
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn("h-3.5", index === lines - 1 ? "w-1/2" : "w-full")} />
      ))}
    </div>
  );
}

/** The dark hero shell used by Home, Progress and Results. */
export function SkeletonHero() {
  return (
    <div className="space-y-3 rounded-3xl bg-slate-950 px-[22px] py-6 lg:px-9 lg:py-8">
      <Skeleton className="h-3 w-28 bg-white/15" />
      <Skeleton className="h-8 w-56 max-w-full rounded-lg bg-white/15" />
      <Skeleton className="h-4 w-72 max-w-full bg-white/10" />
    </div>
  );
}
