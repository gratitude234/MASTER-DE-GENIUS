"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Download, X } from "lucide-react";
import { listRecords } from "@/features/offline/storage";
import {
  DISMISS_KEY,
  getInstallState,
  getServerInstallState,
  resolveAppStatus,
  setInstallState,
  subscribeInstallState,
  type InstallEvent,
} from "@/components/pwa/install-state";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";

export function PwaManager() {
  const pathname = usePathname();
  const state = useSyncExternalStore(subscribeInstallState, getInstallState, getServerInstallState);
  const [dismissed, setDismissed] = useState(true);
  const [usedProduct, setUsedProduct] = useState<boolean | null>(null);

  useEffect(() => {
    setInstallState({
      iosGuidance: /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.matchMedia("(display-mode: standalone)").matches,
      standalone: window.matchMedia("(display-mode: standalone)").matches,
    });

    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }

    const onInstall = (event: Event) => { event.preventDefault(); setInstallState({ install: event as InstallEvent }); };
    window.addEventListener("beforeinstallprompt", onInstall);

    // Registration, scope, updateViaCache and the update-detection wiring are
    // unchanged: this component still never activates a waiting worker.
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then(reg => {
        setInstallState({ updateReady: Boolean(reg.waiting) });
        reg.addEventListener("updatefound", () => reg.installing?.addEventListener("statechange", () => setInstallState({ updateReady: Boolean(reg.waiting) })));
      }).catch(() => {});
    }

    return () => window.removeEventListener("beforeinstallprompt", onInstall);
  }, []);

  const onHome = pathname === "/home";

  /*
   * Install guidance used to appear on Home the moment onboarding finished,
   * before the student had any reason to want the app on their home screen.
   *
   * It now waits for a session to exist on this device. That is the engine's
   * own record of a started session — read-only, already persisted, and never
   * deleted — so no new tracking or storage is introduced for this. The read
   * happens once, and only on Home, so it never runs during an exam.
   */
  useEffect(() => {
    if (!onHome || usedProduct !== null) return;
    let cancelled = false;
    void listRecords()
      .then(records => { if (!cancelled) setUsedProduct(records.length > 0); })
      .catch(() => { if (!cancelled) setUsedProduct(false); });
    return () => { cancelled = true; };
  }, [onHome, usedProduct]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* Private mode: dismissal lasts this session. */ }
  }, []);

  const status = resolveAppStatus(state);
  const worthShowing = status === "installable" || status === "ios-guidance" || status === "update-ready";
  if (!onHome || dismissed || usedProduct !== true || !worthShowing) return null;

  return (
    // A passive notice: `role="status"`, no focus management, nothing autofocused.
    <aside aria-label="App options" className="mx-auto max-w-3xl px-4 pt-4">
      <InlineAlert tone="brand" role="status" className="items-center">
        <span className="flex flex-1 flex-wrap items-center justify-between gap-3">
          <span className="min-w-0 font-semibold">
            {status === "update-ready"
              ? "An app update is ready. Close every MASTER@DE'GENIUS tab and reopen to apply it — your session is never interrupted."
              : status === "ios-guidance"
                ? "Install on iPhone: tap Share in Safari, then Add to Home Screen."
                : "Add MASTER@DE'GENIUS to your home screen for faster access and offline practice."}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {status === "installable" && state.install ? (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={async () => {
                  const event = state.install;
                  if (!event) return;
                  await event.prompt();
                  await event.userChoice;
                  setInstallState({ install: null });
                }}
                iconBefore={<Download className="h-3.5 w-3.5" aria-hidden="true" />}
              >
                Install app
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="sm" iconOnly aria-label="Dismiss app options" onClick={dismiss}>
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </span>
        </span>
      </InlineAlert>
    </aside>
  );
}
