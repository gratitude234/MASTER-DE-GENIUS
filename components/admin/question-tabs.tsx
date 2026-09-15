import Link from "next/link";
import { cn } from "@/lib/utils";

export function QuestionTabs({ current }: { current: "internal" | "external" }) {
  const tab = (active: boolean) => cn("border-b-2 px-1 pb-2 text-[13px] font-semibold", active ? "border-slate-950 text-slate-950" : "border-transparent text-slate-500 hover:text-slate-800");
  return (
    <nav aria-label="Question sources" className="mb-4 flex gap-5 border-b border-slate-200">
      <Link href="/admin/questions" aria-current={current === "internal" ? "page" : undefined} className={tab(current === "internal")}>Internal bank</Link>
      <Link href="/admin/questions/external" aria-current={current === "external" ? "page" : undefined} className={tab(current === "external")}>External questions & blocklist</Link>
    </nav>
  );
}
