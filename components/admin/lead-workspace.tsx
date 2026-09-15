"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Select } from "@/components/ui/select";
import { buttonClasses, fieldClasses } from "@/components/ui/variants";
import { updateLeadAction } from "@/features/admin/actions/operations";
import { track } from "@/features/analytics/events";
import { ADMIN_STATUS_LABELS, CLASS_LEAD_STATUSES, type ClassLeadStatus } from "@/features/classes/types";
import { cn } from "@/lib/utils";

const QUICK_STATUSES: ClassLeadStatus[] = ["contacted", "interested", "follow_up", "enrolled", "not_interested", "closed"];

export interface LeadWorkspaceProps {
  leadId: string;
  status: ClassLeadStatus;
  assignedTo: string | null;
  currentAdminId: string;
  canManage: boolean;
  assignees: { userId: string; label: string }[];
  /** Built on the server from name, exam and subject only — never performance. */
  whatsappHref: string | null;
}

export function LeadWorkspace({ leadId, status, assignedTo, currentAdminId, canManage, assignees, whatsappHref }: LeadWorkspaceProps) {
  const router = useRouter();
  const ids = { status: useId(), owner: useId(), note: useId() };
  const [nextStatus, setNextStatus] = useState<ClassLeadStatus>(status);
  const [owner, setOwner] = useState(assignedTo ?? "");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function save(change: { status?: ClassLeadStatus; assignedTo?: string | null; note?: string }) {
    setMessage(null);
    startTransition(async () => {
      const result = await updateLeadAction(leadId, change);
      if (!result.ok) {
        setMessage({ tone: "danger", text: result.error });
        return;
      }
      if (change.status && change.status !== status) {
        track("class_lead_status_changed", { from: status, to: change.status });
        if (change.status === "enrolled") track("class_lead_enrolled", { from: status });
      }
      setNote("");
      setMessage({ tone: "success", text: result.message });
      router.refresh();
    });
  }

  const dirty = nextStatus !== status || owner !== (assignedTo ?? "") || note.trim().length > 0;

  return (
    <div className="space-y-4">
      {whatsappHref ? (
        <a href={whatsappHref} target="_blank" rel="noreferrer" className={buttonClasses({ variant: "secondary", size: "md", fullWidth: true })}>
          Message on WhatsApp <ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
        </a>
      ) : (
        <p className="text-[12px] text-slate-500">This phone number cannot be opened in WhatsApp.</p>
      )}

      {canManage ? (
        <>
          <div>
            <p className="mb-1.5 text-[12px] font-semibold text-slate-800">Quick update</p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_STATUSES.filter((value) => value !== status).map((value) => (
                <Button key={value} type="button" size="sm" variant={value === "enrolled" ? "primary" : "secondary"} disabled={pending} onClick={() => save({ status: value })}>
                  {ADMIN_STATUS_LABELS[value]}
                </Button>
              ))}
              {assignedTo !== currentAdminId && assignees.some((assignee) => assignee.userId === currentAdminId) ? (
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => save({ assignedTo: currentAdminId })}>Assign to me</Button>
              ) : null}
            </div>
          </div>

          <div className="space-y-3 border-t border-slate-100 pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label htmlFor={ids.status} className="block text-[12px] font-semibold text-slate-800">
                Status
                <Select id={ids.status} size="md" containerClassName="mt-1.5" value={nextStatus} onChange={(event) => setNextStatus(event.target.value as ClassLeadStatus)}>
                  {CLASS_LEAD_STATUSES.map((value) => <option key={value} value={value}>{ADMIN_STATUS_LABELS[value]}</option>)}
                </Select>
              </label>
              <label htmlFor={ids.owner} className="block text-[12px] font-semibold text-slate-800">
                Owner
                <Select id={ids.owner} size="md" containerClassName="mt-1.5" value={owner} onChange={(event) => setOwner(event.target.value)}>
                  <option value="">Unassigned</option>
                  {assignees.map((assignee) => <option key={assignee.userId} value={assignee.userId}>{assignee.label}</option>)}
                </Select>
              </label>
            </div>
            <label htmlFor={ids.note} className="block text-[12px] font-semibold text-slate-800">
              Add internal note
              <textarea id={ids.note} value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={5000} placeholder="Never shown to the student" className={cn(fieldClasses({ size: "md" }), "mt-1.5 h-auto py-2")} />
            </label>
            <Button
              type="button"
              variant="dark"
              loading={pending}
              disabled={!dirty}
              onClick={() => save({
                status: nextStatus !== status ? nextStatus : undefined,
                assignedTo: owner !== (assignedTo ?? "") ? owner || null : undefined,
                note: note.trim() || undefined,
              })}
            >
              Save changes
            </Button>
          </div>
        </>
      ) : null}

      {message ? <InlineAlert tone={message.tone}>{message.text}</InlineAlert> : null}
    </div>
  );
}
