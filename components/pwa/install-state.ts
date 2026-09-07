export interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

export interface InstallState {
  /** The captured `beforeinstallprompt`, or null when the browser has not offered one. */
  install: InstallEvent | null;
  /** A service worker is waiting. It activates only when every tab closes. */
  updateReady: boolean;
  /** iOS Safari, which never fires `beforeinstallprompt` and needs manual steps. */
  iosGuidance: boolean;
  /** Already running as an installed app. */
  standalone: boolean;
}

/** Local-only flag so a dismissed banner stays dismissed. Sign-out clears `mdg:` keys. */
export const DISMISS_KEY = "mdg:pwa-banner-dismissed";

const initial: InstallState = { install: null, updateReady: false, iosGuidance: false, standalone: false };
let state: InstallState = initial;
const listeners = new Set<() => void>();

/**
 * A module-scope store, not a context, because `beforeinstallprompt` fires once
 * and only the first listener that calls `preventDefault()` keeps it.
 * `PwaManager` mounts in the root layout and captures it; anything else that
 * wants to offer installation — the row in Profile — reads it from here rather
 * than racing for a second listener that would never fire.
 */
export function setInstallState(patch: Partial<InstallState>) {
  const next = { ...state, ...patch };
  if (
    next.install === state.install &&
    next.updateReady === state.updateReady &&
    next.iosGuidance === state.iosGuidance &&
    next.standalone === state.standalone
  ) {
    return;
  }
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeInstallState(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getInstallState(): InstallState {
  return state;
}

/** Nothing is known during server rendering, so nothing is claimed. */
export function getServerInstallState(): InstallState {
  return initial;
}

export type AppStatus = "installed" | "update-ready" | "installable" | "ios-guidance" | "unavailable";

/**
 * What to tell the student, in one place so the banner and the Profile row can
 * never disagree. Installation is only ever offered when the browser has
 * actually said it is possible.
 */
export function resolveAppStatus(state: InstallState): AppStatus {
  if (state.updateReady) return "update-ready";
  if (state.standalone) return "installed";
  if (state.install) return "installable";
  if (state.iosGuidance) return "ios-guidance";
  return "unavailable";
}
