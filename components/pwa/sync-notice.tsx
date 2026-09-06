"use client";
export function SyncNotice({ ready, error, code, online, expired, onConflict, onStorageRetry }: { ready: boolean; error: string; code: string; online: boolean; expired: boolean; onConflict: () => void; onStorageRetry: () => void }) {
  return <div className="space-y-2 px-4 py-2 text-sm leading-6" aria-live="polite">
    {!ready && <p className="rounded-xl bg-amber-50 p-3 text-amber-900">{error || "Opening secure device storage. If this session is open in another tab, close that tab to continue here."}</p>}
    {!online && <p className="rounded-xl bg-amber-50 p-3 text-amber-900">Offline · Saved answers will retry when you reconnect. For timed sessions, answers must reach the server before the deadline. Explanations and uncached images need a connection.</p>}
    {expired && <p className="rounded-xl bg-blue-50 p-3 text-blue-900">Time is up. Reconnect to finish submission. Local changes received after the deadline cannot count towards your score.</p>}
    {ready && error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
    {code === "STORAGE" && <button type="button" onClick={onStorageRetry} className="min-h-12 rounded-xl bg-slate-950 px-4 font-bold text-white">Retry device storage</button>}
    {code === "CONFLICT" && <div className="rounded-xl border border-amber-300 bg-white p-3"><p>Another device saved a newer answer. Your local changes are preserved. Continuing will intentionally replace those server answers with this device’s choices.</p><button type="button" onClick={onConflict} className="mt-2 min-h-12 rounded-xl bg-slate-950 px-4 font-bold text-white">Keep this device’s changes</button></div>}
    {code === "AUTH" && <a href="/login" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center font-bold text-blue-700">Sign in in a new tab, then return here</a>}
  </div>;
}
