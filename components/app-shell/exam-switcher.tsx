"use client";
import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { switchActiveExam } from "@/features/exam-context/actions";
export function ExamSwitcher({ options, active }: { options: { code: string; label: string }[]; active: string }) {
 const pathname = usePathname(), router = useRouter();
 const [pending, startTransition] = useTransition();
 const [error, setError] = useState("");
 // Frozen sessions and historical results retain their own exam context.
 if (pathname.startsWith("/exam/") || /\/(session|attempt|results)\//.test(pathname)) return null;
 return <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3">
  <label className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">Preparing for {options.length === 1 ? <span>{options[0].label}</span> :
   <select aria-label="Active examination" disabled={pending} value={active} className="min-h-11 rounded-lg border px-3" onChange={event => {
    const code = event.target.value; setError(""); startTransition(async () => { try { await switchActiveExam(code); router.push("/home"); router.refresh(); } catch { setError("Could not switch exam. Please try again."); } });
   }}>{options.map(option => <option key={option.code} value={option.code}>{option.label}</option>)}</select>}
  </label>{error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
 </div>;
}
