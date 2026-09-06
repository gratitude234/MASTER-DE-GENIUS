import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export function GET() { return NextResponse.json({ serverNow: Date.now() }, { headers: { "Cache-Control": "no-store" } }); }
