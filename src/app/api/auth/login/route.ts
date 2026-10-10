import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getPrisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getClientIp, isSameOrigin } from "@/lib/api-helpers";

// Hanya kegagalan yang dihitung; login sukses mereset hitungan IP & username-nya.
const JENDELA = 15 * 60 * 1000;
const MAKS_PER_IP = 10;
const MAKS_PER_USER = 8;
const MAKS_ENTRI = 5000;
const gagalMap = new Map<string, { n: number; sampai: number }>();

// Hash bcrypt (cost 10) acak, dipakai supaya waktu respons sama baik user ada maupun tidak.
const DUMMY_HASH = "$2b$10$gItJ9eMUnPygI8GovqyeNOW1OcF53FlXb2WgiFjr7Nth5LEbZAJUS";

function bersihkan(now: number) {
  for (const [k, v] of gagalMap) if (now > v.sampai) gagalMap.delete(k);
  // Masih penuh (serangan banyak kunci): buang yang paling lama (urutan insert Map).
  while (gagalMap.size >= MAKS_ENTRI) {
    const tertua = gagalMap.keys().next().value;
    if (tertua === undefined) break;
    gagalMap.delete(tertua);
  }
}

function terkunci(key: string, maks: number) {
  const rec = gagalMap.get(key);
  return !!rec && Date.now() <= rec.sampai && rec.n >= maks;
}

function catatGagal(key: string) {
  const now = Date.now();
  const rec = gagalMap.get(key);
  if (rec && now <= rec.sampai) {
    rec.n += 1;
    return;
  }
  if (gagalMap.size >= MAKS_ENTRI) bersihkan(now);
  gagalMap.set(key, { n: 1, sampai: now + JENDELA });
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!isSameOrigin(req)) {
    return json({ error: "Permintaan ditolak" }, 403);
  }

  const ipKey = `ip:${getClientIp(req)}`;
  if (terkunci(ipKey, MAKS_PER_IP)) {
    return json({ error: "Terlalu banyak percobaan login. Coba lagi 15 menit lagi." }, 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Permintaan tidak valid" }, 400);
  }
  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };

  if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
    return json({ error: "Username dan password wajib diisi" }, 400);
  }
  if (username.length > 64 || password.length > 200) {
    return json({ error: "Username atau password salah" }, 401);
  }

  const uname = username.trim().toLowerCase();
  const userKey = `user:${uname}`;
  if (terkunci(userKey, MAKS_PER_USER)) {
    return json({ error: "Terlalu banyak percobaan login. Coba lagi 15 menit lagi." }, 429);
  }

  try {
    const user = await getPrisma().user.findFirst({
      where: { username: uname, isActive: true },
    });

    // Selalu jalankan bcrypt (hash dummy kalau user tidak ada) agar waktu respons seragam.
    const cocok = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);

    if (!user?.passwordHash || !cocok) {
      catatGagal(ipKey);
      catatGagal(userKey);
      return json({ error: "Username atau password salah" }, 401);
    }

    const session = await getSession();
    session.userId = user.id;
    session.nama = user.nama;
    session.isLoggedIn = true;
    await session.save();

    await getPrisma().user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    gagalMap.delete(ipKey);
    gagalMap.delete(userKey);
    return json({ ok: true, nama: user.nama });
  } catch (e) {
    console.error("[login]", e);
    return json({ error: "Terjadi kesalahan di server" }, 500);
  }
}
