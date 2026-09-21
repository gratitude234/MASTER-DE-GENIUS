"use client";

import Link from "next/link";

import { track } from "@/features/analytics/events";
import { UPGRADE_CTA_LABEL, upgradeHref, type UpgradeSource } from "@/features/billing/upgrade";

/**
 * The one "Upgrade to Master" link.
 *
 * Every prompt in the product renders this, so every one of them goes straight
 * to the plan cards on /pricing and reports which prompt it was. The source is
 * a fixed identifier from `UPGRADE_SOURCES` — nothing about the student.
 *
 * A real link, not a button: it opens in a new tab, survives right-click and
 * works from the keyboard like every other link.
 */
export function UpgradeLink({
  source,
  className,
  children = UPGRADE_CTA_LABEL,
  ariaLabel,
}: {
  source: UpgradeSource;
  className?: string;
  children?: React.ReactNode;
  /** Only when the visible text alone would be ambiguous out of context. */
  ariaLabel?: string;
}) {
  return (
    <Link
      href={upgradeHref(source)}
      className={className}
      aria-label={ariaLabel}
      data-upgrade-source={source}
      onClick={() => track("upgrade_cta_clicked", { source })}
    >
      {children}
    </Link>
  );
}
