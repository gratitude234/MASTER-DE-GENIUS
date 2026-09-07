"use client";

import { useState } from "react";
import { signOutAction } from "@/features/auth/actions";
import { clearDevice, listRecords } from "@/features/offline/storage";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Sheet } from "@/components/ui/sheet";

const CLEAR_FAILED = "Could not clear saved device data. Close other session tabs and retry.";

/** What is still only on this device, used to word the confirmation honestly. */
type Unsynced = { sessions: number; answers: number };

export function SignOut() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [unsynced, setUnsynced] = useState<Unsynced | null>(null);

  /**
   * Clears this device, then ends the session. Unchanged from the original
   * order: device data first, so a failure leaves the student signed in and
   * able to reconnect rather than locked out with unsent answers.
   */
  async function finish() {
    try {
      await clearDevice();
      for (const key of Object.keys(localStorage)) if (key.startsWith("mdg:")) localStorage.removeItem(key);
      navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_MEDIA" });
      const channel = new BroadcastChannel("mdg-session");
      channel.postMessage("signed-out");
      channel.close();
    } catch {
      setError(CLEAR_FAILED);
      setBusy(false);
      setUnsynced(null);
      return;
    }
    await signOutAction();
  }

  async function start() {
    if (busy) return;
    setBusy(true);
    setError("");

    let records;
    try {
      records = await listRecords();
    } catch {
      setError(CLEAR_FAILED);
      setBusy(false);
      return;
    }

    // Only interrupt when there is something to lose — same rule as before.
    const pending = records.filter((record) => Object.keys(record.pending).length > 0);
    if (pending.length > 0) {
      setBusy(false);
      setUnsynced({
        sessions: pending.length,
        answers: pending.reduce((total, record) => total + Object.keys(record.pending).length, 0),
      });
      return;
    }

    await finish();
  }

  const answers = unsynced?.answers ?? 0;
  const sessions = unsynced?.sessions ?? 0;

  return (
    <div>
      <Button type="button" variant="secondary" size="lg" fullWidth loading={busy} loadingLabel="Signing out…" onClick={start}>
        Sign out
      </Button>
      {error ? <div className="mt-2"><InlineAlert tone="danger">{error}</InlineAlert></div> : null}

      <Sheet
        open={unsynced !== null}
        onClose={() => setUnsynced(null)}
        dismissible={!busy}
        title="Sign out with unsaved answers?"
        description="Some of your work has not reached our servers yet."
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" size="lg" disabled={busy} onClick={() => setUnsynced(null)}>
              Stay signed in
            </Button>
            <Button
              type="button"
              variant="danger"
              size="lg"
              loading={busy}
              loadingLabel="Signing out…"
              onClick={() => {
                setBusy(true);
                void finish();
              }}
            >
              Sign out anyway
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-6 text-slate-600">
          <strong className="font-bold text-slate-900">
            {answers} {answers === 1 ? "answer" : "answers"}
          </strong>{" "}
          across {sessions} saved {sessions === 1 ? "session" : "sessions"} {answers === 1 ? "is" : "are"} still only on
          this device.
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Signing out clears this device&apos;s saved data, so those answers will be lost. Anything already synced is
          safe in your account.
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          To keep them, stay signed in and reconnect until the sessions finish syncing.
        </p>
      </Sheet>
    </div>
  );
}
