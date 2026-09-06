"use client";
import { useState } from "react";
import { signOutAction } from "@/features/auth/actions";
import { clearDevice, listRecords } from "@/features/offline/storage";
export function SignOut() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <div><button disabled={busy} className="flex min-h-12 w-full items-center justify-center rounded-xl border bg-white text-sm font-bold" onClick={async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const records = await listRecords();
      if (records.some(r => Object.keys(r.pending).length > 0) && !window.confirm("Some answers are only saved on this device. Signing out removes them. Sign out anyway?")) { setBusy(false); return; }
      await clearDevice();
      for (const key of Object.keys(localStorage)) if (key.startsWith("mdg:")) localStorage.removeItem(key);
      navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_MEDIA" });
      const channel = new BroadcastChannel("mdg-session"); channel.postMessage("signed-out"); channel.close();
    } catch { setError("Could not clear saved device data. Close other session tabs and retry."); setBusy(false); return; }
    await signOutAction();
  }}>{busy ? "Signing out…" : "Sign out"}</button>{error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}</div>;
}
