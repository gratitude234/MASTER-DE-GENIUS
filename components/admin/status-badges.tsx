import { Badge } from "@/components/ui/badge";
import type { BadgeTone } from "@/components/ui/variants";
import { humanize } from "@/features/admin/format";
import { ADMIN_STATUS_LABELS, type ClassLeadStatus } from "@/features/classes/types";

/* One place decides which colour a status earns. Every badge also prints its text. */

const LEAD_TONES: Record<ClassLeadStatus, BadgeTone> = {
  new: "warning", contacted: "brand", interested: "brand", follow_up: "brand",
  enrolled: "success", not_interested: "neutral", closed: "neutral",
};

export function LeadStatusBadge({ status }: { status: ClassLeadStatus }) {
  return <Badge tone={LEAD_TONES[status]} dot>{ADMIN_STATUS_LABELS[status]}</Badge>;
}

const PAYMENT_TONES: Record<string, BadgeTone> = { success: "success", pending: "warning", failed: "danger", abandoned: "neutral", reversed: "danger" };

export function PaymentStatusBadge({ status }: { status: string }) {
  return <Badge tone={PAYMENT_TONES[status] ?? "neutral"} dot>{humanize(status)}</Badge>;
}

const SESSION_TONES: Record<string, BadgeTone> = {
  created: "brand", in_progress: "brand", completed: "success", submitted: "success", expired: "neutral", abandoned: "neutral",
};

export function SessionStatusBadge({ status, overdue = false }: { status: string; overdue?: boolean }) {
  if (overdue) return <Badge tone="warning" dot>Overdue</Badge>;
  return <Badge tone={SESSION_TONES[status] ?? "neutral"} dot>{humanize(status)}</Badge>;
}

const QUESTION_TONES: Record<string, BadgeTone> = { draft: "neutral", pending_review: "warning", active: "success", flagged: "danger", disabled: "neutral" };

export function QuestionStatusBadge({ status }: { status: string }) {
  return <Badge tone={QUESTION_TONES[status] ?? "neutral"} dot>{humanize(status)}</Badge>;
}

const SUPPORT_TONES: Record<string, BadgeTone> = { open: "warning", in_progress: "brand", resolved: "success" };

export function SupportStatusBadge({ status }: { status: string }) {
  return <Badge tone={SUPPORT_TONES[status] ?? "neutral"} dot>{humanize(status)}</Badge>;
}

export function PlanBadge({ tier }: { tier: "free" | "master" }) {
  return tier === "master" ? <Badge tone="brand">Master</Badge> : <Badge tone="neutral">Free</Badge>;
}
