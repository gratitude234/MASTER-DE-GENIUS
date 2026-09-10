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
  BookOpenCheck,
  Sparkles,
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
      { href: "/classes", label: "Master Classes", icon: BookOpenCheck },
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
      { href: "/billing", label: "Plan & Billing", icon: Sparkles },
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

export function StudentNavigation({ examLabel }: { examLabel: ExamLabel | null }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const isWaec = examLabel?.shortName.toLowerCase() === "waec";
  const resolvedDesktopGroups = desktopGroups.map((group) => ({
    ...group,
    items: group.items.map((item) => item.href === "/mock" && isWaec
      ? { ...item, href: "/practice?timed=1", label: "Timed Subject" }
      : item),
  }));
  const resolvedMobileItems = mobileItems.map((item) => item.href === "/mock" && isWaec
    ? { ...item, href: "/practice?timed=1", label: "Timed" }
    : item);
  const desktopHrefs = resolvedDesktopGroups.flatMap((group) => group.items.map((item) => item.href));
  const mobileHrefs = resolvedMobileItems.map((item) => item.href);
  const desktopActive = activeHref(pathname, params, desktopHrefs);
  const mobileActive = activeHref(pathname, params, mobileHrefs);

  return (
    <>
      {/*
        The approved desktop rail: 250px of ink, sticky for its full height,
        with the exam card pinned to the bottom. Icons rather than the
        prototype's glyph characters — same 16px optical size, but they carry a
        proper accessible name and do not depend on a font that may not ship.
      */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[250px] flex-col bg-slate-950 px-4 pb-6 pt-6 text-white lg:flex">
        <BrandMark inverse sublabel={false} className="px-2 pb-7" />
        <nav className="flex-1 overflow-y-auto" aria-label="Student navigation">
          {resolvedDesktopGroups.map((group) => (
            <div className="mb-5" key={group.label}>
              <div className="mb-2 px-2.5 text-[10px] font-bold tracking-[0.16em] text-white/35">{group.label}</div>
              <div className="space-y-0.5">
                {group.items.map(({ href, label, icon: Icon }) => {
                  const active = href === desktopActive;
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-[38px] items-center gap-[11px] rounded-lg px-2.5 text-[13px] font-semibold transition-colors motion-reduce:transition-none",
                        // The sidebar is ink, so the brand ring would disappear
                        // into it; white reads against the dark rail.
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
                        active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white",
                      )}
                    >
                      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                      <span>{label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="mt-auto rounded-xl border border-white/[0.08] bg-white/[0.05] p-3">
          <div className="text-xs font-bold">{examLabel ? `${examLabel.shortName} ${examLabel.year}` : "Your exam"}</div>
          <div className="mt-0.5 text-[11px] leading-4 text-white/50">Your preparation workspace</div>
        </div>
      </aside>

      {/*
        The mobile tab bar spans the full width — five equal columns, no centred
        max-width — so the outer tabs stay reachable with a thumb on a 430px
        phone. State is carried by weight and colour together, never colour
        alone, and `aria-current` states it outright.
      */}
      <nav
        aria-label="Primary"
        className="safe-area-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/[0.97] backdrop-blur-lg lg:hidden"
      >
        <div className="grid h-nav-height grid-cols-5">
          {resolvedMobileItems.map(({ href, label, icon: Icon }) => {
            const active = href === mobileActive;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-w-0 flex-col items-center justify-center gap-[3px] rounded-lg text-[10px]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-inset",
                  active ? "font-bold text-slate-950" : "font-semibold text-slate-400",
                )}
              >
                <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={active ? 2.3 : 1.8} />
                <span className="truncate">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
