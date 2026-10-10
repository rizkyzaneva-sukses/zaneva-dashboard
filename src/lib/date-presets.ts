import { startOfMonth, endOfMonth, subMonths, startOfYear, subDays, format } from "date-fns";
import { tanggalWIB } from "@/lib/utils";

export const PRESET_OPTIONS = [
  { value: "7d", label: "7 Hari Terakhir" },
  { value: "30d", label: "30 Hari Terakhir" },
  { value: "month", label: "Bulan Ini" },
  { value: "last_month", label: "Bulan Lalu" },
  { value: "year", label: "Tahun Ini" },
  { value: "all", label: "Semua Waktu" },
  { value: "custom", label: "Custom" },
];

export function resolvePreset(
  preset: string,
  customFrom?: string,
  customTo?: string
): { from?: string; to?: string } {
  // "Hari ini" mengikuti WIB, bukan zona waktu server (container biasanya UTC, selisih 7 jam).
  const [y, m, d] = tanggalWIB().split("-").map(Number);
  const now = new Date(y, m - 1, d);
  const today = format(now, "yyyy-MM-dd");
  switch (preset) {
    case "7d":
      return { from: format(subDays(now, 6), "yyyy-MM-dd"), to: today };
    case "30d":
      return { from: format(subDays(now, 29), "yyyy-MM-dd"), to: today };
    case "month":
      return { from: format(startOfMonth(now), "yyyy-MM-dd"), to: today };
    case "last_month": {
      const lm = subMonths(now, 1);
      return { from: format(startOfMonth(lm), "yyyy-MM-dd"), to: format(endOfMonth(lm), "yyyy-MM-dd") };
    }
    case "year":
      return { from: format(startOfYear(now), "yyyy-MM-dd"), to: today };
    case "custom":
      return { from: customFrom, to: customTo };
    case "all":
    default:
      return {};
  }
}
