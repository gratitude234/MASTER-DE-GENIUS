import { cn } from "@/lib/utils";

interface BrandMarkProps {
  compact?: boolean;
  inverse?: boolean;
  className?: string;
}

export function BrandMark({ compact = false, inverse = false, className }: BrandMarkProps) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)} aria-label="MASTER@DE'GENIUS">
      <div
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-black",
          inverse ? "bg-white text-slate-950" : "bg-slate-950 text-white",
        )}
      >
        M
      </div>
      {!compact ? (
        <div className="min-w-0 leading-none">
          <div className={cn("truncate text-[13px] font-extrabold tracking-[-0.01em]", inverse ? "text-white" : "text-slate-950")}>MASTER@DE&apos;GENIUS</div>
          <div className={cn("mt-1 text-[10px] font-semibold uppercase tracking-[0.16em]", inverse ? "text-white/45" : "text-slate-400")}>CBT</div>
        </div>
      ) : null}
    </div>
  );
}
