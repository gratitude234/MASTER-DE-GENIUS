import { NextResponse } from "next/server";
import { isAppAdmin, updateAdminLead } from "@/features/classes/service";
import { CLASS_LEAD_STATUSES, type ClassLeadStatus } from "@/features/classes/types";
import { createClient } from "@/lib/supabase/server";

const STATUSES = new Set<string>(CLASS_LEAD_STATUSES);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isAppAdmin(user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  const body = await request.json() as { status?: unknown; notes?: unknown };
  if (typeof body.status !== "string" || !STATUSES.has(body.status as ClassLeadStatus)) return NextResponse.json({ error: "Choose a valid status." }, { status: 400 });
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (notes.length > 5000) return NextResponse.json({ error: "Notes are too long." }, { status: 400 });
  try {
    return NextResponse.json(await updateAdminLead(id, { status: body.status as ClassLeadStatus, notes: notes || null }, user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update lead." }, { status: 404 });
  }
}
