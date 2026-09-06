"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
export function PwaManager() {
  const pathname = usePathname();
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [update, setUpdate] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.matchMedia("(display-mode: standalone)").matches);
    const onInstall = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent); };
    window.addEventListener("beforeinstallprompt", onInstall);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then(reg => {
        setUpdate(Boolean(reg.waiting));
        reg.addEventListener("updatefound", () => reg.installing?.addEventListener("statechange", () => setUpdate(Boolean(reg.waiting))));
      }).catch(() => {});
    }
    return () => window.removeEventListener("beforeinstallprompt", onInstall);
  }, []);
  // No forced activation or reload. Waiting workers activate only after all old tabs close.
  const show = pathname === "/home" || pathname === "/me";
  if (!show || (!install && !update && !ios)) return null;
  return <aside className="mx-auto max-w-3xl border-b bg-blue-50 p-3 text-sm text-blue-900">
    {install && <button className="min-h-11 rounded-xl bg-blue-700 px-4 font-bold text-white" onClick={async () => { await install.prompt(); await install.userChoice; setInstall(null); }}>Install app</button>}
    {ios && <p>Install on iPhone: tap Share in Safari, then Add to Home Screen.</p>}
    {update && <p>An app update is ready. After finishing your session, close all app tabs and reopen to apply it.</p>}
  </aside>;
}
