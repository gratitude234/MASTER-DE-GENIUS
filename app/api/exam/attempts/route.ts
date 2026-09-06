import { NextResponse } from "next/server";

import { examErrorResponse, requireExamApiUser } from "@/features/exams/api";
import { createMockExamAttemptForUser } from "@/features/exams/service";

export async function POST() {
  const user = await requireExamApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await createMockExamAttemptForUser(user.id);
    return NextResponse.json(result, { status: result.resumed ? 200 : 201 });
  } catch (error) {
    return examErrorResponse(error);
  }
}
