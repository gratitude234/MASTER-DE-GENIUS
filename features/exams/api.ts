import "server-only";

import { NextResponse } from "next/server";

import { QuestionProviderError, QuestionProviderUnsupportedFilterError } from "@/features/questions/errors";
import { createClient } from "@/lib/supabase/server";

export async function requireExamApiUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

export function examErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Something went wrong.";

  if (error instanceof QuestionProviderError) {
    // Upstream status codes and vendor wording stay in the server log only.
    console.error(`[questions] ${error.name}: ${error.message}`);
    const status = error instanceof QuestionProviderUnsupportedFilterError ? 400 : 503;
    return NextResponse.json({ error: error.studentMessage, code: "PROVIDER" }, { status });
  }

  if (message.includes("RESPONSE_CONFLICT")) return NextResponse.json({ error: "A newer answer exists on the server. Your local changes are preserved.", code: "CONFLICT" }, { status: 409 });
  if (message.includes("SESSION_NOT_FOUND")) return NextResponse.json({ error: "Session not found.", code: "NOT_FOUND" }, { status: 404 });
  if (message.includes("EXAM_TIME_UP")) {
    return NextResponse.json({ error: "Time is up. Your exam is being submitted.", code: "TIME_UP" }, { status: 409 });
  }
  if (message.includes("EXAM_ATTEMPT_NOT_FOUND") || message.includes("EXAM_QUESTION_NOT_FOUND")) {
    return NextResponse.json({ error: "Exam attempt not found." }, { status: 404 });
  }
  if (message.includes("EXAM_ATTEMPT_NOT_ACTIVE")) {
    return NextResponse.json({ error: "This exam is no longer active." }, { status: 409 });
  }
  if (message.includes("MOCK_INVENTORY_SHORTAGE")) {
    const [, subject, needed, available] = message.split("|");
    return NextResponse.json({
      error: `${subject || "A subject"} does not yet have enough questions for a full mock (${available || 0}/${needed || 0} available).`,
      code: "INVENTORY_SHORTAGE",
    }, { status: 409 });
  }

  return NextResponse.json({ error: message }, { status: 400 });
}
