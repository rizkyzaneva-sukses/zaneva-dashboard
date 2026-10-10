import { NextResponse, type NextRequest } from "next/server";
import { unsealData } from "iron-session";

// Cocok persis atau sebagai awalan segmen ("/api/auth" cocok "/api/auth/login",
// tapi tidak "/api/authx").
// "/api/admin" punya autentikasi sendiri (Bearer IMPORT_SECRET), jadi lewati cek sesi cookie.
const PUBLIC_PATHS = ["/login", "/api/auth", "/api/health", "/api/admin"];

const SESSION_TTL = 60 * 60 * 24 * 7;
const DEV_SECRET = "dev_only_password_at_least_32_characters_long";

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * Verifikasi tanda tangan + masa berlaku cookie iron-session (tanpa DB).
 * Cookie palsu / kedaluwarsa / dirusak ditolak di sini. Pengecekan user aktif di DB
 * tetap dilakukan di layout & route handler (getCurrentUser).
 */
async function hasValidSession(req: NextRequest): Promise<boolean> {
  const cookieName = process.env.SESSION_COOKIE_NAME || "app_session";
  const sealed = req.cookies.get(cookieName)?.value;
  if (!sealed) return false;

  const secret = process.env.SESSION_SECRET;
  const password =
    secret && secret.length >= 32
      ? secret
      : process.env.NODE_ENV === "production"
        ? null
        : DEV_SECRET;
  if (!password) return false; // salah konfigurasi di produksi: tolak semua (fail closed)

  try {
    const data = await unsealData<{ userId?: string; isLoggedIn?: boolean }>(sealed, {
      password,
      ttl: SESSION_TTL,
    });
    return data.isLoggedIn === true && typeof data.userId === "string" && data.userId.length > 0;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  if (!(await hasValidSession(req))) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Belum login", type: "auth_required" },
        { status: 401 }
      );
    }
    const params = new URLSearchParams(search);
    params.delete("_rsc");
    const qs = params.toString();

    // Next menolak Location relatif di middleware, jadi bangun URL absolut dari header proxy
    // (di belakang Traefik host internal-nya 0.0.0.0:3000, bukan domain publik).
    const fwdProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const rawHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
    const host = /^[a-z0-9.-]+(:\d{1,5})?$/i.test(rawHost) ? rawHost : req.nextUrl.host;
    const scheme = fwdProto === "http" || fwdProto === "https" ? fwdProto : req.nextUrl.protocol.replace(":", "");
    const url = new URL("/login", `${scheme}://${host}`);
    url.searchParams.set("return_to", pathname + (qs ? `?${qs}` : ""));
    return NextResponse.redirect(url, 307);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json).*)"],
};
