"use client";
import { useEffect, useState } from "react";
import { listRecords, readOwner, clearDevice } from "@/features/offline/storage";
import type { OfflineRecord } from "@/features/offline/types";
import { ExamAttemptRunner } from "@/components/exam/exam-attempt-runner";
import { PracticeSessionRunner } from "@/components/practice/practice-session-runner";
import type { ExamAttemptView } from "@/features/exams/types";
import type { PracticeSessionView } from "@/features/practice/types";
export function OfflineLauncher() {
  const [records, setRecords] = useState<OfflineRecord[]>([]);
  const [active, setActive] = useState<OfflineRecord | null>(null);
  const [message, setMessage] = useState("Loading saved sessions…");
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
  return <main className="mx-auto max-w-xl space-y-5 p-5 pt-12">
    <p className="text-xs font-bold uppercase tracking-widest text-blue-700">MASTER@DE&apos;GENIUS</p><h1 className="text-3xl font-black">Your saved sessions</h1>
    <p role="status" className="text-sm leading-6 text-slate-600">{message}</p>
    {records.map(r => <section key={r.key} className="space-y-3 rounded-2xl border bg-white p-5"><h2 className="font-bold">{r.kind === "exam" ? (r.view as ExamAttemptView).examName + " Mock" : (r.view as PracticeSessionView).subjectName + " Practice"}</h2><p className="text-sm text-slate-600">{Object.keys(r.pending).length} changes not yet confirmed by the server</p>{r.final ? <p className="text-sm">This session has ended. Reconnect to see the server result.</p> : <button onClick={() => setActive(r)} className="min-h-12 rounded-xl bg-blue-700 px-5 font-bold text-white">Resume saved session</button>}<a href={r.kind === "exam" ? `/exam/${r.id}` : `/practice/session/${r.id}`} className="block py-3 text-sm font-bold text-blue-700">Open online</a></section>)}
    <a href="/home" className="inline-flex min-h-12 items-center font-bold text-blue-700">Try online Home →</a>
    {records.length > 0 && <button className="block min-h-12 text-sm text-slate-600" onClick={async () => { if (!window.confirm("Delete this device’s saved sessions and unsynced answers? This cannot be undone.")) return; await clearDevice(); navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_MEDIA" }); setRecords([]); setMessage("Saved sessions removed from this device."); }}>Remove saved data from this device</button>}
    <p className="text-xs leading-5 text-slate-500">Anyone using this browser can access its saved sessions. Sign out or remove saved data before sharing this device. Timed sessions keep running while the app is closed; late answers cannot count towards the score.</p>
  </main>;
}
