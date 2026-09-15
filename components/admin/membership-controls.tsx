"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { fieldClasses } from "@/components/ui/variants";
import { grantMembershipAction, updateMembershipAction } from "@/features/admin/actions/operations";
import { ADMIN_ROLES, ADMIN_ROLE_LABELS, ADMIN_ROLE_SUMMARIES, type AdminRole } from "@/features/admin/permissions";
import { cn } from "@/lib/utils";

function useSubmit() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (work: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>, onSuccess: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(result.message);
      onSuccess();
      router.refresh();
    });
  };
  return { error, notice, pending, run, setNotice };
}

/** Promotes an existing account. There is no way to create an admin who has not signed up. */
export function GrantMembershipDialog() {
  const ids = { email: useId(), role: useId(), reason: useId() };
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminRole>("support_admin");
  const [reason, setReason] = useState("");
  const { error, notice, pending, run, setNotice } = useSubmit();

  return (
    <div className="space-y-2">
      <Button type="button" size="sm" variant="dark" onClick={() => { setNotice(null); setOpen(true); }}>Add administrator</Button>
      {notice ? <InlineAlert tone="success">{notice}</InlineAlert> : null}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!pending}
        title="Add an administrator"
        description="The person must already have a Master De Genius account."
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" variant="dark" loading={pending} disabled={!email.includes("@") || reason.trim().length < 5} onClick={() => run(() => grantMembershipAction(email, role, reason), () => { setOpen(false); setEmail(""); setReason(""); })}>Grant access</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <label htmlFor={ids.email} className="block text-[12px] font-semibold text-slate-800">
            Account email
            <input id={ids.email} type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" className={cn(fieldClasses({ size: "md" }), "mt-1.5")} />
          </label>
          <label htmlFor={ids.role} className="block text-[12px] font-semibold text-slate-800">
            Role
            <Select id={ids.role} size="md" containerClassName="mt-1.5" value={role} onChange={(event) => setRole(event.target.value as AdminRole)}>
              {ADMIN_ROLES.map((value) => <option key={value} value={value}>{ADMIN_ROLE_LABELS[value]}</option>)}
            </Select>
            <span className="mt-1 block text-[11px] font-medium text-slate-500">{ADMIN_ROLE_SUMMARIES[role]}</span>
          </label>
          <label htmlFor={ids.reason} className="block text-[12px] font-semibold text-slate-800">
            Reason
            <textarea id={ids.reason} value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={1000} className={cn(fieldClasses({ size: "md" }), "mt-1.5 h-auto py-2")} />
          </label>
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        </div>
      </Sheet>
    </div>
  );
}

/** Role change and activation for one membership, always with a recorded reason. */
export function MembershipRowControls({ userId, email, role, isActive }: { userId: string; email: string; role: AdminRole; isActive: boolean }) {
  const ids = { role: useId(), reason: useId() };
  const [mode, setMode] = useState<"role" | "status" | null>(null);
  const [nextRole, setNextRole] = useState<AdminRole>(role);
  const [reason, setReason] = useState("");
  const { error, notice, pending, run } = useSubmit();

  const close = () => { setMode(null); setReason(""); };
  const confirm = () => run(
    () => updateMembershipAction(userId, mode === "role" ? { role: nextRole } : { isActive: !isActive }, reason),
    close,
  );

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {isActive ? <Button type="button" size="sm" variant="secondary" onClick={() => { setNextRole(role); setMode("role"); }}>Change role</Button> : null}
        <Button type="button" size="sm" variant={isActive ? "ghost" : "secondary"} onClick={() => setMode("status")}>{isActive ? "Deactivate" : "Reactivate"}</Button>
      </div>
      {notice ? <InlineAlert tone="success">{notice}</InlineAlert> : null}
      <Sheet
        open={mode !== null}
        onClose={close}
        dismissible={!pending}
        title={mode === "role" ? `Change role for ${email}` : isActive ? `Deactivate ${email}?` : `Reactivate ${email}?`}
        description={mode === "status" && isActive ? "They lose admin access immediately. Their student account is not affected." : undefined}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" disabled={pending} onClick={close}>Cancel</Button>
            <Button type="button" variant={mode === "status" && isActive ? "danger" : "dark"} loading={pending} disabled={reason.trim().length < 5 || (mode === "role" && nextRole === role)} onClick={confirm}>
              {mode === "role" ? "Change role" : isActive ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {mode === "role" ? (
            <label htmlFor={ids.role} className="block text-[12px] font-semibold text-slate-800">
              New role
              <Select id={ids.role} size="md" containerClassName="mt-1.5" value={nextRole} onChange={(event) => setNextRole(event.target.value as AdminRole)}>
                {ADMIN_ROLES.map((value) => <option key={value} value={value}>{ADMIN_ROLE_LABELS[value]}</option>)}
              </Select>
              <span className="mt-1 block text-[11px] font-medium text-slate-500">{ADMIN_ROLE_SUMMARIES[nextRole]}</span>
            </label>
          ) : null}
          <label htmlFor={ids.reason} className="block text-[12px] font-semibold text-slate-800">
            Reason
            <textarea id={ids.reason} value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={1000} className={cn(fieldClasses({ size: "md" }), "mt-1.5 h-auto py-2")} />
            <span className="mt-1 block text-[11px] font-medium text-slate-500">Recorded in the audit log.</span>
          </label>
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        </div>
      </Sheet>
    </div>
  );
}
