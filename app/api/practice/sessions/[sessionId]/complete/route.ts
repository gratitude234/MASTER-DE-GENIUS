import { checkAutomaticExpiry } from "@/features/offline/server";
import { NextResponse } from "next/server";

import { practiceErrorResponse, requireApiUser } from "@/features/practice/api";
import { completePracticeSessionForUser } from "@/features/practice/service";

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function POST(request: Request, { params }: RouteContext) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { sessionId } = await params;
    const body = await request.json().catch(() => ({})) as { reason?: string };
    if (body.reason === "time_expired") {
      const serverNow = await checkAutomaticExpiry(user.id, "practice", sessionId);
      if (serverNow !== null) return NextResponse.json({ error: "Timer corrected using server time. Continue your session.", code: "CLOCK_RESYNC", serverNow }, { status: 409 });
    }
    const result = await completePracticeSessionForUser(user.id, sessionId);
    return NextResponse.json(result);
  } catch (error) {
    return practiceErrorResponse(error);
  }
}
