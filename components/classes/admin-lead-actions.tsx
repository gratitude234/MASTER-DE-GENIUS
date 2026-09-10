"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Select } from "@/components/ui/select";
import { ADMIN_STATUS_LABELS, CLASS_LEAD_STATUSES, type ClassLeadStatus } from "@/features/classes/types";
import { track } from "@/features/analytics/events";

export function AdminLeadActions({ id, initialStatus, initialNotes }: { id: string; initialStatus: ClassLeadStatus; initialNotes: string | null }) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const save = async () => {
    setSaving(true); setMessage(null);
    try {
      const response = await fetch(`/api/admin/classes/leads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, notes }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not update lead.");
      track("class_lead_status_changed", { from: initialStatus, to: status });
      if (status === "enrolled" && initialStatus !== "enrolled") track("class_lead_enrolled", { from: initialStatus });
      setMessage({ tone: "success", text: "Lead updated." }); router.refresh();
    } catch (error) { setMessage({ tone: "danger", text: error instanceof Error ? error.message : "Could not update lead." }); }
    finally { setSaving(false); }
  };
  return <div className="space-y-3 border-t border-slate-100 pt-4">{message ? <InlineAlert tone={message.tone}>{message.text}</InlineAlert> : null}<div className="grid gap-3 sm:grid-cols-[180px_1fr_auto]"><label className="text-xs font-semibold text-slate-800">Status<Select value={status} onChange={(event) => setStatus(event.target.value as ClassLeadStatus)} containerClassName="mt-1.5">{CLASS_LEAD_STATUSES.map((value) => <option key={value} value={value}>{ADMIN_STATUS_LABELS[value]}</option>)}</Select></label><label className="text-xs font-semibold text-slate-800">Internal notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15" /></label><Button type="button" onClick={save} loading={saving} className="self-end">Save</Button></div></div>;
}
