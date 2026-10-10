import { EmptyState } from "@/components/empty-state";
import type { BreakdownRow } from "@/lib/orders";
import { formatRupiah, formatAngka, formatPersen } from "@/lib/utils";

const MARKETPLACE_LABEL: Record<string, string> = {
  SHOPEE: "Shopee",
  TIKTOK: "TikTok",
  LAZADA: "Lazada",
  BOOTH: "Booth Mall",
  KOMUNITAS: "Komunitas / Kolaborasi",
  KANTOR: "Kantor / Walk-in",
  CASH_COD: "Cash / COD / Reseller",
  LAINNYA: "Lainnya",
};

export function BreakdownCard({
  title,
  rows,
  prettyMarketplace,
}: {
  title: string;
  rows: BreakdownRow[];
  prettyMarketplace?: boolean;
}) {
  const total = rows.reduce((s, r) => s + r.omzet, 0);
  const max = rows.reduce((m, r) => Math.max(m, r.omzet), 0);

  return (
    <div className="rounded-xl border border-gray-200 bg-card p-4 sm:p-6 dark:border-zinc-700">
      <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-50">{title}</h2>
      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate text-gray-900 dark:text-gray-50">
                  {prettyMarketplace ? MARKETPLACE_LABEL[r.label] ?? r.label : r.label}
                </span>
                <span className="shrink-0 font-medium text-gray-900 dark:text-gray-50">
                  {formatRupiah(r.omzet)}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-zinc-700">
                <div
                  className="h-full rounded-full bg-blue-600 dark:bg-blue-400"
                  style={{ width: `${max > 0 ? Math.max(2, (r.omzet / max) * 100) : 0}%` }}
                />
              </div>
              <div className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                {formatPersen(total > 0 ? r.omzet / total : 0)} dari omzet · {formatAngka(r.orders)} order
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
