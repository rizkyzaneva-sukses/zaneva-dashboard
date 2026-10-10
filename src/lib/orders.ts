import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";

export const NO_PRODUCT = "(produk tidak tercatat)";
export const NO_MASTER = "(di luar master)";

export interface OrderFilter {
  from?: string;
  to?: string;
  brand?: string | null;
  marketplace?: string | null;
  account?: string | null;
  province?: string | null;
  city?: string | null;
  category?: string | null;
  sku?: string | null;
}

export const PAGE_SIZE = 50;
const MAX_PAGE = 2000;

/** Escape wildcard LIKE (% _ \) supaya input pengguna dicari apa adanya, bukan sebagai pola. */
function likePattern(q: string): string {
  return `%${q.slice(0, 100).replace(/[\\%_]/g, "\\$&")}%`;
}

function safeOffset(page: number): number {
  const p = Number.isFinite(page) ? Math.min(Math.max(Math.trunc(page), 1), MAX_PAGE) : 1;
  return (p - 1) * PAGE_SIZE;
}

const MARKETPLACE_VALUES = new Set(["SHOPEE", "TIKTOK", "LAZADA", "BOOTH", "KOMUNITAS", "KANTOR", "CASH_COD", "LAINNYA"]);

function buildWhere(f: OrderFilter): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`1=1`];
  if (f.from) conditions.push(Prisma.sql`"orderDate" >= ${new Date(f.from + "T00:00:00Z")}`);
  if (f.to) conditions.push(Prisma.sql`"orderDate" <= ${new Date(f.to + "T23:59:59Z")}`);
  if (f.brand) conditions.push(Prisma.sql`"brand" = ${f.brand}`);
  if (f.marketplace && MARKETPLACE_VALUES.has(f.marketplace)) {
    conditions.push(Prisma.sql`"marketplace" = ${f.marketplace}::"Marketplace"`);
  }
  if (f.account) conditions.push(Prisma.sql`"account" = ${f.account}`);
  if (f.province) conditions.push(Prisma.sql`"province" = ${f.province}`);
  if (f.city) conditions.push(Prisma.sql`"city" = ${f.city}`);
  if (f.category === NO_MASTER) conditions.push(Prisma.sql`"category" IS NULL AND "sku" <> ${NO_PRODUCT}`);
  else if (f.category) conditions.push(Prisma.sql`"category" = ${f.category}`);
  if (f.sku) conditions.push(Prisma.sql`"sku" = ${f.sku}`);
  return Prisma.join(conditions, " AND ");
}

/** Ranking wilayah = asal pembeli online. Booth, kantor & komunitas (lokasi = tempat jualan) dipisah ke halaman Booth. */
const ONLINE_ONLY = Prisma.sql`AND "marketplace" NOT IN ('BOOTH'::"Marketplace", 'KANTOR'::"Marketplace", 'KOMUNITAS'::"Marketplace")`;


/**
 * Jumlah order per grup. COUNT(DISTINCT) pada ratusan ribu baris lambat (detik), jadi tanpa filter produk/kategori
 * dipakai bobot per baris (orderW = 1/jumlah baris dalam order) yang dijumlahkan: eksak untuk grup tingkat-order
 * (channel, operator, brand, wilayah) dan tetap aditif untuk grup tingkat-produk. Dengan filter produk/kategori
 * datanya kecil, jadi dihitung eksak.
 */
function ordersExpr(f: OrderFilter, cond?: Prisma.Sql): Prisma.Sql {
  const lineLevel = !!(f.category || f.sku);
  if (lineLevel) {
    return cond ? Prisma.sql`COUNT(DISTINCT "orderKey") FILTER (WHERE ${cond})` : Prisma.sql`COUNT(DISTINCT "orderKey")`;
  }
  return cond
    ? Prisma.sql`ROUND(COALESCE(SUM("orderW") FILTER (WHERE ${cond}), 0))::bigint`
    : Prisma.sql`ROUND(COALESCE(SUM("orderW"), 0))::bigint`;
}

/** Order eksak (distinct) untuk sekumpulan SKU saja: murah karena hanya 10-50 SKU. */
async function exactOrdersBySku(where: Prisma.Sql, skus: string[]): Promise<Map<string, number>> {
  if (skus.length === 0) return new Map();
  const rows = await getPrisma().$queryRaw<{ sku: string; orders: bigint }[]>(
    Prisma.sql`SELECT "sku", COUNT(DISTINCT "orderKey") AS orders FROM "orders"
               WHERE ${where} AND "sku" IN (${Prisma.join(skus)}) GROUP BY "sku"`
  );
  return new Map(rows.map((r) => [r.sku, Number(r.orders)]));
}

export interface Summary {
  omzet: number;
  qty: number;
  orders: number;
}

async function _getSummary(f: OrderFilter): Promise<Summary> {
  const where = buildWhere(f);
  const rows = await getPrisma().$queryRaw<{ omzet: string | null; qty: bigint | null; orders: bigint }[]>(
    Prisma.sql`
      SELECT SUM("revenue") AS omzet, SUM("qty") AS qty, COUNT(DISTINCT "orderKey") AS orders
      FROM "orders" WHERE ${where}
    `
  );
  const r = rows[0];
  return { omzet: Number(r?.omzet ?? 0), qty: Number(r?.qty ?? 0), orders: Number(r?.orders ?? 0) };
}

export interface BreakdownRow {
  label: string;
  omzet: number;
  orders: number;
}

const DIMENSIONS = {
  brand: '"brand"',
  marketplace: '"marketplace"::text',
  category: `CASE WHEN "category" IS NOT NULL THEN "category"
                  WHEN "sku" = '${NO_PRODUCT}' THEN '${NO_PRODUCT}'
                  ELSE '${NO_MASTER}' END`,
  account: '"account"',
  venue: '"venue"',
} as const;

async function _getBreakdown(f: OrderFilter, dim: keyof typeof DIMENSIONS): Promise<BreakdownRow[]> {
  const where = dim === "venue" ? Prisma.sql`${buildWhere(f)} AND "venue" IS NOT NULL` : buildWhere(f);
  const col = Prisma.raw(DIMENSIONS[dim]);
  const rows = await getPrisma().$queryRaw<{ label: string | null; omzet: string | null; orders: bigint }[]>(
    Prisma.sql`
      SELECT ${col} AS label, SUM("revenue") AS omzet, ${ordersExpr(f)} AS orders
      FROM "orders" WHERE ${where}
      GROUP BY 1 ORDER BY omzet DESC NULLS LAST
    `
  );
  return rows.map((r) => ({
    label: r.label ?? "(tanpa operator)",
    omzet: Number(r.omzet ?? 0),
    orders: Number(r.orders ?? 0),
  }));
}

export interface RegionRow {
  city: string;
  district: string | null;
  province: string | null;
  omzet: number;
  orders: number;
}

async function _getByRegion(f: OrderFilter, limit = 100): Promise<RegionRow[]> {
  const where = buildWhere(f);
  const rows = await getPrisma().$queryRaw<
    { city: string | null; district: string | null; province: string | null; omzet: string | null; orders: bigint }[]
  >(
    Prisma.sql`
      SELECT
        COALESCE(NULLIF("city", ''), 'Tidak diketahui') AS city,
        NULLIF("district", '') AS district,
        MAX("province") AS province,
        SUM("revenue") AS omzet,
        ${ordersExpr(f)} AS orders
      FROM "orders" WHERE ${where} ${ONLINE_ONLY} AND "city" IS NOT NULL AND "district" IS NOT NULL
      GROUP BY 1, 2
      ORDER BY omzet DESC
      LIMIT ${limit}
    `
  );
  return rows.map((r) => ({
    city: r.city ?? "Tidak diketahui",
    district: r.district,
    province: r.province,
    omzet: Number(r.omzet ?? 0),
    orders: Number(r.orders ?? 0),
  }));
}

export interface Page<T> {
  rows: T[];
  total: number;
}

export type RegionLevel = "kecamatan" | "kota";

/** Per Kecamatan: hanya baris yang kota DAN kecamatannya terisi. Per Kota: semua baris yang kotanya terisi. */
async function _getRegionPage(
  f: OrderFilter,
  page: number,
  level: RegionLevel,
  search?: string
): Promise<Page<RegionRow>> {
  const where = buildWhere(f);
  const pattern = search ? likePattern(search) : null;
  const like = pattern ? Prisma.sql`AND ("city" ILIKE ${pattern} OR "district" ILIKE ${pattern})` : Prisma.empty;
  const complete =
    level === "kecamatan"
      ? Prisma.sql`AND "city" IS NOT NULL AND "district" IS NOT NULL`
      : Prisma.sql`AND "city" IS NOT NULL`;
  const districtCol = level === "kecamatan" ? Prisma.sql`"district"` : Prisma.sql`NULL::text`;
  const groupBy = level === "kecamatan" ? Prisma.sql`"city", "district"` : Prisma.sql`"city"`;
  const rows = await getPrisma().$queryRaw<
    { city: string | null; district: string | null; province: string | null; omzet: string | null; orders: bigint; total: bigint }[]
  >(
    Prisma.sql`
      SELECT
        "city" AS city,
        ${districtCol} AS district,
        MAX("province") AS province,
        SUM("revenue") AS omzet,
        ${ordersExpr(f)} AS orders,
        COUNT(*) OVER () AS total
      FROM "orders" WHERE ${where} ${ONLINE_ONLY} ${complete} ${like}
      GROUP BY ${groupBy}
      ORDER BY omzet DESC
      LIMIT ${PAGE_SIZE} OFFSET ${safeOffset(page)}
    `
  );
  return {
    total: Number(rows[0]?.total ?? 0),
    rows: rows.map((r) => ({
      city: r.city ?? "Tidak diketahui",
      district: r.district,
      province: r.province,
      omzet: Number(r.omzet ?? 0),
      orders: Number(r.orders ?? 0),
    })),
  };
}

async function _getProductPage(f: OrderFilter, page: number, search?: string): Promise<Page<ProductRow>> {
  const where = buildWhere(f);
  const like = search ? Prisma.sql`AND "sku" ILIKE ${likePattern(search)}` : Prisma.empty;
  const rows = await getPrisma().$queryRaw<
    { sku: string; category: string | null; omzet: string | null; qty: bigint | null; orders: bigint; total: bigint }[]
  >(
    Prisma.sql`
      SELECT "sku", MAX("category") AS category, SUM("revenue") AS omzet, SUM("qty") AS qty,
             0::bigint AS orders, COUNT(*) OVER () AS total
      FROM "orders" WHERE ${where} AND "sku" <> ${NO_PRODUCT} ${like}
      GROUP BY "sku"
      ORDER BY omzet DESC
      LIMIT ${PAGE_SIZE} OFFSET ${safeOffset(page)}
    `
  );
  const exact = await exactOrdersBySku(where, rows.map((r) => r.sku));
  return {
    total: Number(rows[0]?.total ?? 0),
    rows: rows.map((r) => ({
      sku: r.sku,
      category: r.category,
      omzet: Number(r.omzet ?? 0),
      qty: Number(r.qty ?? 0),
      orders: exact.get(r.sku) ?? 0,
    })),
  };
}

export interface LocationGaps {
  unknownOmzet: number;
  unknownOrders: number;
  noDistrictOmzet: number;
  cities: number;
  districts: number;
}

async function _getLocationGaps(f: OrderFilter): Promise<LocationGaps> {
  const where = buildWhere(f);
  const rows = await getPrisma().$queryRaw<
    { u_omzet: string | null; u_orders: bigint; nd_omzet: string | null; cities: bigint; districts: bigint }[]
  >(
    Prisma.sql`
      WITH g AS (
        SELECT "city", "district", SUM("revenue") AS om, SUM("orderW") AS w, COUNT(DISTINCT "orderKey") AS dn
        FROM "orders" WHERE ${where} ${ONLINE_ONLY}
        GROUP BY "city", "district"
      )
      SELECT
        SUM(om) FILTER (WHERE "city" IS NULL) AS u_omzet,
        ${f.category || f.sku ? Prisma.sql`SUM(dn) FILTER (WHERE "city" IS NULL)` : Prisma.sql`ROUND(COALESCE(SUM(w) FILTER (WHERE "city" IS NULL), 0))`} AS u_orders,
        SUM(om) FILTER (WHERE "city" IS NOT NULL AND "district" IS NULL) AS nd_omzet,
        COUNT(DISTINCT "city") AS cities,
        COUNT(*) FILTER (WHERE "district" IS NOT NULL) AS districts
      FROM g
    `
  );
  const r = rows[0];
  return {
    unknownOmzet: Number(r?.u_omzet ?? 0),
    unknownOrders: Number(r?.u_orders ?? 0),
    noDistrictOmzet: Number(r?.nd_omzet ?? 0),
    cities: Number(r?.cities ?? 0),
    districts: Number(r?.districts ?? 0),
  };
}

export interface CompletenessGroup {
  hasProduct: boolean;
  inMaster: boolean;
  hasCity: boolean;
  hasDistrict: boolean;
  rows: number;
  orders: number;
  omzet: number;
}

/** Sebaran kelengkapan data: satu grup per kombinasi (produk, master, kota, kecamatan, akun). */
async function _getCompleteness(f: OrderFilter): Promise<CompletenessGroup[]> {
  const where = buildWhere(f);
  const rows = await getPrisma().$queryRaw<
    {
      hp: boolean; hm: boolean; hc: boolean; hd: boolean;
      n: bigint; orders: bigint; omzet: string | null;
    }[]
  >(
    Prisma.sql`
      SELECT
        ("sku" <> ${NO_PRODUCT}) AS hp,
        ("category" IS NOT NULL) AS hm,
        ("city" IS NOT NULL) AS hc,
        ("district" IS NOT NULL) AS hd,
        COUNT(*) AS n, ${ordersExpr(f)} AS orders, SUM("revenue") AS omzet
      FROM "orders" WHERE ${where}
      GROUP BY 1, 2, 3, 4
    `
  );
  return rows.map((r) => ({
    hasProduct: r.hp,
    inMaster: r.hm,
    hasCity: r.hc,
    hasDistrict: r.hd,
    rows: Number(r.n),
    orders: Number(r.orders),
    omzet: Number(r.omzet ?? 0),
  }));
}

export interface ReviewItem {
  id: string;
  name: string;
  rows: number;
  omzet: number;
  suggestions: string | null;
  note: string | null;
  resultSku: string | null;
}

export async function getReviewItems(kind: "BELUM_COCOK" | "OTOMATIS", limit = 30): Promise<{ items: ReviewItem[]; total: number; omzet: number }> {
  const db = getPrisma();
  const [items, agg] = await Promise.all([
    db.productReview.findMany({ where: { kind }, orderBy: { omzet: "desc" }, take: limit }),
    db.productReview.aggregate({ where: { kind }, _count: true, _sum: { omzet: true } }),
  ]);
  return {
    items: items.map((i) => ({ ...i, omzet: Number(i.omzet) })),
    total: agg._count,
    omzet: Number(agg._sum.omzet ?? 0),
  };
}

export async function getProvinceOptions(): Promise<string[]> {
  const rows = await getPrisma().$queryRaw<{ province: string }[]>(
    Prisma.sql`SELECT DISTINCT "province" FROM "orders" WHERE "province" IS NOT NULL ORDER BY "province"`
  );
  return rows.map((r) => r.province);
}

export interface ProductRow {
  sku: string;
  category?: string | null;
  omzet: number;
  qty: number;
  orders: number;
}

async function _getByProduct(f: OrderFilter, limit = 100): Promise<ProductRow[]> {
  const where = buildWhere(f);
  const rows = await getPrisma().$queryRaw<
    { sku: string; omzet: string | null; qty: bigint | null; orders: bigint }[]
  >(
    Prisma.sql`
      SELECT "sku", SUM("revenue") AS omzet, SUM("qty") AS qty, 0::bigint AS orders
      FROM "orders" WHERE ${where} AND "sku" <> ${NO_PRODUCT}
      GROUP BY "sku"
      ORDER BY omzet DESC
      LIMIT ${limit}
    `
  );
  const exact = await exactOrdersBySku(where, rows.map((r) => r.sku));
  return rows.map((r) => ({
    sku: r.sku,
    omzet: Number(r.omzet ?? 0),
    qty: Number(r.qty ?? 0),
    orders: exact.get(r.sku) ?? 0,
  }));
}

/** Omzet dari baris yang nama produknya kosong di data sumber (tidak ikut ranking). */
async function _getUntrackedProduct(f: OrderFilter): Promise<{ omzet: number; orders: number }> {
  const where = buildWhere(f);
  const rows = await getPrisma().$queryRaw<{ omzet: string | null; orders: bigint }[]>(
    Prisma.sql`
      SELECT SUM("revenue") AS omzet, COUNT(DISTINCT "orderKey") AS orders
      FROM "orders" WHERE ${where} AND "sku" = ${NO_PRODUCT}
    `
  );
  return { omzet: Number(rows[0]?.omzet ?? 0), orders: Number(rows[0]?.orders ?? 0) };
}

export async function getBrandOptions(): Promise<string[]> {
  const rows = await getPrisma().$queryRaw<{ brand: string }[]>(
    Prisma.sql`SELECT DISTINCT "brand" FROM "orders" ORDER BY "brand"`
  );
  return rows.map((r) => r.brand);
}

async function _getFilterOptions() {
  const [brands, accounts, provinces, categories] = await Promise.all([
    getBrandOptions(),
    getAccountOptions(),
    getProvinceOptions(),
    getCategoryOptions(),
  ]);
  return { brands, accounts, provinces, categories };
}

export async function getCategoryOptions(): Promise<string[]> {
  const rows = await getPrisma().$queryRaw<{ category: string }[]>(
    Prisma.sql`SELECT DISTINCT "category" FROM "orders" WHERE "category" IS NOT NULL ORDER BY "category"`
  );
  return [...rows.map((r) => r.category), NO_MASTER];
}

export async function getAccountOptions(): Promise<string[]> {
  const rows = await getPrisma().$queryRaw<{ account: string }[]>(
    Prisma.sql`SELECT DISTINCT "account" FROM "orders" WHERE "account" IS NOT NULL ORDER BY "account"`
  );
  return rows.map((r) => r.account);
}

export async function searchProductOptions(q: string, limit = 50): Promise<string[]> {
  const rows = await getPrisma().$queryRaw<{ sku: string }[]>(
    Prisma.sql`
      SELECT DISTINCT "sku" FROM "orders"
      WHERE "sku" ILIKE ${likePattern(q)} AND "sku" <> ${NO_PRODUCT}
      ORDER BY "sku" LIMIT ${Math.min(Math.max(limit, 1), 100)}
    `
  );
  return rows.map((r) => r.sku);
}

export async function searchCityOptions(q: string, province?: string | null, limit = 50): Promise<string[]> {
  const prov = province ? Prisma.sql`AND "province" = ${province}` : Prisma.empty;
  const rows = await getPrisma().$queryRaw<{ city: string }[]>(
    Prisma.sql`
      SELECT "city" FROM "orders"
      WHERE "city" IS NOT NULL AND "city" ILIKE ${likePattern(q)} ${prov}
      GROUP BY "city" ORDER BY SUM("revenue") DESC LIMIT ${Math.min(Math.max(limit, 1), 100)}
    `
  );
  return rows.map((r) => r.city);
}

export interface BoothMallRow {
  venue: string;
  city: string;
  district: string;
  events: number;
  days: number;
  firstDate: string;
  lastDate: string;
  omzet: number;
  qty: number;
}

async function _getBoothByMall(f: OrderFilter): Promise<BoothMallRow[]> {
  const where = buildWhere({ ...f, marketplace: "BOOTH" });
  const rows = await getPrisma().$queryRaw<
    { venue: string; city: string; district: string; events: bigint; days: bigint; first: Date; last: Date; omzet: string | null; qty: bigint | null }[]
  >(
    Prisma.sql`
      SELECT COALESCE("venue", '(mall belum diisi)') AS venue, COALESCE(MAX("city"), '-') AS city, COALESCE(MAX("district"), '-') AS district,
             COUNT(DISTINCT "orderKey") AS events, COUNT(DISTINCT "orderDate") AS days,
             MIN("orderDate") AS first, MAX("orderDate") AS last,
             SUM("revenue") AS omzet, SUM("qty") AS qty
      FROM "orders" WHERE ${where}
      GROUP BY 1 ORDER BY omzet DESC
    `
  );
  return rows.map((r) => ({
    venue: r.venue, city: r.city, district: r.district,
    events: Number(r.events), days: Number(r.days),
    firstDate: r.first.toISOString().slice(0, 10), lastDate: r.last.toISOString().slice(0, 10),
    omzet: Number(r.omzet ?? 0), qty: Number(r.qty ?? 0),
  }));
}

export interface BoothEventRow {
  eventNo: string;
  venue: string;
  firstDate: string;
  lastDate: string;
  omzet: number;
  qty: number;
}

async function _getBoothEvents(f: OrderFilter): Promise<BoothEventRow[]> {
  const where = buildWhere({ ...f, marketplace: "BOOTH" });
  const rows = await getPrisma().$queryRaw<
    { eventNo: string; venue: string; first: Date; last: Date; omzet: string | null; qty: bigint | null }[]
  >(
    Prisma.sql`
      SELECT "orderNo" AS "eventNo", COALESCE(MAX("venue"), '-') AS venue, MIN("orderDate") AS first, MAX("orderDate") AS last,
             SUM("revenue") AS omzet, SUM("qty") AS qty
      FROM "orders" WHERE ${where}
      GROUP BY "orderNo" ORDER BY MIN("orderDate") DESC
      LIMIT 500
    `
  );
  return rows.map((r) => ({
    eventNo: r.eventNo, venue: r.venue,
    firstDate: r.first.toISOString().slice(0, 10), lastDate: r.last.toISOString().slice(0, 10),
    omzet: Number(r.omzet ?? 0), qty: Number(r.qty ?? 0),
  }));
}

export async function getBoothProducts(f: OrderFilter, limit = 15): Promise<ProductRow[]> {
  return getByProduct({ ...f, marketplace: "BOOTH" }, limit);
}

// ---- cache hasil query (data hanya berubah saat import ulang; restart server / TTL membersihkan)
const CACHE_TTL_MS = 30 * 60 * 1000;
const globalCache = globalThis as unknown as { __orderCache?: Map<string, { at: number; v: unknown }> };
const cache = (globalCache.__orderCache ??= new Map());

function memo<A extends unknown[], R>(name: string, fn: (...a: A) => Promise<R>): (...a: A) => Promise<R> {
  return (...a: A) => {
    const key = name + JSON.stringify(a);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.v as Promise<R>;
    // Simpan promise-nya: request bersamaan dengan filter sama berbagi satu query (pool koneksi kecil tidak kebanjiran).
    const v = fn(...a);
    cache.set(key, { at: Date.now(), v });
    v.catch(() => {
      if (cache.get(key)?.v === v) cache.delete(key); // jangan cache kegagalan
    });
    if (cache.size > 500) cache.delete(cache.keys().next().value as string);
    return v;
  };
}

export const getSummary = memo("getSummary", _getSummary);
export const getBreakdown = memo("getBreakdown", _getBreakdown);
export const getByRegion = memo("getByRegion", _getByRegion);
export const getRegionPage = memo("getRegionPage", _getRegionPage);
export const getProductPage = memo("getProductPage", _getProductPage);
export const getLocationGaps = memo("getLocationGaps", _getLocationGaps);
export const getCompleteness = memo("getCompleteness", _getCompleteness);
export const getByProduct = memo("getByProduct", _getByProduct);
export const getUntrackedProduct = memo("getUntrackedProduct", _getUntrackedProduct);
export const getFilterOptions = memo("getFilterOptions", _getFilterOptions);
export const getBoothByMall = memo("getBoothByMall", _getBoothByMall);
export const getBoothEvents = memo("getBoothEvents", _getBoothEvents);
export const searchProductOptionsCached = memo("searchProductOptions", searchProductOptions);
export const searchCityOptionsCached = memo("searchCityOptions", searchCityOptions);
