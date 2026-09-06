import { NextResponse } from "next/server";

import { practiceErrorResponse, requireApiUser } from "@/features/practice/api";
import { createPracticeSessionForUser } from "@/features/practice/service";
import { parseCreatePracticeSessionInput } from "@/features/practice/validation";

export async function POST(request: Request) {
  const user = await requireApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body: unknown = await request.json();
    const input = parseCreatePracticeSessionInput(body);
    const result = await createPracticeSessionForUser(user.id, input);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return practiceErrorResponse(error);
  }
}
