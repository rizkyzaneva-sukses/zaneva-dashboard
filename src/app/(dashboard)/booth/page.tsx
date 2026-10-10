import { Wallet, Package2, Store, CalendarDays } from "lucide-react";
import { FilterBar } from "@/components/filter-bar";
import { EmptyState } from "@/components/empty-state";
import { KpiCard } from "@/components/kpi-card";
import { getBoothByMall, getBoothEvents, getBoothProducts, getFilterOptions } from "@/lib/orders";
import { filterFromSearchParams, type SearchParams } from "@/lib/filters";
import { formatRupiah, formatAngka } from "@/lib/utils";
import { requireUser } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

const CARD = "rounded-xl border border-gray-200 bg-card p-4 sm:p-6 dark:border-zinc-700";
const TH = "pb-2 font-medium";
const ROW = "border-b border-gray-100 last:border-0 dark:border-zinc-800";
const HEAD = "border-b border-gray-200 text-left text-gray-600 dark:border-zinc-700 dark:text-gray-400";

export default async function BoothPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireUser();
  const filter = filterFromSearchParams(await searchParams);
  const [malls, events, products, options] = await Promise.all([
    getBoothByMall(filter),
    getBoothEvents(filter),
    getBoothProducts(filter, 15),
    getFilterOptions(),
  ]);
  const omzet = malls.reduce((s, m) => s + m.omzet, 0);
  const qty = malls.reduce((s, m) => s + m.qty, 0);
  const days = malls.reduce((s, m) => s + m.days, 0);

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900 dark:text-gray-50">Booth Mall</h1>
      <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
        Penjualan booth dipisah dari penjualan online. Lokasi = mall tempat booth, bukan asal pembeli, jadi tidak ikut
        ranking Kota & Kecamatan. Dipakai untuk membandingkan mall dan kota sebelum membuka booth baru.
      </p>

      <FilterBar {...options} />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
        <KpiCard label="Omzet Booth" value={formatRupiah(omzet)} icon={Wallet} />
        <KpiCard label="Qty Terjual" value={formatAngka(qty)} icon={Package2} />
        <KpiCard label="Jumlah Mall" value={formatAngka(malls.length)} icon={Store} />
        <KpiCard label="Hari Booth Buka" value={formatAngka(days)} icon={CalendarDays} />
      </div>

      <div className={`${CARD} mb-4`}>
        <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-50">Per Mall</h2>
        {malls.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={HEAD}>
                  <th className={TH}>Mall</th>
                  <th className={TH}>Kota</th>
                  <th className={TH}>Kecamatan</th>
                  <th className={`${TH} text-right`}>Hari buka</th>
                  <th className={`${TH} text-right`}>Qty</th>
                  <th className={`${TH} text-right`}>Omzet</th>
                  <th className={`${TH} text-right`}>Omzet / hari</th>
                </tr>
              </thead>
              <tbody>
                {malls.map((m) => (
                  <tr key={m.venue} className={ROW}>
                    <td className="py-2 pr-2 text-gray-900 dark:text-gray-50">{m.venue}</td>
                    <td className="py-2 pr-2 text-gray-700 dark:text-gray-300">{m.city}</td>
                    <td className="py-2 pr-2 text-gray-700 dark:text-gray-300">{m.district}</td>
                    <td className="py-2 text-right text-gray-700 dark:text-gray-300">{formatAngka(m.days)}</td>
                    <td className="py-2 text-right text-gray-700 dark:text-gray-300">{formatAngka(m.qty)}</td>
                    <td className="py-2 text-right font-medium text-gray-900 dark:text-gray-50">{formatRupiah(m.omzet)}</td>
                    <td className="py-2 text-right text-gray-700 dark:text-gray-300">
                      {formatRupiah(m.days > 0 ? m.omzet / m.days : 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={CARD}>
          <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-50">Per Event (nomor order booth)</h2>
          {events.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={HEAD}>
                    <th className={TH}>Event</th>
                    <th className={TH}>Mall</th>
                    <th className={TH}>Tanggal</th>
                    <th className={`${TH} text-right`}>Qty</th>
                    <th className={`${TH} text-right`}>Omzet</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.eventNo} className={ROW}>
                      <td className="py-2 pr-2 text-gray-900 dark:text-gray-50">{e.eventNo}</td>
                      <td className="py-2 pr-2 text-gray-700 dark:text-gray-300">{e.venue}</td>
                      <td className="whitespace-nowrap py-2 pr-2 text-gray-700 dark:text-gray-300">
                        {e.firstDate === e.lastDate ? e.firstDate : `${e.firstDate} s/d ${e.lastDate}`}
                      </td>
                      <td className="py-2 text-right text-gray-700 dark:text-gray-300">{formatAngka(e.qty)}</td>
                      <td className="py-2 text-right font-medium text-gray-900 dark:text-gray-50">{formatRupiah(e.omzet)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className={CARD}>
          <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-50">Produk Terlaris di Booth</h2>
          {products.length === 0 ? (
            <EmptyState />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className={HEAD}>
                  <th className={TH}>Produk</th>
                  <th className={`${TH} text-right`}>Qty</th>
                  <th className={`${TH} text-right`}>Omzet</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.sku} className={ROW}>
                    <td className="py-2 pr-2 text-gray-900 dark:text-gray-50">{p.sku}</td>
                    <td className="py-2 text-right text-gray-700 dark:text-gray-300">{formatAngka(p.qty)}</td>
                    <td className="py-2 text-right font-medium text-gray-900 dark:text-gray-50">{formatRupiah(p.omzet)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
