"use client";

import { useEffect, useRef, useState } from "react";
import { Cloud, CloudOff, LoaderCircle, RefreshCw, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { BadgeTone } from "@/components/ui/variants";
import type { PracticeSaveState } from "@/features/practice/types";

export type SaveState = PracticeSaveState;

interface Presentation {
  /** Coarse state used to decide what is worth announcing. */
  band: "synced" | "working" | "device" | "offline";
  label: string;
  tone: BadgeTone;
  Icon: typeof Cloud;
}

/**
 * One mapping from engine state to what a student sees, shared by both runners
 * so "Saved" never means two different things in two places.
 *
 * Three words carry the whole story mid-exam — Saving…, Saved, Reconnecting… —
 * because a student in the middle of a paper needs reassurance, not a report on
 * the sync queue. Device-local storage is named in exactly one situation: when
 * the connection is genuinely down and it is the true and useful thing to say.
 * An answer that has reached this device but not yet the server is still on its
 * way, so it reads as "Saving…" — the band underneath keeps the retry
 * affordance, which is what the student can actually act on.
 *
 * Being offline outranks the save state: an answer written to the device while
 * the connection is down is not "Saved" in the sense a student would read it.
 */
export function presentSaveState(state: SaveState, online: boolean): Presentation {
  if (!online) {
    return { band: "offline", label: "Offline · saved on device", tone: "warning", Icon: WifiOff };
  }
  if (state === "saving") return { band: "working", label: "Saving…", tone: "neutral", Icon: LoaderCircle };
  if (state === "syncing") return { band: "working", label: "Reconnecting…", tone: "neutral", Icon: RefreshCw };
  if (state === "saved_local") return { band: "device", label: "Saving…", tone: "neutral", Icon: CloudOff };
  return { band: "synced", label: "Saved", tone: "success", Icon: Cloud };
}

/** What a screen reader is told when a band is entered. Silence means "not worth it". */
const ANNOUNCEMENT: Record<Presentation["band"], string | null> = {
  offline: "You are offline. Answers are saved on this device and will sync when you reconnect.",
  device: "Your answers are still saving.",
  synced: "Answers saved.",
  // Saving and syncing fire on every keystroke-equivalent; announcing them
  // would talk over the question the student is trying to read.
  working: null,
};

export interface SessionStatusProps {
  state: SaveState;
  online: boolean;
  /** Retry handler for a device-only save. Omitted where retrying is not offered. */
  onRetry?: () => void;
  /** Renders for a dark header instead of a light surface. */
  inverse?: boolean;
}

/**
 * The save/connectivity chip, plus a live region that speaks only on
 * transitions that change what the student should do.
 *
 * The chip itself is not a live region: autosave flips saved → saving → saved
 * on every answer, and announcing each one would make the runner unusable with
 * a screen reader. Only crossing into or out of offline / device-only / synced
 * is announced, and never the first render.
 */
export function SessionStatus({ state, online, onRetry, inverse = false }: SessionStatusProps) {
  const { band, label, tone, Icon } = presentSaveState(state, online);
  const [announcement, setAnnouncement] = useState("");
  const previousBand = useRef<Presentation["band"] | null>(null);

  useEffect(() => {
    const previous = previousBand.current;
    previousBand.current = band;
    // Nothing to announce about a state the student arrived in.
    if (previous === null || previous === band) return;
    setAnnouncement(ANNOUNCEMENT[band] ?? "");
  }, [band]);

  const spinning = state === "saving" || state === "syncing";
  const icon = <Icon className={`h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`} aria-hidden="true" />;

  /*
   * On the exam's ink header the chip is tinted rather than bordered, so it
   * reads at a glance without competing with the timer beside it.
   */
  const chip = inverse ? (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold ${
        band === "synced" ? "bg-success-600/25 text-success-300" : "bg-white/10 text-white/80"
      }`}
    >
      {icon}
      {label}
    </span>
  ) : (
    <Badge tone={tone} icon={icon}>{label}</Badge>
  );

  return (
    <>
      {band === "device" && onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          <span className="sr-only">Retry syncing answers saved on this device</span>
          <span aria-hidden="true">{chip}</span>
        </button>
      ) : (
        chip
      )}
      <span aria-live="polite" className="sr-only">{announcement}</span>
    </>
  );
}
