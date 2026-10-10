import { FilterBar } from "@/components/filter-bar";
import { EmptyState } from "@/components/empty-state";
import { Pagination, TableSearch } from "@/components/table-controls";
import {
  PAGE_SIZE,
  getProductPage,
  getFilterOptions,
  getUntrackedProduct,
} from "@/lib/orders";
import { filterFromSearchParams, pageParam, searchParam, type SearchParams } from "@/lib/filters";
import { formatRupiah, formatAngka } from "@/lib/utils";
import { requireUser } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export default async function ProdukPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();
  const sp = await searchParams;
  const filter = filterFromSearchParams(sp);
  const page = pageParam(sp);
  const q = searchParam(sp);

  const [result, untracked, options] = await Promise.all([
    getProductPage(filter, page, q),
    getUntrackedProduct(filter),
    getFilterOptions(),
  ]);
  const offset = (page - 1) * PAGE_SIZE;

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900 dark:text-gray-50">Produk Ranking</h1>
      <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
        {formatAngka(result.total)} produk{q ? ` yang cocok dengan "${q}"` : ""}, diurutkan berdasarkan omzet
      </p>

      <FilterBar {...options} />

      {untracked.omzet > 0 && !q && (
        <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">
          {formatRupiah(untracked.omzet)} ({formatAngka(untracked.orders)} order) tidak ikut ranking karena
          nama produknya kosong di data sumber. Angka ini tetap masuk ke Total Omzet. Daftar barisnya ada di
          file AUDIT - data yang perlu dicek.xlsx.
        </p>
      )}

      <TableSearch placeholder="Cari nama produk..." />

      <div className="rounded-xl border border-gray-200 bg-card p-4 sm:p-6 dark:border-zinc-700">
        {result.rows.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-600 dark:border-zinc-700 dark:text-gray-400">
                  <th className="pb-2 font-medium">#</th>
                  <th className="pb-2 font-medium">Produk (SKU master)</th>
                  <th className="pb-2 font-medium">Kategori</th>
                  <th className="pb-2 text-right font-medium">Order</th>
                  <th className="pb-2 text-right font-medium">Qty</th>
                  <th className="pb-2 text-right font-medium">Omzet</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((p, i) => (
                  <tr key={p.sku} className="border-b border-gray-100 last:border-0 dark:border-zinc-800">
                    <td className="py-2 pr-2 text-gray-600 dark:text-gray-400">{offset + i + 1}</td>
                    <td className="py-2 pr-2 text-gray-900 dark:text-gray-50">{p.sku}</td>
                    <td className="py-2 pr-2 text-gray-700 dark:text-gray-300">{p.category ?? "(di luar master)"}</td>
                    <td className="py-2 text-right text-gray-700 dark:text-gray-300">{formatAngka(p.orders)}</td>
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
        <Pagination page={page} total={result.total} pageSize={PAGE_SIZE} />
      </div>
    </div>
  );
}
