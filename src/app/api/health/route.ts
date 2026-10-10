import { NextResponse } from "next/server";
import { getPrisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Dipakai HEALTHCHECK Docker / Traefik. Publik, jadi hanya mengembalikan ok true/false.
// Default: liveness murni (tanpa DB). `?deep=1`: ikut ping DB.
export async function GET(req: Request) {
  const headers = { "Cache-Control": "no-store" };

  if (new URL(req.url).searchParams.get("deep") === "1") {
    try {
      await getPrisma().$queryRaw`SELECT 1`;
    } catch {
      return NextResponse.json({ ok: false }, { status: 503, headers });
    }
  }
  return NextResponse.json({ ok: true }, { headers });
}
