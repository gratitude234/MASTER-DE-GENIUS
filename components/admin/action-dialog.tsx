"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Sheet } from "@/components/ui/sheet";
import { fieldClasses, type ButtonVariant } from "@/components/ui/variants";
import type { AdminActionResult } from "@/features/admin/action-result";
import { cn } from "@/lib/utils";

export interface ActionDialogProps {
  triggerLabel: string;
  triggerVariant?: ButtonVariant;
  title: string;
  description?: string;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  /** Shown when the action needs a written justification for the audit log. */
  reasonLabel?: string;
  reasonRequired?: boolean;
  children?: React.ReactNode;
  action: (reason: string) => Promise<AdminActionResult<unknown>>;
}

/**
 * Confirmation for a sensitive or irreversible action. The reason typed here
 * is stored in the audit log with the change.
 */
export function ActionDialog({
  triggerLabel,
  triggerVariant = "secondary",
  title,
  description,
  confirmLabel,
  confirmVariant = "dark",
  reasonLabel,
  reasonRequired = true,
  children,
  action,
}: ActionDialogProps) {
  const router = useRouter();
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const tooShort = Boolean(reasonLabel) && reasonRequired && reason.trim().length < 5;

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await action(reason);
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
      <Button type="button" size="sm" variant={triggerVariant} onClick={() => { setNotice(null); setOpen(true); }}>
        {triggerLabel}
      </Button>
      {notice ? <InlineAlert tone="success">{notice}</InlineAlert> : null}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!pending}
        title={title}
        description={description}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" variant={confirmVariant} loading={pending} disabled={tooShort} onClick={confirm}>{confirmLabel}</Button>
          </div>
        }
      >
        <div className="space-y-3">
          {children}
          {reasonLabel ? (
            <label htmlFor={reasonId} className="block text-[12px] font-semibold text-slate-800">
              {reasonLabel}
              <textarea
                id={reasonId}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={1000}
                rows={3}
                className={cn(fieldClasses({ size: "md" }), "mt-1.5 h-auto py-2")}
              />
              {reasonRequired ? <span className="mt-1 block text-[11px] font-medium text-slate-500">Recorded in the audit log. At least 5 characters.</span> : null}
            </label>
          ) : null}
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        </div>
      </Sheet>
    </div>
  );
}
