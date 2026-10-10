import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  userId?: string;
  nama?: string;
  isLoggedIn?: boolean;
}

export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

const DEV_SECRET = "dev_only_password_at_least_32_characters_long";

/**
 * Dicek saat dipakai (runtime), BUKAN saat import — supaya `next build`
 * (yang tidak punya env produksi) tidak gagal.
 */
export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET wajib diisi minimal 32 karakter di produksi");
  }
  return DEV_SECRET;
}

/**
 * Cookie "secure" otomatis aktif di produksi (TLS di-terminate proxy, browser tetap
 * melihat https). Kalau perlu akses lewat http murni (mis. IP internal), set
 * SESSION_COOKIE_SECURE=false.
 */
function cookieSecure(): boolean {
  const override = process.env.SESSION_COOKIE_SECURE;
  if (override === "true") return true;
  if (override === "false") return false;
  return process.env.NODE_ENV === "production";
}

export function getSessionOptions(): SessionOptions {
  return {
    password: getSessionSecret(),
    cookieName: process.env.SESSION_COOKIE_NAME || "app_session",
    // ttl = umur segel di server; samakan dengan maxAge cookie (default iron-session 14 hari).
    ttl: SESSION_MAX_AGE,
    cookieOptions: {
      httpOnly: true,
      secure: cookieSecure(),
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    },
  };
}

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, getSessionOptions());
}
