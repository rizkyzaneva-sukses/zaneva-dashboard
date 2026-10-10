import { cache } from "react";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getPrisma } from "@/lib/prisma";

export interface AuthUser {
  id: string;
  nama: string;
  username: string;
}

/** Baca user segar dari DB tiap request, bukan dari isi cookie. */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = await getSession();
  if (!session.isLoggedIn || !session.userId) return null;

  const user = await getPrisma().user.findFirst({
    where: { id: session.userId, isActive: true },
    select: { id: true, nama: true, username: true },
  });

  return user ?? null;
}

type Handler<T> = (user: AuthUser, ctx: T) => Promise<Response> | Response;

export function withAuth<T>(handler: Handler<T>) {
  return async (_req: Request, ctx: T) => {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "Belum login", type: "auth_required" },
        { status: 401 }
      );
    }
    return handler(user, ctx);
  };
}

export function apiError(error: unknown) {
  console.error("[api]", error);
  // Di produksi jangan bocorkan pesan internal (query/skema DB) ke klien.
  const pesan =
    process.env.NODE_ENV !== "production" && error instanceof Error
      ? error.message
      : "Terjadi kesalahan di server";
  return NextResponse.json({ error: pesan, type: "server_error" }, { status: 500 });
}

/**
 * Untuk server component / page: pastikan user valid, kalau tidak redirect ke /login.
 * Layout TIDAK dijalankan ulang pada navigasi client-side, jadi page yang membaca data
 * sebaiknya juga memanggil ini (hasil dedupe per request lewat React cache).
 */
export const requireUser = cache(async (): Promise<AuthUser> => {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
});

/**
 * IP klien. Di belakang proxy (Traefik), entri TERAKHIR x-forwarded-for adalah yang
 * ditambahkan proxy terdekat (tidak bisa dipalsukan klien); entri sebelumnya bisa dipalsukan.
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last.slice(0, 64);
  }
  return (req.headers.get("x-real-ip") ?? "unknown").slice(0, 64);
}

/** Tolak request lintas-origin (CSRF) untuk endpoint yang mengubah state. */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // klien non-browser / same-origin GET
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}
