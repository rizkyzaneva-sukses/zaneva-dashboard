import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const TZ = "Asia/Jakarta";

/** Rp 1.250.000 — tanpa desimal */
export function formatRupiah(nilai: number | string | null | undefined): string {
  const angka = Number(nilai ?? 0);
  if (!Number.isFinite(angka)) return "Rp 0";
  return "Rp " + new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(angka);
}

/** 1.250.000 */
export function formatAngka(nilai: number | string | null | undefined, desimal = 0): string {
  const angka = Number(nilai ?? 0);
  if (!Number.isFinite(angka)) return "0";
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: desimal,
    maximumFractionDigits: desimal,
  }).format(angka);
}

/** 12,3% — input berupa rasio (0.123) */
export function formatPersen(rasio: number, desimal = 1): string {
  return formatAngka(rasio * 100, desimal) + "%";
}

/** 20 Agu 2026 (WIB) */
export function formatTanggal(tanggal: Date | string | null | undefined): string {
  if (!tanggal) return "-";
  const d = typeof tanggal === "string" ? new Date(tanggal) : tanggal;
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric", month: "short", year: "numeric", timeZone: TZ,
  }).format(d);
}

/** 'YYYY-MM-DD' menurut WIB */
export function tanggalWIB(tanggal: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: TZ,
  }).format(tanggal);
}
