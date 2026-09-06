import { checkAutomaticExpiry } from "@/features/offline/server";
import { NextResponse } from "next/server";

import { examErrorResponse, requireExamApiUser } from "@/features/exams/api";
import { submitExamAttemptForUser } from "@/features/exams/service";
import type { ExamSubmissionReason } from "@/features/exams/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  const user = await requireExamApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { attemptId } = await params;
  try {
    let reason: ExamSubmissionReason = "manual";
    try {
      const body = await request.json() as { reason?: unknown };
      if (body.reason === "time_expired") reason = "time_expired";
    } catch {
      // Empty body is valid for a manual submission.
    }

    if (reason === "time_expired") {
      const serverNow = await checkAutomaticExpiry(user.id, "exam", attemptId);
      if (serverNow !== null) return NextResponse.json({ error: "Timer corrected using server time. Continue your exam.", code: "CLOCK_RESYNC", serverNow }, { status: 409 });
    }
    const result = await submitExamAttemptForUser(user.id, attemptId, reason);
    return NextResponse.json(result);
  } catch (error) {
    return examErrorResponse(error);
  }
}
