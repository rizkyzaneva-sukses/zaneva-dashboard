import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isSameOrigin } from "@/lib/api-helpers";

// Hanya POST (GET → 405) + cek origin, supaya tidak bisa dipicu dari situs lain (CSRF logout).
export async function POST(req: Request) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Permintaan ditolak" }, { status: 403 });
  }
  const session = await getSession();
  session.destroy();
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
