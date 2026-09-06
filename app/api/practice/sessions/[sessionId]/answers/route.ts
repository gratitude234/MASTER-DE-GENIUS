import { parseRevision } from "@/features/offline/server";
import { NextResponse } from "next/server";

import { practiceErrorResponse, requireApiUser } from "@/features/practice/api";
import { savePracticeAnswerForUser } from "@/features/practice/service";
import { parseOptionKey } from "@/features/practice/validation";

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function PUT(request: Request, { params }: RouteContext) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { sessionId } = await params;
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") throw new Error("Invalid answer request.");
    const record = body as Record<string, unknown>;
    const sessionQuestionId = typeof record.sessionQuestionId === "string" ? record.sessionQuestionId : "";
    if (!sessionQuestionId) throw new Error("Question identifier is required.");
    const selectedOptionKey = parseOptionKey(record.selectedOptionKey);

    const revision = parseRevision(record);
    const result = await savePracticeAnswerForUser(
      user.id,
      sessionId,
      sessionQuestionId,
      selectedOptionKey,
      revision.expectedRevision, revision.mutationId,
    );
    return NextResponse.json(result);
  } catch (error) {
    return practiceErrorResponse(error);
  }
}
