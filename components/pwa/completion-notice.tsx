"use client";
import { useEffect, useState } from "react";
import { readRecord, writeRecord } from "@/features/offline/storage";
import { recordKey, type SessionKind } from "@/features/offline/types";
export function CompletionNotice({ userId, kind, id }: { userId: string; kind: SessionKind; id: string }) {
  const [pending, setPending] = useState(0);
  useEffect(() => { void (async () => {
    const record = await readRecord(recordKey(userId, kind, id)); if (!record) return;
    setPending(Object.keys(record.pending).length); record.final = true; await writeRecord(record);
  })().catch(() => {}); }, [userId, kind, id]);
  return pending > 0 ? <p role="status" className="rounded-xl bg-warning-50 p-4 text-sm text-warning-900">This device has {pending} local changes that were not confirmed before completion. This result uses the server’s saved answers. The local copy is retained in Saved sessions.</p> : null;
}
