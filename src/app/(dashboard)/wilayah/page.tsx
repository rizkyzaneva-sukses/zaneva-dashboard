import Link from "next/link";
import { FilterBar } from "@/components/filter-bar";
import { EmptyState } from "@/components/empty-state";
import { Pagination, TableSearch } from "@/components/table-controls";
import {
  PAGE_SIZE,
  getRegionPage,
  getLocationGaps,
  getFilterOptions,
  type RegionLevel,
} from "@/lib/orders";
import { filterFromSearchParams, pageParam, param, searchParam, type SearchParams } from "@/lib/filters";
import { cn, formatRupiah, formatAngka } from "@/lib/utils";
import { requireUser } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

function levelHref(sp: SearchParams, level: RegionLevel) {
  const params = new URLSearchParams();
  for (const k of Object.keys(sp)) {
    const v = param(sp, k);
    if (v && k !== "page" && k !== "level") params.set(k, v);
  }
  params.set("level", level);
  return `/wilayah?${params.toString()}`;
}

export default async function WilayahPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireUser();
  const sp = await searchParams;
  const filter = filterFromSearchParams(sp);
  const level: RegionLevel = param(sp, "level", 10) === "kota" ? "kota" : "kecamatan";
  const page = pageParam(sp);
  const q = searchParam(sp);

  const [result, gaps, options] = await Promise.all([
    getRegionPage(filter, page, level, q),
    getLocationGaps(filter),
    getFilterOptions(),
  ]);
  const offset = (page - 1) * PAGE_SIZE;
  const notCounted = level === "kecamatan" ? gaps.unknownOmzet + gaps.noDistrictOmzet : gaps.unknownOmzet;

  const tab = (active: boolean) =>
    cn(
      "rounded-lg border px-3 py-1.5 text-sm font-medium",
      active
        ? "border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/40 dark:text-blue-300"
        : "border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-zinc-700 dark:text-gray-300 dark:hover:bg-zinc-700"
    );

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900 dark:text-gray-50">Kota & Kecamatan</h1>
      <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
        {formatAngka(gaps.cities)} kota/kabupaten dan {formatAngka(gaps.districts)} kecamatan sesuai filter.
        Hanya baris dengan data lokasi lengkap yang dihitung di halaman ini. Penjualan booth/offline tidak ikut (lihat menu Booth Mall), jadi angka di sini murni asal pembeli online.
      </p>

      <FilterBar {...options} />

      <div className="mb-4 flex gap-2">
        <Link href={levelHref(sp, "kecamatan")} className={tab(level === "kecamatan")}>
          Per Kecamatan
        </Link>
        <Link href={levelHref(sp, "kota")} className={tab(level === "kota")}>
          Per Kota
        </Link>
      </div>

      {notCounted > 0 && (
        <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">
          {formatRupiah(notCounted)} tidak dihitung di tabel ini karena{" "}
          {level === "kecamatan" ? "kota atau kecamatannya kosong" : "kotanya kosong"}. Baris itu tetap dihitung di
          halaman lain yang datanya lengkap (mis. Produk Ranking). Rinciannya ada di{" "}
          <Link href="/kelengkapan" className="font-medium underline">
            Data Tidak Komplit
          </Link>
          .
        </p>
      )}

      <TableSearch placeholder="Cari kota atau kecamatan..." />

      <div className="rounded-xl border border-gray-200 bg-card p-4 sm:p-6 dark:border-zinc-700">
        {result.rows.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-600 dark:border-zinc-700 dark:text-gray-400">
                  <th className="pb-2 font-medium">#</th>
                  <th className="pb-2 font-medium">Kota/Kabupaten</th>
                  {level === "kecamatan" && <th className="pb-2 font-medium">Kecamatan</th>}
                  <th className="pb-2 font-medium">Provinsi</th>
                  <th className="pb-2 text-right font-medium">Order</th>
                  <th className="pb-2 text-right font-medium">Omzet</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={`${r.city}-${r.district}-${i}`} className="border-b border-gray-100 last:border-0 dark:border-zinc-800">
                    <td className="py-2 pr-2 text-gray-600 dark:text-gray-400">{offset + i + 1}</td>
                    <td className="py-2 pr-2 text-gray-900 dark:text-gray-50">{r.city}</td>
                    {level === "kecamatan" && (
                      <td className="py-2 pr-2 text-gray-700 dark:text-gray-300">{r.district}</td>
                    )}
                    <td className="py-2 pr-2 text-gray-700 dark:text-gray-300">{r.province ?? "-"}</td>
                    <td className="py-2 text-right text-gray-700 dark:text-gray-300">{formatAngka(r.orders)}</td>
                    <td className="py-2 text-right font-medium text-gray-900 dark:text-gray-50">
                      {formatRupiah(r.omzet)}
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
