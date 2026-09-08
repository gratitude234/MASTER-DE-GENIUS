import { Receipt } from "lucide-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { radius, typography } from "@/components/ui/variants";
import type { PaymentHistoryEntry } from "@/features/billing/entitlements";
import { formatNaira } from "@/features/billing/plans";
import { cn } from "@/lib/utils";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * Payment status, in words a student recognises.
 *
 * Never colour alone: each chip carries its own label, and "Pending" reads the
 * same to somebody who cannot distinguish amber from green.
 */
const statusPresentation: Record<string, { label: string; tone: BadgeProps["tone"] }> = {
  success: { label: "Paid", tone: "success" },
  pending: { label: "Pending", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  abandoned: { label: "Cancelled", tone: "neutral" },
  reversed: { label: "Reversed", tone: "danger" },
};

/**
 * The student's own transaction history.
 *
 * Everything shown here comes from the safe projection in the entitlement
 * service. Webhook payloads, provider transaction ids, provider status strings,
 * authorization codes and checkout URLs are not merely hidden by this component
 * — they are absent from the data it receives, and from the column grants the
 * browser holds on the table.
 */
export function PaymentHistory({ payments }: { payments: PaymentHistoryEntry[] }) {
  if (payments.length === 0) {
    return (
      <EmptyState
        icon={<Receipt className="h-5 w-5" aria-hidden="true" />}
        title="No payments yet"
        description="Once you buy Master access, every payment appears here with its reference, amount and the access it bought."
      />
    );
  }

  return (
    <ul className="space-y-2.5">
      {payments.map((payment) => {
        const status = statusPresentation[payment.status] ?? { label: payment.status, tone: "neutral" as const };

        return (
          <li key={payment.id} className={cn("border border-slate-200 bg-white p-4", radius.card)}>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-slate-950">{payment.planName}</div>
                <div className={cn(typography.caption, "mt-0.5")}>
                  {dateFormatter.format(new Date(payment.paidAt ?? payment.createdAt))} · {payment.accessDays} days of access
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2.5">
                <span className="mono-number text-[14px] font-semibold text-slate-950">
                  {formatNaira(payment.amountKobo)}
                </span>
                <Badge tone={status.tone} dot>{status.label}</Badge>
              </div>
            </div>

            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-100 pt-3">
              <div className="flex items-baseline gap-1.5">
                <dt className={typography.caption}>Reference</dt>
                {/*
                  Shortened for the screen. Quoting a full reference out loud in
                  a support chat, or leaving one in a screenshot, is the common
                  way an identifier travels further than intended.
                */}
                <dd className="mono-number text-[11.5px] text-slate-700">{payment.maskedReference}</dd>
              </div>
              {payment.entitlementExpiresAt ? (
                <div className="flex items-baseline gap-1.5">
                  <dt className={typography.caption}>Access until</dt>
                  <dd className="text-[11.5px] font-semibold text-slate-700">
                    {dateFormatter.format(new Date(payment.entitlementExpiresAt))}
                  </dd>
                </div>
              ) : null}
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
