"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Sheet } from "@/components/ui/sheet";
import { buttonClasses } from "@/components/ui/variants";

interface SyncNoticeProps {
  ready: boolean;
  error: string;
  code: string;
  online: boolean;
  expired: boolean;
  /**
   * Set by a screen that already shows its own offline banner, so a
   * disconnected student is told once rather than three times over. The screen
   * taking this on has to carry the whole message — see the exam runner, which
   * states the retry behaviour, the deadline and the uncached images itself.
   */
  offlineHandled?: boolean;
  onConflict: () => void;
  onStorageRetry: () => void;
}

export function SyncNotice({ ready, error, code, online, expired, offlineHandled = false, onConflict, onStorageRetry }: SyncNoticeProps) {
  /*
   * A revision conflict is a high-stakes, irreversible choice, so it gets a
   * modal rather than a paragraph the student can scroll past. Dismissing it
   * resolves nothing: the notice below stays, and reopening is one tap away.
   * There is still exactly one action, and it is still `onConflict` — no merge
   * behaviour is invented here, and nothing resolves on its own.
   */
  const conflicted = code === "CONFLICT";
  const [conflictDismissed, setConflictDismissed] = useState(false);

  useEffect(() => {
    if (!conflicted) setConflictDismissed(false);
  }, [conflicted]);

  return (
    <div className="space-y-2 px-4 py-2 text-[13px] leading-[1.6] empty:hidden" aria-live="polite">
      {!ready ? (
        <InlineAlert tone="warning" role="status">
          {error || "Opening secure device storage. If this session is open in another tab, close that tab to continue here."}
        </InlineAlert>
      ) : null}

      {!online && !offlineHandled ? (
        <InlineAlert tone="warning" role="status">
          Offline · Saved answers will retry when you reconnect. For timed sessions, answers must reach the server before
          the deadline. Explanations and uncached images need a connection.
        </InlineAlert>
      ) : null}

      {expired ? (
        <InlineAlert tone="brand" role="status">
          Time is up. Reconnect to finish submission. Local changes received after the deadline cannot count towards your
          score.
        </InlineAlert>
      ) : null}

      {ready && error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      {code === "STORAGE" ? (
        <Button type="button" variant="dark" size="lg" onClick={onStorageRetry}>
          Retry device storage
        </Button>
      ) : null}

      {conflicted ? (
        <>
          <InlineAlert tone="warning" role="status">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              Another device saved a newer answer. Your local changes are preserved.
              <Button type="button" variant="dark" size="sm" onClick={() => setConflictDismissed(false)}>
                Choose what to keep
              </Button>
            </span>
          </InlineAlert>

          <Sheet
            open={!conflictDismissed}
            onClose={() => setConflictDismissed(true)}
            title="Another device saved a newer answer"
            description="Your changes on this device are preserved either way."
            footer={
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="secondary" size="lg" onClick={() => setConflictDismissed(true)}>
                  Decide later
                </Button>
                <Button type="button" variant="dark" size="lg" onClick={onConflict}>
                  Keep this device&apos;s changes
                </Button>
              </div>
            }
          >
            <p className="text-[13px] leading-[1.6] text-slate-600">
              This session was also open somewhere else, and that device saved an answer after yours.
            </p>
            <p className="mt-2.5 text-[13px] leading-[1.6] text-slate-600">
              Continuing will intentionally replace those server answers with the choices made on this device. Nothing
              changes until you choose.
            </p>
          </Sheet>
        </>
      ) : null}

      {code === "AUTH" ? (
        <a
          href="/login"
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClasses({ variant: "secondary", size: "lg" })}
        >
          Sign in in a new tab, then return here
        </a>
      ) : null}
    </div>
  );
}
