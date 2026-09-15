import { NextResponse } from "next/server";
import { authorizeAdmin } from "@/features/admin/auth";
import { adminErrorMessage } from "@/features/admin/errors";
import { updateAdminLead } from "@/features/classes/service";
import { CLASS_LEAD_STATUSES, type ClassLeadStatus } from "@/features/classes/types";

const STATUSES = new Set<string>(CLASS_LEAD_STATUSES);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Session, membership and the classes.manage permission are all verified
  // before the request body is even read.
  const authorization = await authorizeAdmin("classes.manage");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status, headers: NO_STORE });

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Lead not found." }, { status: 404, headers: NO_STORE });

  let body: { status?: unknown; notes?: unknown; assignedTo?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400, headers: NO_STORE });
  }
  if (body.status !== undefined && (typeof body.status !== "string" || !STATUSES.has(body.status))) {
    return NextResponse.json({ error: "Choose a valid status." }, { status: 400, headers: NO_STORE });
  }
  const note = typeof body.notes === "string" ? body.notes.trim() : "";
  if (note.length > 5000) return NextResponse.json({ error: "Notes are too long." }, { status: 400, headers: NO_STORE });
  if (body.assignedTo !== undefined && body.assignedTo !== null && (typeof body.assignedTo !== "string" || !UUID.test(body.assignedTo))) {
    return NextResponse.json({ error: "Choose a valid assignee." }, { status: 400, headers: NO_STORE });
  }

  try {
    const result = await updateAdminLead(authorization.admin.userId, id, {
      status: body.status as ClassLeadStatus | undefined,
      assignedTo: body.assignedTo as string | null | undefined,
      note: note || null,
    });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    const message = adminErrorMessage(error, "Could not update lead.");
    const status = message === "That lead no longer exists." ? 404 : message === "Your role does not allow this action." ? 403 : 400;
    return NextResponse.json({ error: message }, { status, headers: NO_STORE });
  }
}
