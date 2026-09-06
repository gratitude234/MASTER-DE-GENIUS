"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bookmark,
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
      { href: "/progress?tab=mistakes", label: "Mistakes", icon: Gauge },
      { href: "/progress?tab=performance", label: "Performance", icon: BarChart3 },
    ],
  },
  {
    label: "PERSONAL",
    items: [
      { href: "/me?tab=bookmarks", label: "Bookmarks", icon: Bookmark },
      { href: "/me", label: "Profile", icon: UserRound },
    ],
  },
] as const;

function isActive(pathname: string, href: string) {
  const path = href.split("?")[0];
  if (path === "/home") return pathname === "/home";
  return pathname.startsWith(path);
}

export function StudentNavigation() {
  const pathname = usePathname();

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
                  const active = isActive(pathname, href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={cn(
                        "flex min-h-10 items-center gap-3 rounded-xl px-3 text-[13px] font-semibold transition-colors",
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
          <div className="text-xs font-bold">JAMB 2027</div>
          <div className="mt-1 text-[11px] leading-4 text-white/45">Your preparation workspace</div>
        </div>
      </aside>

      <nav
        aria-label="Primary"
        className="safe-area-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden"
      >
        <div className="mx-auto grid h-[68px] max-w-lg grid-cols-5 px-2">
          {mobileItems.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "relative flex min-w-0 flex-col items-center justify-center gap-1 text-[10px] font-semibold",
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
