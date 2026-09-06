import { parseRevision } from "@/features/offline/server";
import { NextResponse } from "next/server";

import { examErrorResponse, requireExamApiUser } from "@/features/exams/api";
import { saveExamResponseForUser, submitExamAttemptForUser } from "@/features/exams/service";
import type { QuestionOption } from "@/types/domain";

const OPTION_KEYS = new Set<QuestionOption["key"]>(["A", "B", "C", "D", "E"]);

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  const user = await requireExamApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { attemptId } = await params;

  try {
    const body = await request.json() as {
      attemptQuestionId?: unknown;
      selectedOptionKey?: unknown;
      isFlagged?: unknown; expectedRevision?: unknown; mutationId?: unknown;
    };

    if (typeof body.attemptQuestionId !== "string" || !body.attemptQuestionId) {
      return NextResponse.json({ error: "Question ID is required." }, { status: 400 });
    }
    if (body.selectedOptionKey !== null && !OPTION_KEYS.has(body.selectedOptionKey as QuestionOption["key"])) {
      return NextResponse.json({ error: "Selected option is invalid." }, { status: 400 });
    }
    if (typeof body.isFlagged !== "boolean") {
      return NextResponse.json({ error: "Flag state is required." }, { status: 400 });
    }

    const revision = parseRevision(body);
    const result = await saveExamResponseForUser(
      user.id,
      attemptId,
      body.attemptQuestionId,
      body.selectedOptionKey as QuestionOption["key"] | null,
      body.isFlagged,
      revision.expectedRevision, revision.mutationId,
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes("EXAM_TIME_UP")) {
      try {
        await submitExamAttemptForUser(user.id, attemptId, "time_expired");
      } catch {
        // The original TIME_UP response is still the most useful client signal.
      }
    }
    return examErrorResponse(error);
  }
}
