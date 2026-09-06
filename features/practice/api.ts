import "server-only";

import { NextResponse } from "next/server";

import { QuestionProviderError, QuestionProviderUnsupportedFilterError } from "@/features/questions/errors";
import { createClient } from "@/lib/supabase/server";

export async function requireApiUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

export function practiceErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Something went wrong.";

  if (error instanceof QuestionProviderError) {
    // Upstream status codes and vendor wording stay in the server log only.
    console.error(`[questions] ${error.name}: ${error.message}`);
    const status = error instanceof QuestionProviderUnsupportedFilterError ? 400 : 503;
    return NextResponse.json({ error: error.studentMessage, code: "PROVIDER" }, { status });
  }

  if (message.includes("RESPONSE_CONFLICT")) return NextResponse.json({ error: "A newer answer exists on the server. Your local changes are preserved.", code: "CONFLICT" }, { status: 409 });
  if (message.includes("SESSION_NOT_FOUND")) return NextResponse.json({ error: "Session not found.", code: "NOT_FOUND" }, { status: 404 });
  if (message.includes("PRACTICE_SESSION_TIME_UP")) {
    return NextResponse.json({ error: "Time is up.", code: "TIME_UP" }, { status: 409 });
  }
  if (message.includes("PRACTICE_SESSION_NOT_FOUND") || message.includes("PRACTICE_QUESTION_NOT_FOUND")) {
    return NextResponse.json({ error: "Practice session not found." }, { status: 404 });
  }
  if (message.includes("PRACTICE_SESSION_NOT_ACTIVE")) {
    return NextResponse.json({ error: "This practice session is no longer active." }, { status: 409 });
  }

  return NextResponse.json({ error: message }, { status: 400 });
}
