"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { fieldClasses } from "@/components/ui/variants";
import { createSupportCaseAction } from "@/features/admin/actions/operations";
import { cn } from "@/lib/utils";

const CATEGORIES: [string, string][] = [
  ["account", "Account"], ["billing", "Billing / payment"], ["academic", "Academic"], ["exam_session", "Exam or session"],
  ["classes", "Master Classes"], ["technical", "Technical"], ["other", "Other"],
];
const CHANNELS: [string, string][] = [["whatsapp", "WhatsApp"], ["email", "Email"], ["phone", "Phone call"], ["in_app", "In the app"], ["other", "Other"]];

export function SupportCaseDialog({
  userId,
  studentLabel,
  assignees,
  triggerVariant = "secondary",
}: {
  userId?: string | null;
  studentLabel?: string;
  assignees: { userId: string; label: string }[];
  triggerVariant?: "secondary" | "dark";
}) {
  const router = useRouter();
  const ids = { category: useId(), channel: useId(), subject: useId(), message: useId(), assignee: useId() };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ category: "account", channel: "whatsapp", subject: "", message: "", assignedTo: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createSupportCaseAction({ ...form, userId: userId ?? null, assignedTo: form.assignedTo || null });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setForm({ category: "account", channel: "whatsapp", subject: "", message: "", assignedTo: "" });
      if (result.data?.id) router.push(`/admin/support/${result.data.id}`);
      else router.refresh();
    });
  }

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <>
      <Button type="button" size="sm" variant={triggerVariant} onClick={() => setOpen(true)}>Log support case</Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!pending}
        title="Log a support case"
        description={studentLabel ? `For ${studentLabel}.` : "Record a problem a student reported so it can be owned and resolved."}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" variant="dark" loading={pending} disabled={form.subject.trim().length < 3} onClick={submit}>Open case</Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label htmlFor={ids.category} className="block text-[12px] font-semibold text-slate-800">
            Category
            <Select id={ids.category} size="md" containerClassName="mt-1.5" value={form.category} onChange={set("category")}>
              {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </label>
          <label htmlFor={ids.channel} className="block text-[12px] font-semibold text-slate-800">
            Reached us by
            <Select id={ids.channel} size="md" containerClassName="mt-1.5" value={form.channel} onChange={set("channel")}>
              {CHANNELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </label>
          <label htmlFor={ids.subject} className="block text-[12px] font-semibold text-slate-800 sm:col-span-2">
            Summary
            <input id={ids.subject} value={form.subject} onChange={set("subject")} maxLength={160} placeholder="e.g. Paid but still on Free" className={cn(fieldClasses({ size: "md" }), "mt-1.5")} />
          </label>
          <label htmlFor={ids.message} className="block text-[12px] font-semibold text-slate-800 sm:col-span-2">
            Details
            <textarea id={ids.message} value={form.message} onChange={set("message")} rows={4} maxLength={3000} className={cn(fieldClasses({ size: "md" }), "mt-1.5 h-auto py-2")} />
          </label>
          <label htmlFor={ids.assignee} className="block text-[12px] font-semibold text-slate-800 sm:col-span-2">
            Owner
            <Select id={ids.assignee} size="md" containerClassName="mt-1.5" value={form.assignedTo} onChange={set("assignedTo")}>
              <option value="">Unassigned</option>
              {assignees.map((assignee) => <option key={assignee.userId} value={assignee.userId}>{assignee.label}</option>)}
            </Select>
          </label>
          {error ? <div className="sm:col-span-2"><InlineAlert tone="danger">{error}</InlineAlert></div> : null}
        </div>
      </Sheet>
    </>
  );
}
