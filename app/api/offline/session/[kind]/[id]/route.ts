import { NextResponse } from "next/server";
import { requireExamApiUser } from "@/features/exams/api";
import { loadExamAttemptForUser } from "@/features/exams/service";
import { loadPracticeSessionForUser } from "@/features/practice/service";
export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const user = await requireExamApiUser();
  if (!user) return NextResponse.json({ error: "Sign in again to sync.", code: "AUTH" }, { status: 401 });
  const { kind, id } = await params;
  if (kind !== "exam" && kind !== "practice") return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    const view = kind === "exam" ? await loadExamAttemptForUser(user.id, id) : await loadPracticeSessionForUser(user.id, id);
    if (!view) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ view }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Could not load saved session." }, { status: 503 }); }
}
