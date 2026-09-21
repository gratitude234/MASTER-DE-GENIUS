import { parseRevision } from "@/features/offline/server";
import { NextResponse } from "next/server";

import { practiceLimitResponse } from "@/features/billing/api";
import { getEntitlement } from "@/features/billing/entitlements";
import { PracticeAllowanceExhausted, practiceMeterFor, readPracticeAllowance } from "@/features/billing/quota";
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
    // On a question-counted plan the first answer to each question is what
    // spends the allowance, and the charge is taken in the same transaction as
    // the answer. The tier is resolved here, per request, so an upgrade applies
    // to the very next answer without a new sign-in.
    const meter = practiceMeterFor(await getEntitlement(user.id));
    try {
      const result = await savePracticeAnswerForUser(
        user.id,
        sessionId,
        sessionQuestionId,
        selectedOptionKey,
        revision.expectedRevision, revision.mutationId,
        meter,
      );
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof PracticeAllowanceExhausted) {
        return practiceLimitResponse(error.meter, (await readPracticeAllowance(user.id, error.meter)) ?? undefined);
      }
      throw error;
    }
  } catch (error) {
    return practiceErrorResponse(error);
  }
}
