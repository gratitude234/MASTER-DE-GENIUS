"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RevisionInput } from "@/features/results/service";
export function RevisionButton({ input, children }: { input: RevisionInput; children: React.ReactNode }) {
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
  return <div><button type="button" disabled={busy} onClick={start} className="min-h-12 rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{busy ? "Starting…" : children}</button>{error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}</div>;
}
