"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { DurableQueue, SyncFailure, type Ack } from "./queue";
import { SessionClock, resumedTime } from "./clock";
import { claimOwner, readOwner, readRecord, writeRecord } from "./storage";
import { recordKey, type OfflineRecord, type Selection, type SessionKind, type SavedSelection } from "./types";
import type { ExamAttemptView } from "@/features/exams/types";
import type { PracticeSessionView } from "@/features/practice/types";

export function initialSelections(view: ExamAttemptView | PracticeSessionView) {
  const map: Record<string, SavedSelection> = {};
  if ("subjects" in view) for (const s of view.subjects) for (const q of s.questions) map[q.id] = { selectedOptionKey: q.selectedOptionKey ?? null, isFlagged: q.isFlagged, revision: q.revision };
  else for (const q of view.questions) map[q.id] = { selectedOptionKey: q.selectedOptionKey ?? null, isFlagged: false, revision: q.revision, feedback: q.feedback ?? undefined };
  return map;
}
async function requestJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(12000) });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new SyncFailure(typeof data.error === "string" ? data.error : "Could not sync. Reconnect and retry.", typeof data.code === "string" ? data.code : response.status === 401 ? "AUTH" : "RETRY", typeof data.serverNow === "number" ? data.serverNow : undefined);
  return data;
}
export function useOfflineSession(kind: SessionKind, view: ExamAttemptView | PracticeSessionView, recovered = false) {
  const key = recordKey(view.userId, kind, view.id);
  const [answers, setAnswers] = useState(() => initialSelections(view));
  const [state, setState] = useState<"saving" | "saved" | "saved_local" | "syncing">("saving");
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [cursor, setCursorState] = useState({ subject: 0, question: 0 });
  const [secondsLeft, setSecondsLeft] = useState<number | null>(view.expiresAt ? Math.max(0, Math.ceil((Date.parse(view.expiresAt) - view.serverNow) / 1000)) : null);
  const queue = useRef<DurableQueue | null>(null);
  const clock = useRef<SessionClock | null>(null);
  const finalising = useRef(false);
  const [finishing, setFinishing] = useState(false);
  const [receipt, setReceipt] = useState<Record<string, unknown> | null>(null);
  const refresh = useCallback(() => {
    const q = queue.current;
    if (!q) return;
    setAnswers(structuredClone(q.record.answers)); setCursorState({ ...q.record.cursor });
    setPendingCount(Object.keys(q.record.pending).length);
    setError(q.error); setCode(q.code);
  }, []);
  const flush = useCallback(async () => {
    const q = queue.current;
    if (!q || !navigator.onLine) return false;
    setState("syncing");
    const okay = await q.flush(); refresh();
    setState(okay ? "saved" : "saved_local"); return okay;
  }, [refresh]);
  useEffect(() => {
    let disposed = false;
    let release: (() => void) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const controller = new AbortController();
    async function initialise() {
      if (recovered) {
        if (await readOwner() !== view.userId) throw new Error("Sign in again to resume this session.");
      } else await claimOwner(view.userId);
      const saved = await readRecord(key);
      if (disposed) return;
      const record: OfflineRecord = saved ?? { key, version: 1, userId: view.userId, kind, id: view.id, view,
        answers: initialSelections(view), pending: {}, cursor: { subject: 0, question: 0 },
        serverTime: view.serverNow, wallTime: Date.now(), final: false };
      if (record.version !== 1 || record.final) throw new Error("This saved session is finished. Reconnect to view its result.");
      if (!saved && !recovered) {
        const legacyKey = kind === "exam" ? `mdg:exam:${view.id}:pending` : `mdg:practice:${view.id}`;
        try {
          const legacy = JSON.parse(localStorage.getItem(legacyKey) ?? "{}");
          for (const [id, value] of Object.entries(legacy)) {
            const answer = record.answers[id]; if (!answer || answer.feedback) continue;
            const old = kind === "exam" ? value as Selection : { selectedOptionKey: value, isFlagged: false };
            if (!old || (old.selectedOptionKey !== null && !["A", "B", "C", "D", "E"].includes(String(old.selectedOptionKey))) || typeof old.isFlagged !== "boolean") continue;
            const selected = old as Selection;
            if (answer.selectedOptionKey === selected.selectedOptionKey && answer.isFlagged === selected.isFlagged) continue;
            record.pending[id] = { ...selected, mutationId: crypto.randomUUID(), expectedRevision: answer.revision };
            record.answers[id] = { ...answer, ...selected };
          }
        } catch { /* Leave an unreadable legacy backup untouched. */ }
      }
      if (!recovered) {
        const authoritative = initialSelections(view);
        for (const [id, value] of Object.entries(authoritative)) if (!record.pending[id]) record.answers[id] = value;
        record.view = view;
      }
      clock.current = new SessionClock(recovered ? resumedTime(record.serverTime, record.wallTime) : view.serverNow);
      await writeRecord(record);
      if (!recovered) { try { localStorage.removeItem(kind === "exam" ? `mdg:exam:${view.id}:pending` : `mdg:practice:${view.id}`); } catch { /* IndexedDB already committed. */ } }
      if (disposed) return;
      const q = new DurableQueue(record, writeRecord, async (questionId, pending) => {
        const url = kind === "exam" ? `/api/exam/attempts/${view.id}/response` : `/api/practice/sessions/${view.id}/answers`;
        const payload = await requestJson(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          ...(kind === "exam" ? { attemptQuestionId: questionId } : { sessionQuestionId: questionId }), ...pending,
        }) });
        if (typeof payload.serverNow === "number") clock.current?.sync(payload.serverNow);
        return payload as unknown as Ack;
      }, refresh);
      queue.current = q;
      const questions = "subjects" in view ? view.subjects.flatMap(s => s.questions) : view.questions;
      navigator.serviceWorker?.ready.then(reg => { if (!disposed) reg.active?.postMessage({ type: "SAVE_MEDIA", urls: questions.flatMap(q => q.question.assets.map(a => a.url)) }); }).catch(() => {});
      refresh(); setReady(true); setState(Object.keys(record.pending).length ? "saved_local" : "saved");
      if (navigator.onLine) void flush();
      heartbeat = setInterval(() => {
        if (disposed || finalising.current || q.record.final) return;
        record.serverTime = clock.current!.now(); record.wallTime = Date.now();
        void q.checkpoint().catch(() => { setError("Device storage is unavailable. Keep this screen open."); setCode("STORAGE"); setReady(false); });
        if (navigator.onLine && Object.keys(record.pending).length) void flush();
      }, 10000);
    }
    setOnline(navigator.onLine);
    // Keep one editor open per session. No unsafe fallback if the browser lacks Web Locks.
    if (!navigator.locks) { setError("This browser cannot safely coordinate saved sessions. Use a current browser."); return; }
    void navigator.locks.request(`mdg:${key}`, { mode: "exclusive", signal: controller.signal }, async lock => {
      if (!lock) { setError("This session is open in another tab. Close that tab, then reload here."); setCode("TAB"); return; }
      try { await initialise(); if (!disposed) await new Promise<void>(resolve => { release = resolve; }); }
      catch (e) { if (!disposed) { setError(e instanceof Error ? e.message : "Device storage unavailable."); setCode("STORAGE"); } }
    }).catch(() => {});
    const onOnline = () => { setOnline(true); void flush(); };
    const onOffline = () => { setOnline(false); };
    const onVisible = () => { if (document.visibilityState === "visible" && navigator.onLine) {
      void requestJson("/api/time").then(p => { if (typeof p.serverNow === "number") clock.current?.sync(p.serverNow); }).catch(() => {});
      void flush();
    } };
    const channel = new BroadcastChannel("mdg-session");
    channel.onmessage = () => { queue.current?.stop(); setReady(false); setError("You signed out or changed account. Reconnect and reopen this session."); };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (!queue.current?.record.final) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("online", onOnline); window.addEventListener("offline", onOffline); window.addEventListener("beforeunload", beforeUnload); document.addEventListener("visibilitychange", onVisible);
    return () => { channel.close(); disposed = true; controller.abort(); release?.(); if (heartbeat) clearInterval(heartbeat); queue.current?.stop(); queue.current = null;
      window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("visibilitychange", onVisible); };
  }, [key, kind, view, recovered, refresh, flush]);
  useEffect(() => {
    if (!ready || !view.expiresAt) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((Date.parse(view.expiresAt!) - (clock.current?.now() ?? view.serverNow)) / 1000)));
    tick(); const timer = setInterval(tick, 500); return () => clearInterval(timer);
  }, [ready, view]);
  const select = useCallback(async (id: string, selection: Selection) => {
    if (!ready || finalising.current || secondsLeft === 0 || !queue.current) return;
    setState("saving");
    try { await queue.current.select(id, selection); setState("saved_local"); if (navigator.onLine) void flush(); }
    catch { setReady(false); refresh(); }
  }, [ready, secondsLeft, flush, refresh]);
  const setCursor = useCallback((next: { subject: number; question: number }) => {
    const q = queue.current; if (!q) return;
    q.record.cursor = next; setCursorState(next);
    void q.checkpoint().catch(() => setError("Could not save your position on this device."));
  }, []);
  const finish = useCallback(async (expired = false) => {
    const q = queue.current;
    if (!q || finalising.current || q.record.final || !ready) return;
    finalising.current = true; setFinishing(true); setError("");
    try {
      await q.ready();
      if (!navigator.onLine) throw new Error("Reconnect to submit. Your saved changes remain on this device.");
      const synced = await flush();
      if (!synced && !expired) throw new Error("Submission is waiting for your answers to sync. Resolve any sync error, then retry.");
      const url = kind === "exam" ? `/api/exam/attempts/${view.id}/submit` : `/api/practice/sessions/${view.id}/complete`;
      const payload = await requestJson(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: expired ? "time_expired" : "manual" }) });
      // Keep unconfirmed changes for an explicit notice, never silently erase them.
      await q.finish(); setReceipt(payload); setState(Object.keys(q.record.pending).length ? "saved_local" : "saved"); refresh();
    } catch (e) {
      if (e instanceof SyncFailure && e.code === "CLOCK_RESYNC" && e.serverNow) clock.current?.sync(e.serverNow);
      setError(e instanceof Error ? e.message : "Submission failed. Please retry.");
    }
    finally { finalising.current = false; setFinishing(false); }
  }, [ready, kind, view.id, flush, refresh]);
  useEffect(() => {
    if (secondsLeft !== 0 || !ready || receipt) return;
    void finish(true);
    const retry = setInterval(() => { if (navigator.onLine) void finish(true); }, 10000);
    return () => clearInterval(retry);
  }, [secondsLeft, ready, receipt, finish]);
  const resolveConflict = useCallback(async () => {
    const q = queue.current; if (!q) return;
    try {
      const response = await requestJson(`/api/offline/session/${kind}/${view.id}`);
      const latest = response.view as ExamAttemptView | PracticeSessionView;
      if (latest.status !== "in_progress") throw new Error("This session has ended. Open its results when online.");
      const authoritative = initialSelections(latest);
      for (const [id, p] of Object.entries(q.record.pending)) { p.expectedRevision = authoritative[id].revision; p.mutationId = crypto.randomUUID(); }
      q.error = ""; q.code = ""; await q.checkpoint(); await flush();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not resolve conflict."); }
  }, [kind, view.id, flush]);
  const retryStorage = useCallback(async () => {
    const q = queue.current;
    if (!q) { window.location.reload(); return; }
    try { await q.retryStorage(); setReady(true); setState("saved_local"); refresh(); if (navigator.onLine) void flush(); }
    catch { refresh(); }
  }, [refresh, flush]);
  return { retryStorage, answers, ready, state, online, error, code, secondsLeft, select, cursor, setCursor, flush, finish, finishing, receipt, pendingCount, resolveConflict };
}
