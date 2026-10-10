import type { OrderFilter } from "@/lib/orders";
import { resolvePreset } from "@/lib/date-presets";

/** Next.js memberi string[] kalau key yang sama muncul berulang (?q=a&q=b). */
export type SearchParams = Record<string, string | string[] | undefined>;

export const MAX_PARAM_LENGTH = 200;
export const MAX_SEARCH_LENGTH = 100;
/** Batas halaman: OFFSET besar memaksa Postgres memindai semua baris di depannya. */
export const MAX_PAGE = 2000;

/** Ambil satu nilai string dari searchParams (nilai pertama bila berulang), dipotong ke panjang maksimal. */
export function param(sp: SearchParams, key: string, max = MAX_PARAM_LENGTH): string | undefined {
  const raw = sp[key];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== "string") return undefined;
  const s = v.slice(0, max);
  return s === "" ? undefined : s;
}

/** Nomor halaman aman: bilangan bulat 1..MAX_PAGE, NaN/negatif/berlebihan jadi 1 atau batas atas. */
export function pageParam(sp: SearchParams): number {
  const n = Number.parseInt(param(sp, "page", 10) ?? "1", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_PAGE);
}

/** Kata kunci pencarian tabel (q), di-trim dan dibatasi panjangnya. */
export function searchParam(sp: SearchParams): string | undefined {
  return param(sp, "q", MAX_SEARCH_LENGTH)?.trim() || undefined;
}

/** Hanya terima YYYY-MM-DD yang benar-benar tanggal valid; selain itu diabaikan. */
export function validDate(v: string | undefined): string | undefined {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(v + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return undefined;
  return v;
}

export function filterFromSearchParams(sp: SearchParams): OrderFilter {
  const { from, to } = resolvePreset(
    param(sp, "preset", 20) ?? "all",
    validDate(param(sp, "from", 10)),
    validDate(param(sp, "to", 10))
  );
  return {
    from: validDate(from),
    to: validDate(to),
    brand: param(sp, "brand") ?? null,
    marketplace: param(sp, "marketplace", 20) ?? null,
    account: param(sp, "account") ?? null,
    province: param(sp, "province") ?? null,
    city: param(sp, "city") ?? null,
    category: param(sp, "category") ?? null,
    sku: param(sp, "sku") ?? null,
  };
}
