import { BrandMark } from "@/components/brand/brand-mark";

interface SectionPlaceholderProps {
  eyebrow: string;
  title: string;
  description: string;
}

export function SectionPlaceholder({ eyebrow, title, description }: SectionPlaceholderProps) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5 lg:hidden"><BrandMark /></div>
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-brand-500">{eyebrow}</div>
        <h1 className="mt-3 text-2xl font-black tracking-[-0.035em] text-slate-950 sm:text-3xl">{title}</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">{description}</p>
        <div className="mt-7 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-xs font-semibold leading-5 text-slate-400">
          Production implementation for this section is intentionally deferred to the next milestone. The route and navigation boundary are already live.
        </div>
      </div>
    </div>
  );
}
