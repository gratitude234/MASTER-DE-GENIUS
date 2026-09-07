import { cn } from "@/lib/utils";

interface BrandMarkProps {
  /** Mark only, for tight chrome such as the exam header. */
  compact?: boolean;
  inverse?: boolean;
  /**
   * The "CBT" line under the wordmark. On by default; the sidebar sets it false
   * because the rail already says what the workspace is.
   */
  sublabel?: boolean;
  className?: string;
}

/**
 * The serif "M" in a rounded square, with the wordmark beside it.
 *
 * The mark is Source Serif 4 rather than the interface face: it is the one
 * place the approved system uses the heading face at small sizes, and it is
 * what makes the logo read as a mark instead of a letter in a box.
 */
export function BrandMark({ compact = false, inverse = false, sublabel = true, className }: BrandMarkProps) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)} aria-label="MASTER@DE'GENIUS">
      <div
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-lg font-serif text-[15px] font-bold",
          inverse ? "bg-white text-slate-950" : "bg-slate-950 text-white",
        )}
      >
        M
      </div>
      {!compact ? (
        <div className="min-w-0 leading-none">
          <div className={cn("truncate text-[13px] font-bold tracking-[-0.01em]", inverse ? "text-white" : "text-slate-950")}>MASTER@DE&apos;GENIUS</div>
          {sublabel ? (
            <div className={cn("mt-1 text-[10px] font-semibold uppercase tracking-[0.16em]", inverse ? "text-white/40" : "text-slate-400")}>CBT</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
