"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { fieldClasses } from "@/components/ui/variants";
import { grantMasterAccessAction } from "@/features/admin/actions/students";
import { cn } from "@/lib/utils";

const PRESETS = [7, 14, 30, 90, 180] as const;

/**
 * Grants or extends Master by hand. The confirmation restates what will
 * happen, because the change applies to a real student immediately and the
 * reason becomes part of the permanent audit trail.
 */
export function GrantMasterDialog({ userId, studentName, currentExpiry, isMaster }: { userId: string; studentName: string; currentExpiry: string | null; isMaster: boolean }) {
  const router = useRouter();
  const ids = { mode: useId(), days: useId(), date: useId(), reason: useId() };
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"days" | "date">("days");
  const [days, setDays] = useState("30");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = reason.trim().length >= 5 && (mode === "days" ? Number(days) > 0 : Boolean(date));

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await grantMasterAccessAction(userId, { mode, days, expiresOn: date, reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setReason("");
      setNotice(result.message);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Button type="button" size="sm" variant="primary" onClick={() => { setNotice(null); setOpen(true); }}>
        {isMaster ? "Extend Master" : "Grant Master"}
      </Button>
      {notice ? <InlineAlert tone="success">{notice}</InlineAlert> : null}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!pending}
        title={isMaster ? "Extend Master access" : "Grant Master access"}
        description={`For ${studentName}. No payment is recorded; this appears as a manual grant.`}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" variant="dark" loading={pending} disabled={!ready} onClick={submit}>Confirm grant</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <fieldset>
            <legend className="text-[12px] font-semibold text-slate-800">How long</legend>
            <div className="mt-1.5 flex gap-2" role="radiogroup" id={ids.mode}>
              {(["days", "date"] as const).map((value) => (
                <label key={value} className={cn("flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded-xl border px-3 text-[12.5px] font-semibold", mode === value ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 text-slate-700")}>
                  <input type="radio" name="grant-mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="sr-only" />
                  {value === "days" ? "Add days" : "Until a date"}
                </label>
              ))}
            </div>
          </fieldset>

          {mode === "days" ? (
            <label htmlFor={ids.days} className="block text-[12px] font-semibold text-slate-800">
              Days to add
              <Select id={ids.days} size="md" containerClassName="mt-1.5" value={days} onChange={(event) => setDays(event.target.value)}>
                {PRESETS.map((value) => <option key={value} value={value}>{value} days</option>)}
              </Select>
              <span className="mt-1 block text-[11px] font-medium text-slate-500">
                {isMaster ? "Added to the current expiry, so no paid days are lost." : "Starts from now."}
              </span>
            </label>
          ) : (
            <label htmlFor={ids.date} className="block text-[12px] font-semibold text-slate-800">
              Access until the end of
              <input id={ids.date} type="date" value={date} onChange={(event) => setDate(event.target.value)} className={cn(fieldClasses({ size: "md" }), "mt-1.5")} />
              <span className="mt-1 block text-[11px] font-medium text-slate-500">
                {isMaster && currentExpiry ? "Must be later than the current expiry: grants never shorten access." : "West Africa Time."}
              </span>
            </label>
          )}

          <label htmlFor={ids.reason} className="block text-[12px] font-semibold text-slate-800">
            Reason
            <textarea id={ids.reason} value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={1000} placeholder="e.g. Paid by bank transfer, reference 0123" className={cn(fieldClasses({ size: "md" }), "mt-1.5 h-auto py-2")} />
            <span className="mt-1 block text-[11px] font-medium text-slate-500">Recorded in the audit log with your name. At least 5 characters.</span>
          </label>
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        </div>
      </Sheet>
    </div>
  );
}
