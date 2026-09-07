"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BarChart3,
  ClipboardCheck,
  FileQuestion,
  Gauge,
  GraduationCap,
  Home,
  ListChecks,
  UserRound,
} from "lucide-react";
import { BrandMark } from "@/components/brand/brand-mark";
import { cn } from "@/lib/utils";

const mobileItems = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/practice", label: "Practice", icon: GraduationCap },
  { href: "/mock", label: "Mock", icon: ClipboardCheck },
  { href: "/progress", label: "Progress", icon: BarChart3 },
  { href: "/me", label: "Me", icon: UserRound },
] as const;

const desktopGroups = [
  {
    label: "MAIN",
    items: [
      { href: "/home", label: "Dashboard", icon: Home },
      { href: "/practice", label: "Practice", icon: GraduationCap },
      { href: "/mock", label: "Mock Exams", icon: ClipboardCheck },
      { href: "/practice?mode=past", label: "Past Questions", icon: FileQuestion },
    ],
  },
  {
    label: "PROGRESS",
    items: [
      { href: "/progress", label: "Results", icon: ListChecks },
      { href: "/progress/mistakes", label: "Mistakes", icon: Gauge },
      { href: "/progress#performance", label: "Performance", icon: BarChart3 },
    ],
  },
  {
    label: "PERSONAL",
    items: [
      { href: "/me", label: "Profile", icon: UserRound },
    ],
  },
] as const;

/**
 * How well an entry describes where the student is. Higher wins; -1 never matches.
 *
 * Two entries can share a route and differ only by query — /practice and
 * /practice?mode=past — so a query that is present and satisfied scores above
 * the bare route, and one that is not satisfied does not match at all. That is
 * what stops both Practice rows lighting up at once.
 */
function matchScore(pathname: string, params: URLSearchParams, href: string) {
  // A fragment link is an in-page destination. The browser never sends it, so
  // no rail can know whether the student is looking at that part of the page —
  // it stays unhighlighted and the route that owns the page keeps the state.
  if (href.includes("#")) return -1;

  const [path, query] = href.split("?");
  if (pathname !== path && !pathname.startsWith(path + "/")) return -1;
  if (!query) return path.length;

  const expected = [...new URLSearchParams(query)];
  return expected.every(([key, value]) => params.get(key) === value) ? path.length + expected.length : -1;
}

/** The single entry that best describes the current location, or none. */
function activeHref(pathname: string, params: URLSearchParams, hrefs: readonly string[]) {
  let best: string | undefined;
  let bestScore = 0;
  for (const href of hrefs) {
    const score = matchScore(pathname, params, href);
    if (score > bestScore) {
      best = href;
      bestScore = score;
    }
  }
  return best;
}

export interface ExamLabel {
  shortName: string;
  year: number;
}

const desktopHrefs = desktopGroups.flatMap((group) => group.items.map((item) => item.href));
const mobileHrefs = mobileItems.map((item) => item.href);

export function StudentNavigation({ examLabel }: { examLabel: ExamLabel | null }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const desktopActive = activeHref(pathname, params, desktopHrefs);
  const mobileActive = activeHref(pathname, params, mobileHrefs);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[246px] flex-col bg-slate-950 px-4 pb-5 pt-6 text-white lg:flex">
        <BrandMark inverse className="px-2" />
        <nav className="mt-8 flex-1 overflow-y-auto" aria-label="Student navigation">
          {desktopGroups.map((group) => (
            <div className="mb-5" key={group.label}>
              <div className="mb-2 px-3 text-[10px] font-bold tracking-[0.18em] text-white/35">{group.label}</div>
              <div className="space-y-1">
                {group.items.map(({ href, label, icon: Icon }) => {
                  const active = href === desktopActive;
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-10 items-center gap-3 rounded-xl px-3 text-[13px] font-semibold transition-colors motion-reduce:transition-none",
                        // The sidebar is slate-950, so the brand ring would
                        // disappear into it; white reads against the dark rail.
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
                        active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white",
                      )}
                    >
                      <Icon aria-hidden="true" className="h-[17px] w-[17px]" strokeWidth={1.9} />
                      <span>{label}</span>
                      {active ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-500" /> : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
          <div className="text-xs font-bold">{examLabel ? `${examLabel.shortName} ${examLabel.year}` : "Your exam"}</div>
          <div className="mt-1 text-[11px] leading-4 text-white/60">Your preparation workspace</div>
        </div>
      </aside>

      <nav
        aria-label="Primary"
        className="safe-area-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden"
      >
        <div className="mx-auto grid h-[68px] max-w-lg grid-cols-5 px-2">
          {mobileItems.map(({ href, label, icon: Icon }) => {
            const active = href === mobileActive;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-semibold",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
                  active ? "text-slate-950" : "text-slate-400",
                )}
              >
                {active ? <span className="absolute top-0 h-0.5 w-7 rounded-full bg-brand-500" /> : null}
                <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={active ? 2.3 : 1.8} />
                <span className="truncate">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
