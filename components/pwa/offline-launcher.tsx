"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { listRecords, readOwner, clearDevice } from "@/features/offline/storage";
import type { OfflineRecord } from "@/features/offline/types";
import { ExamAttemptRunner } from "@/components/exam/exam-attempt-runner";
import { PracticeSessionRunner } from "@/components/practice/practice-session-runner";
import type { ExamAttemptView } from "@/features/exams/types";
import type { PracticeSessionView } from "@/features/practice/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { typography } from "@/components/ui/variants";
import { cn } from "@/lib/utils";

const inlineLink =
  "inline-flex min-h-12 items-center gap-1.5 rounded text-sm font-bold text-brand-600 hover:text-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2";

export function OfflineLauncher() {
  const [records, setRecords] = useState<OfflineRecord[]>([]);
  const [active, setActive] = useState<OfflineRecord | null>(null);
  const [message, setMessage] = useState("Loading saved sessions…");
  const [clearOpen, setClearOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      const owner = await readOwner();
      const saved = owner ? (await listRecords()).filter(r => r.userId === owner && r.version === 1) : [];
      setRecords(saved); setMessage(saved.length ? "Resume a session saved on this device." : "No sessions are saved on this device. Connect to the internet to start one.");
    })().catch(() => setMessage("This browser could not open device storage. Reconnect to continue online."));
  }, []);

  if (active) return active.kind === "exam"
    ? <ExamAttemptRunner key={active.key} initialAttempt={active.view as ExamAttemptView} recovered />
    : <div className="min-h-dvh bg-slate-50 p-4"><PracticeSessionRunner key={active.key} initialSession={active.view as PracticeSessionView} recovered /></div>;

  const unsyncedTotal = records.reduce((total, record) => total + Object.keys(record.pending).length, 0);

  /** The existing sequence, unchanged: clear the store, drop cached media, reflect it. */
  const clearSavedData = async () => {
    await clearDevice();
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_MEDIA" });
    setRecords([]);
    setMessage("Saved sessions removed from this device.");
    setClearOpen(false);
  };

  return (
    <main className="mx-auto max-w-xl space-y-5 p-5 pt-12">
      <p className={cn(typography.eyebrow, "text-brand-600")}>MASTER@DE&apos;GENIUS</p>
      <h1 className={typography.h1}>Your saved sessions</h1>
      <p role="status" className="text-sm leading-6 text-slate-600">{message}</p>

      {records.map(r => {
        const pending = Object.keys(r.pending).length;
        return (
          <section key={r.key} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className={typography.h2}>
              {r.kind === "exam" ? (r.view as ExamAttemptView).examName + " Mock" : (r.view as PracticeSessionView).subjectName + " Practice"}
            </h2>
            <Badge tone={pending > 0 ? "warning" : "neutral"} dot>
              {pending} {pending === 1 ? "change" : "changes"} not yet confirmed by the server
            </Badge>
            {r.final ? (
              <p className="text-sm text-slate-600">This session has ended. Reconnect to see the server result.</p>
            ) : (
              <Button type="button" variant="primary" size="lg" onClick={() => setActive(r)}>
                Resume saved session
              </Button>
            )}
            <a href={r.kind === "exam" ? `/exam/${r.id}` : `/practice/session/${r.id}`} className={cn(inlineLink, "block")}>
              Open online <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </section>
        );
      })}

      <a href="/home" className={inlineLink}>Try online Home →</a>

      {records.length > 0 ? (
        <Button type="button" variant="ghost" size="lg" className="block text-slate-600" onClick={() => setClearOpen(true)}>
          Remove saved data from this device
        </Button>
      ) : null}

      <p className="text-xs leading-5 text-slate-500">
        Anyone using this browser can access its saved sessions. Sign out or remove saved data before sharing this
        device. Timed sessions keep running while the app is closed; late answers cannot count towards the score.
      </p>

      {/*
        Replaces the last native confirm. The copy names exactly what leaves this
        device and states plainly that the server keeps everything it already
        has — `clearDevice` empties IndexedDB and the media cache, and touches no
        server record.
      */}
      <Sheet
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="Remove saved data from this device?"
        description="This cannot be undone."
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" size="lg" onClick={() => setClearOpen(false)}>
              Keep saved data
            </Button>
            <Button type="button" variant="danger" size="lg" onClick={() => void clearSavedData()}>
              Remove from this device
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-6 text-slate-600">
          This browser is holding {records.length} saved {records.length === 1 ? "session" : "sessions"} and the
          question images cached for them.
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {unsyncedTotal > 0 ? (
            <>
              <strong className="font-bold text-slate-900">
                {unsyncedTotal} {unsyncedTotal === 1 ? "answer has" : "answers have"} not reached the server yet
              </strong>{" "}
              and will be lost.
            </>
          ) : (
            "Every answer here has already reached the server, so nothing will be lost."
          )}
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Nothing is deleted from your account. Your attempts, results and mistake bank stay exactly as they are, and
          you can reopen any session online.
        </p>
      </Sheet>
    </main>
  );
}
