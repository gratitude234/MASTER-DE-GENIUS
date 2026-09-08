import { NextResponse } from "next/server";

import { AiExplanationError, explainQuestionForUser, parseExplanationRequest } from "@/features/ai/service";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });

  try {
    const input = parseExplanationRequest(await request.json().catch(() => null));
    const result = await explainQuestionForUser(user.id, input);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AiExplanationError) {
      return NextResponse.json(
        // `limit` is present only for a plan allowance, and carries the copy and
        // the upgrade link the panel renders instead of a bare error.
        { error: error.message, code: error.code, ...(error.limit ? { limit: error.limit } : {}) },
        {
          status: error.status,
          headers: {
            "Cache-Control": "private, no-store",
            ...(error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : {}),
          },
        },
      );
    }
    console.error("[ai] unexpected explanation error");
    return NextResponse.json(
      { error: "MASTER AI is unavailable right now.", code: "AI_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
