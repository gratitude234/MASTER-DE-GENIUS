import Form from "next/form";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type * as React from "react";
import { buttonClasses, typography } from "@/components/ui/variants";
import { formatCount } from "@/features/admin/format";
import { cn } from "@/lib/utils";

/*
 * The admin workspace's building blocks. Operational density over decoration:
 * tables carry the data, cards are reserved for headline figures, and every
 * list states its exact total.
 */

export function AdminPageHeader({
  title,
  description,
  breadcrumbs,
  actions,
}: {
  title: string;
  description?: string;
  breadcrumbs?: { href: string; label: string }[];
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumbs?.length ? (
          <nav aria-label="Breadcrumb" className="mb-1.5">
            <ol className="flex flex-wrap items-center gap-1 text-[11.5px] font-semibold text-slate-500">
              {breadcrumbs.map((crumb) => (
                <li key={crumb.href} className="flex items-center gap-1">
                  <Link href={crumb.href} className="hover:text-slate-900 hover:underline">{crumb.label}</Link>
                  <ChevronRight className="h-3 w-3" aria-hidden="true" />
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <h1 className={cn(typography.h1, "break-words")}>{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-[12.5px] leading-5 text-slate-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dl className={cn("grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4", className)}>{children}</dl>;
}

export function Stat({
  label,
  value,
  hint,
  href,
  attention = false,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  href?: string;
  /** Highlights a figure that needs someone to act. */
  attention?: boolean;
}) {
  const body = (
    <>
      <dt className="text-[11px] font-semibold text-slate-500">{label}</dt>
      <dd className={cn("mono-number mt-1 text-[22px] font-semibold leading-tight", attention ? "text-warning-800" : "text-slate-950")}>{value}</dd>
      {hint ? <dd className="mt-1 text-[11px] leading-4 text-slate-500">{hint}</dd> : null}
    </>
  );
  const frame = cn("block rounded-2xl border bg-white p-4", attention ? "border-warning-200 bg-warning-50/40" : "border-slate-200");
  return href ? (
    <div className={cn(frame, "transition-colors hover:border-slate-300")}>
      <Link href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">{body}</Link>
    </div>
  ) : (
    <div className={frame}>{body}</div>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("rounded-2xl border border-slate-200 bg-white", className)} aria-labelledby={title && id ? `${id}-title` : undefined}>
      {title ? (
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 id={id ? `${id}-title` : undefined} className={typography.h2}>{title}</h2>
            {description ? <p className="mt-0.5 text-[11.5px] text-slate-500">{description}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export const cell = {
  th: "whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-[0.06em] text-slate-500",
  td: "border-b border-slate-100 px-3 py-2.5 align-top text-[12.5px] text-slate-700",
  num: "mono-number whitespace-nowrap text-right",
};

export function DataTable({ label, minWidth = 760, children }: { label: string; minWidth?: number; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full border-collapse" style={{ minWidth }} aria-label={label}>
        {children}
      </table>
    </div>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-[12.5px] text-slate-500">{children}</td>
    </tr>
  );
}

export function ResultCount({ total, shown, noun }: { total: number; shown: number; noun: string }) {
  const plural = total === 1 ? noun : `${noun}s`;
  return (
    <p className="mb-2 text-[12px] font-semibold text-slate-600" aria-live="polite">
      {shown === total ? `${formatCount(total)} ${plural}` : `Showing ${formatCount(shown)} of ${formatCount(total)} ${plural}`}
    </p>
  );
}

export function Pagination({ page, pageCount, hrefFor }: { page: number; pageCount: number; hrefFor: (page: number) => string }) {
  if (pageCount <= 1) return null;
  return (
    <nav className="mt-3 flex items-center justify-between gap-3" aria-label="Pages">
      {page > 1 ? <Link href={hrefFor(page - 1)} className={buttonClasses({ variant: "secondary", size: "sm" })}>Previous</Link> : <span />}
      <p className="text-[12px] font-semibold text-slate-600">Page {page} of {formatCount(pageCount)}</p>
      {page < pageCount ? <Link href={hrefFor(page + 1)} className={buttonClasses({ variant: "secondary", size: "sm" })}>Next</Link> : <span />}
    </nav>
  );
}

/**
 * A GET filter form. Filters live in the URL, and `next/form` navigates on
 * the client, so applying one keeps the shell and the scroll position.
 */
export function FilterBar({ action, resetHref, children }: { action: string; resetHref: string; children: React.ReactNode }) {
  return (
    <Form action={action} className="mb-4 rounded-2xl border border-slate-200 bg-white p-3">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">{children}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" className={buttonClasses({ variant: "dark", size: "sm" })}>Apply filters</button>
        <Link href={resetHref} className={buttonClasses({ variant: "ghost", size: "sm" })}>Reset</Link>
      </div>
    </Form>
  );
}

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block text-[11.5px] font-semibold text-slate-700", className)}>
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

export function DefinitionGrid({ items, columns = 2 }: { items: [string, React.ReactNode][]; columns?: 2 | 3 | 4 }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3", columns === 2 ? "sm:grid-cols-2" : columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4")}>
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-slate-500">{label}</dt>
          <dd className="mt-0.5 break-words text-[12.5px] text-slate-900">{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TextLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return <Link href={href} className={cn("font-semibold text-brand-600 hover:underline", className)}>{children}</Link>;
}
