"use client";

import { useSyncExternalStore } from "react";
import { Download, RefreshCw, Smartphone } from "lucide-react";
import {
  getInstallState,
  getServerInstallState,
  resolveAppStatus,
  setInstallState,
  subscribeInstallState,
  type AppStatus,
} from "@/components/pwa/install-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { typography } from "@/components/ui/variants";
import { cn } from "@/lib/utils";
import type { BadgeTone } from "@/components/ui/variants";

/** State is described in the student's terms; nothing technical leaks through. */
const COPY: Record<AppStatus, { label: string; tone: BadgeTone; detail: string }> = {
  installed: {
    label: "Installed",
    tone: "success",
    detail: "You're using MASTER@DE'GENIUS as an app. It opens from your home screen and works offline.",
  },
  "update-ready": {
    label: "Update ready",
    tone: "warning",
    detail: "A new version is downloaded and waiting. Close every MASTER@DE'GENIUS tab and reopen to apply it — an exam in progress is never interrupted.",
  },
  installable: {
    label: "Not installed",
    tone: "brand",
    detail: "Add MASTER@DE'GENIUS to your home screen for faster access and offline practice.",
  },
  "ios-guidance": {
    label: "Not installed",
    tone: "brand",
    detail: "On iPhone: tap Share in Safari, then Add to Home Screen.",
  },
  unavailable: {
    label: "Up to date",
    tone: "neutral",
    detail: "You're on the latest version. This browser has not offered installation — it may already be installed, or it may not support it.",
  },
};

/**
 * The deliberate way back to installation once the Home banner has been
 * dismissed, and the honest answer to "am I on the latest version?".
 *
 * It reads the state `PwaManager` captured rather than listening for
 * `beforeinstallprompt` itself, so an Install button appears only when the
 * browser has genuinely offered one — never as a guess about the platform.
 */
export function AppStatusRow() {
  const state = useSyncExternalStore(subscribeInstallState, getInstallState, getServerInstallState);
  const status = resolveAppStatus(state);
  const { label, tone, detail } = COPY[status];
  const Icon = status === "update-ready" ? RefreshCw : status === "installed" ? Smartphone : Download;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-500" />
          <h2 className={typography.h2}>App</h2>
          {/* The badge repeats a word, never a colour on its own. */}
          <Badge tone={tone} dot>{label}</Badge>
        </div>
        {status === "installable" && state.install ? (
          <Button
            type="button"
            variant="dark"
            size="md"
            onClick={async () => {
              const event = state.install;
              if (!event) return;
              await event.prompt();
              await event.userChoice;
              setInstallState({ install: null });
            }}
            iconBefore={<Download className="h-4 w-4" aria-hidden="true" />}
          >
            Install app
          </Button>
        ) : null}
      </div>
      <p className={cn("mt-2.5 text-xs leading-[1.6] text-slate-600")}>{detail}</p>
    </section>
  );
}
