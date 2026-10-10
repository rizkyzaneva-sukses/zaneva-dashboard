import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getPrisma } from "@/lib/prisma";
import { getCurrentUser, apiError, isSameOrigin } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_PANJANG = 8;
const MAKS_PANJANG = 200;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!isSameOrigin(req)) {
    return json({ error: "Permintaan ditolak" }, 403);
  }

  const user = await getCurrentUser();
  if (!user) {
    return json({ error: "Belum login", type: "auth_required" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Permintaan tidak valid" }, 400);
  }

  const { lama, baru } = (body ?? {}) as { lama?: unknown; baru?: unknown };

  if (typeof lama !== "string" || typeof baru !== "string" || !lama || !baru) {
    return json({ error: "Password lama dan baru wajib diisi" }, 400);
  }
  if (lama.length > MAKS_PANJANG || baru.length > MAKS_PANJANG) {
    return json({ error: "Password terlalu panjang" }, 400);
  }
  if (baru.length < MIN_PANJANG) {
    return json({ error: `Password baru minimal ${MIN_PANJANG} karakter` }, 400);
  }
  if (baru === lama) {
    return json({ error: "Password baru harus berbeda dari password lama" }, 400);
  }

  try {
    const row = await getPrisma().user.findFirst({
      where: { id: user.id, isActive: true },
      select: { id: true, passwordHash: true },
    });
    if (!row?.passwordHash) {
      return json({ error: "User tidak ditemukan" }, 404);
    }

    const cocok = await bcrypt.compare(lama, row.passwordHash);
    if (!cocok) {
      return json({ error: "Password lama salah" }, 401);
    }

    const passwordHash = await bcrypt.hash(baru, 10);
    await getPrisma().user.update({
      where: { id: row.id },
      data: { passwordHash },
    });

    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
