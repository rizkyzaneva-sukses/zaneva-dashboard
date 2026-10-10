import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getPrisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

/**
 * Endpoint admin satu-kali untuk menyuntik data ETL lokal ke database produksi
 * lewat HTTPS (tidak perlu membuka port Postgres ke publik / SSH ke server).
 *
 * Auth : header `Authorization: Bearer <IMPORT_SECRET>` (env wajib, minimal 16 karakter).
 * Body : { mode: "replace" | "append", orders?: [...], reviews?: [...] }
 *        orders[]  -> satu objek per baris orders_clean.csv (orderKey/orderW sudah dihitung klien)
 *        reviews[] -> satu objek per baris product_review.csv
 *
 * Klien mengirim per-batch (±5000 baris). mode "replace" hanya pada batch pertama:
 * tabel di-TRUNCATE sekali, batch berikutnya "append". Aman dijalankan ulang dari nol.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Batas waktu eksplisit (detik) untuk platform yang menghormatinya.
export const maxDuration = 120;

const MARKETPLACES = new Set([
  "SHOPEE",
  "TIKTOK",
  "LAZADA",
  "BOOTH",
  "KOMUNITAS",
  "KANTOR",
  "CASH_COD",
  "LAINNYA",
]);

const MAX_BATCH = 8000;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Bandingkan string tanpa membocorkan waktu (mitigasi timing attack). */
function secretCocok(dikirim: string, asli: string): boolean {
  const a = Buffer.from(dikirim);
  const b = Buffer.from(asli);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function bearer(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : "";
}

interface OrderIn {
  orderNo?: unknown;
  resi?: unknown;
  orderDate?: unknown;
  paymentMethod?: unknown;
  sku?: unknown;
  qty?: unknown;
  revenue?: unknown;
  shippingCost?: unknown;
  city?: unknown;
  district?: unknown;
  province?: unknown;
  platformRaw?: unknown;
  marketplace?: unknown;
  account?: unknown;
  brand?: unknown;
  category?: unknown;
  venue?: unknown;
  orderKey?: unknown;
  orderW?: unknown;
  sourceFile?: unknown;
}

type BarisOrder = {
  orderNo: string;
  resi: string | null;
  orderDate: Date;
  paymentMethod: string | null;
  sku: string;
  qty: number;
  revenue: Prisma.Decimal;
  shippingCost: Prisma.Decimal | null;
  city: string | null;
  district: string | null;
  province: string | null;
  platformRaw: string;
  marketplace: "SHOPEE" | "TIKTOK" | "LAZADA" | "BOOTH" | "KOMUNITAS" | "KANTOR" | "CASH_COD" | "LAINNYA";
  account: string | null;
  brand: string;
  category: string | null;
  venue: string | null;
  orderKey: number;
  orderW: number;
  sourceFile: string;
};

const str = (v: unknown): string => (v == null ? "" : String(v));
const opt = (v: unknown): string | null => {
  const s = str(v);
  return s === "" ? null : s;
};

/** Validasi + normalisasi satu baris mentah jadi baris siap-insert. Melempar pesan bila tidak valid. */
function siapkanOrder(r: OrderIn, i: number): BarisOrder {
  const orderNo = str(r.orderNo).trim();
  const sku = str(r.sku).trim();
  const orderDate = str(r.orderDate).trim();
  const marketplace = str(r.marketplace).trim().toUpperCase();
  const brand = str(r.brand).trim();
  const revenue = str(r.revenue).trim();

  if (!orderNo) throw new Error(`orders[${i}]: orderNo kosong`);
  if (!sku) throw new Error(`orders[${i}]: sku kosong`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate) || Number.isNaN(new Date(orderDate + "T00:00:00Z").getTime()))
    throw new Error(`orders[${i}]: orderDate tidak valid (${orderDate})`);
  if (!MARKETPLACES.has(marketplace)) throw new Error(`orders[${i}]: marketplace tidak dikenal (${marketplace})`);
  if (!brand) throw new Error(`orders[${i}]: brand kosong`);
  if (revenue === "" || Number.isNaN(Number(revenue))) throw new Error(`orders[${i}]: revenue tidak valid (${revenue})`);

  const qty = Number.parseInt(str(r.qty), 10);
  const shipping = str(r.shippingCost).trim();

  return {
    orderNo,
    resi: opt(r.resi),
    orderDate: new Date(orderDate + "T00:00:00Z"),
    paymentMethod: opt(r.paymentMethod),
    sku,
    qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
    revenue: new Prisma.Decimal(revenue),
    shippingCost: shipping === "" ? null : new Prisma.Decimal(shipping),
    city: opt(r.city),
    district: opt(r.district),
    province: opt(r.province),
    platformRaw: str(r.platformRaw),
    marketplace: marketplace as BarisOrder["marketplace"],
    account: opt(r.account),
    brand,
    category: opt(r.category),
    venue: opt(r.venue),
    orderKey: Number.isFinite(Number(r.orderKey)) ? Math.trunc(Number(r.orderKey)) : 0,
    orderW: Number.isFinite(Number(r.orderW)) && Number(r.orderW) > 0 ? Number(r.orderW) : 1,
    sourceFile: str(r.sourceFile) || "import",
  };
}

export async function POST(req: Request) {
  const SECRET = process.env.IMPORT_SECRET ?? "";
  if (SECRET.length < 16) {
    return json(
      { error: "IMPORT_SECRET belum diatur (minimal 16 karakter) di environment app." },
      503
    );
  }
  if (!secretCocok(bearer(req), SECRET)) {
    return json({ error: "Tidak diizinkan" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body bukan JSON valid" }, 400);
  }
  const { mode, orders, reviews } = (body ?? {}) as {
    mode?: unknown;
    orders?: unknown;
    reviews?: unknown;
  };
  const ganti = mode === "replace";

  if (orders !== undefined && !Array.isArray(orders)) return json({ error: "orders harus array" }, 400);
  if (reviews !== undefined && !Array.isArray(reviews)) return json({ error: "reviews harus array" }, 400);
  if (Array.isArray(orders) && orders.length > MAX_BATCH)
    return json({ error: `orders melebihi ${MAX_BATCH} baris per batch` }, 413);

  const prisma = getPrisma();

  try {
    if (ganti) {
      // TRUNCATE instan (deleteMany pada 489k baris bisa melewati statement_timeout).
      await prisma.$executeRawUnsafe('TRUNCATE TABLE "orders", "product_reviews" RESTART IDENTITY CASCADE');
    }

    let dimasukkan = 0;
    if (Array.isArray(orders) && orders.length > 0) {
      const data = (orders as OrderIn[]).map((r, i) => siapkanOrder(r, i));
      dimasukkan = data.length;
      await prisma.order.createMany({ data });
    }

    let reviewDimasukkan = 0;
    if (Array.isArray(reviews) && reviews.length > 0) {
      const data = (reviews as Record<string, unknown>[]).map((r) => ({
        kind: str(r.kind) || "LAINNYA",
        name: str(r.name),
        rows: Number.parseInt(str(r.rows), 10) || 0,
        omzet: new Prisma.Decimal(str(r.omzet) || "0"),
        suggestions: opt(r.suggestions),
        note: opt(r.note),
        resultSku: opt(r.resultSku),
      }));
      reviewDimasukkan = data.length;
      await prisma.productReview.createMany({ data });
    }

    const total = await prisma.order.count();
    const totalReview = await prisma.productReview.count();

    return json({
      ok: true,
      mode: ganti ? "replace" : "append",
      dimasukkan,
      reviewDimasukkan,
      totalOrders: total,
      totalReviews: totalReview,
    });
  } catch (e) {
    const pesan = e instanceof Error ? e.message : "gagal";
    console.error("[admin/import]", e);
    return json({ error: pesan }, 500);
  }
}
