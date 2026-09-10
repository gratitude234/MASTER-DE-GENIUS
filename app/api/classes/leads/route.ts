import { NextResponse } from "next/server";
import { createClassLead } from "@/features/classes/service";
import { parseClassLeadInput } from "@/features/classes/validation";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to request a class." }, { status: 401 });
  const limited = await enforceRateLimit(RATE_LIMITS.classLeadCreate, user.id);
  if (limited) return limited;
  try {
    const result = await createClassLead(user.id, parseClassLeadInput(await request.json()));
    return NextResponse.json(result, { status: result.deduplicated ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save your class request." }, { status: 400 });
  }
}
