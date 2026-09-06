"use client";
export default function ProgressError({ reset }: { reset: () => void }) {
  return <div className="mx-auto max-w-xl rounded-2xl border bg-white p-6"><h1 className="text-xl font-bold">Your results could not be loaded.</h1><p className="mt-2 text-sm text-slate-600">Your saved attempts are unchanged. Please try again.</p><button onClick={reset} className="mt-4 min-h-12 rounded-xl bg-blue-700 px-5 font-bold text-white">Try again</button></div>;
}
