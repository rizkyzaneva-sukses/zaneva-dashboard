import Link from "next/link";
import { Wallet, ShoppingBag, Package2 } from "lucide-react";
import { FilterBar } from "@/components/filter-bar";
import { KpiCard } from "@/components/kpi-card";
import { EmptyState } from "@/components/empty-state";
import { BreakdownCard } from "@/components/breakdown-card";
import {
  getSummary,
  getByProduct,
  getByRegion,
  getBreakdown,
  getFilterOptions,
} from "@/lib/orders";
import { filterFromSearchParams, type SearchParams } from "@/lib/filters";
import { formatRupiah, formatAngka } from "@/lib/utils";
import { requireUser } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();
  const filter = filterFromSearchParams(await searchParams);

  const [summary, topProducts, topRegions, byBrand, byMarketplace, byAccount, byCategory, byVenue, options] =
    await Promise.all([
      getSummary(filter),
      getByProduct(filter, 10),
      getByRegion(filter, 10),
      getBreakdown(filter, "brand"),
      getBreakdown(filter, "marketplace"),
      getBreakdown(filter, "account"),
      getBreakdown(filter, "category"),
      getBreakdown(filter, "venue"),
      getFilterOptions(),
    ]);

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900 dark:text-gray-50">Dashboard</h1>
      <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
        Ringkasan omzet konsolidasi semua brand & marketplace
      </p>

      <FilterBar {...options} />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Total Omzet" value={formatRupiah(summary.omzet)} icon={Wallet} />
        <KpiCard label="Total Order" value={formatAngka(summary.orders)} icon={ShoppingBag} />
        <KpiCard label="Total Qty Terjual" value={formatAngka(summary.qty)} icon={Package2} />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BreakdownCard title="Omzet per Brand" rows={byBrand} />
        <BreakdownCard title="Omzet per Kategori Produk" rows={byCategory} />
        <BreakdownCard title="Omzet per Channel Penjualan" rows={byMarketplace} prettyMarketplace />
        <BreakdownCard title="Omzet per Operator" rows={byAccount} />
        {byVenue.length > 0 && <BreakdownCard title="Omzet Booth per Mall" rows={byVenue} />}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-card p-4 sm:p-6 dark:border-zinc-700">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Produk Terlaris</h2>
            <Link href="/produk" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
              Lihat semua
            </Link>
          </div>
          {topProducts.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-600 dark:border-zinc-700 dark:text-gray-400">
                    <th className="pb-2 font-medium">Produk</th>
                    <th className="pb-2 text-right font-medium">Qty</th>
                    <th className="pb-2 text-right font-medium">Omzet</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((p) => (
                    <tr key={p.sku} className="border-b border-gray-100 last:border-0 dark:border-zinc-800">
                      <td className="py-2 pr-2 text-gray-900 dark:text-gray-50">{p.sku}</td>
                      <td className="py-2 text-right text-gray-700 dark:text-gray-300">{formatAngka(p.qty)}</td>
                      <td className="py-2 text-right font-medium text-gray-900 dark:text-gray-50">
                        {formatRupiah(p.omzet)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-card p-4 sm:p-6 dark:border-zinc-700">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Kota / Kecamatan Teratas</h2>
            <Link href="/wilayah" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
              Lihat semua
            </Link>
          </div>
          {topRegions.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-600 dark:border-zinc-700 dark:text-gray-400">
                    <th className="pb-2 font-medium">Kota</th>
                    <th className="pb-2 font-medium">Kecamatan</th>
                    <th className="pb-2 text-right font-medium">Omzet</th>
                  </tr>
                </thead>
                <tbody>
                  {topRegions.map((r, i) => (
                    <tr key={`${r.city}-${r.district}-${i}`} className="border-b border-gray-100 last:border-0 dark:border-zinc-800">
                      <td className="py-2 pr-2 text-gray-900 dark:text-gray-50">{r.city}</td>
                      <td className="py-2 pr-2 text-gray-700 dark:text-gray-300">{r.district ?? "-"}</td>
                      <td className="py-2 text-right font-medium text-gray-900 dark:text-gray-50">
                        {formatRupiah(r.omzet)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
