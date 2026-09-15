"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Select } from "@/components/ui/select";
import { fieldClasses } from "@/components/ui/variants";
import { updateSupportCaseAction } from "@/features/admin/actions/operations";
import { cn } from "@/lib/utils";

const STATUSES: [string, string][] = [["open", "Open"], ["in_progress", "In progress"], ["resolved", "Resolved"]];

export function SupportCaseWorkspace({ caseId, status, assignedTo, assignees }: { caseId: string; status: string; assignedTo: string | null; assignees: { userId: string; label: string }[] }) {
  const router = useRouter();
  const ids = { status: useId(), owner: useId(), note: useId() };
  const [nextStatus, setNextStatus] = useState(status);
  const [owner, setOwner] = useState(assignedTo ?? "");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = nextStatus !== status || owner !== (assignedTo ?? "") || note.trim().length > 0;

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await updateSupportCaseAction(caseId, {
        status: nextStatus !== status ? nextStatus : undefined,
        assignedTo: owner !== (assignedTo ?? "") ? owner || null : undefined,
        note: note.trim() || undefined,
      });
      if (!result.ok) {
        setMessage({ tone: "danger", text: result.error });
        return;
      }
      setNote("");
      setMessage({ tone: "success", text: result.message });
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor={ids.status} className="block text-[12px] font-semibold text-slate-800">
          Status
          <Select id={ids.status} size="md" containerClassName="mt-1.5" value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}>
            {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
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
        <textarea id={ids.note} value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={5000} placeholder="What was checked, what the student was told" className={cn(fieldClasses({ size: "md" }), "mt-1.5 h-auto py-2")} />
      </label>
      <Button type="button" variant="dark" loading={pending} disabled={!dirty} onClick={save}>Save changes</Button>
      {message ? <InlineAlert tone={message.tone}>{message.text}</InlineAlert> : null}
    </div>
  );
}
