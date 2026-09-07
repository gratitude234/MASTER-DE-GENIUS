"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RevisionInput } from "@/features/results/service";
import { buttonClasses } from "@/components/ui/variants";

/**
 * Default chrome. Every caller — Home, Results and Mistakes — is now on the
 * design system, so the default is too; `className` stays for the callers that
 * need a different width or a ring that reads on a dark panel.
 */
const DEFAULT_BUTTON = buttonClasses({ variant: "primary", size: "md" });
const DEFAULT_ERROR = "mt-2 text-sm font-semibold text-danger-700";

export function RevisionButton({
  input,
  children,
  className,
  errorClassName,
}: {
  input: RevisionInput;
  children: React.ReactNode;
  className?: string;
  errorClassName?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function start() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/progress/practice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const payload = await response.json() as { sessionId?: string; error?: string };
      if (!response.ok || !payload.sessionId) throw new Error(payload.error || "Could not start revision.");
      router.push(`/practice/session/${payload.sessionId}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); setBusy(false); }
  }
  return <div><button type="button" disabled={busy} aria-busy={busy || undefined} onClick={start} className={className ?? DEFAULT_BUTTON}>{busy ? "Starting…" : children}</button>{error && <p role="alert" className={errorClassName ?? DEFAULT_ERROR}>{error}</p>}</div>;
}
