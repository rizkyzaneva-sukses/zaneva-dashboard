import { FilterBar } from "@/components/filter-bar";
import { EmptyState } from "@/components/empty-state";
import { getCompleteness, getFilterOptions, getReviewItems, type CompletenessGroup } from "@/lib/orders";
import { filterFromSearchParams, type SearchParams } from "@/lib/filters";
import { formatRupiah, formatAngka, formatPersen } from "@/lib/utils";
import { requireUser } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

const card = "rounded-xl border border-gray-200 bg-card p-4 sm:p-6 dark:border-zinc-700";
const th = "pb-2 font-medium";
const thHead = "border-b border-gray-200 text-left text-gray-600 dark:border-zinc-700 dark:text-gray-400";
const tr = "border-b border-gray-100 last:border-0 dark:border-zinc-800";

function sum(groups: CompletenessGroup[], test: (g: CompletenessGroup) => boolean) {
  return groups.filter(test).reduce(
    (a, g) => ({ rows: a.rows + g.rows, orders: a.orders + g.orders, omzet: a.omzet + g.omzet }),
    { rows: 0, orders: 0, omzet: 0 }
  );
}

const yesNo = (v: boolean) => (v ? "Ada" : "Kosong");

export default async function KelengkapanPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireUser();
  const filter = filterFromSearchParams(await searchParams);
  const [groups, options, belum, otomatis] = await Promise.all([
    getCompleteness(filter),
    getFilterOptions(),
    getReviewItems("BELUM_COCOK", 30),
    getReviewItems("OTOMATIS", 15),
  ]);

  const total = sum(groups, () => true);
  const pct = (v: number) => formatPersen(total.omzet > 0 ? v / total.omzet : 0);

  const dims = [
    { label: "Nama produk", ok: (g: CompletenessGroup) => g.hasProduct, used: "Produk Ranking" },
    { label: "Cocok dengan master produk (SKU & kategori)", ok: (g: CompletenessGroup) => g.inMaster, used: "Omzet per Kategori, Produk Ranking (kolom Kategori)" },
    { label: "Kota / kabupaten", ok: (g: CompletenessGroup) => g.hasCity, used: "Kota & Kecamatan (Per Kota)" },
    { label: "Kecamatan", ok: (g: CompletenessGroup) => g.hasDistrict, used: "Kota & Kecamatan (Per Kecamatan)" },
  ];

  const patterns = [
    { hp: true, hc: true, hd: true, note: "Lengkap", used: "Semua halaman" },
    { hp: true, hc: true, hd: false, note: "Ada produk & kota, kecamatan kosong", used: "Produk, Kota (Per Kota). Tidak di Per Kecamatan" },
    { hp: true, hc: false, hd: false, note: "Ada produk, lokasi kosong", used: "Produk saja" },
    { hp: false, hc: true, hd: true, note: "Ada kota & kecamatan, produk kosong", used: "Kota & Kecamatan saja" },
    { hp: false, hc: true, hd: false, note: "Ada kota, produk & kecamatan kosong", used: "Kota (Per Kota) saja" },
    { hp: false, hc: false, hd: false, note: "Produk dan lokasi sama-sama kosong", used: "Hanya Total Omzet" },
  ].map((p) => ({ ...p, ...sum(groups, (g) => g.hasProduct === p.hp && g.hasCity === p.hc && g.hasDistrict === p.hd) }));

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-gray-900 dark:text-gray-50">Data Tidak Komplit</h1>
      <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
        Setiap halaman hanya menghitung baris yang datanya lengkap untuk halaman itu. Baris yang tidak lengkap
        tidak dibuang: tetap masuk Total Omzet dan halaman lain yang datanya lengkap. Semua yang ambigu dicatat di
        sini untuk Anda konfirmasi.
      </p>

      <FilterBar {...options} />

      <div className={`${card} mb-4`}>
        <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-50">Kelengkapan per jenis data</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={thHead}>
                <th className={th}>Data</th>
                <th className={`${th} pr-3 text-right`}>Lengkap</th>
                <th className={`${th} pr-3 text-right`}>Tidak lengkap</th>
                <th className={th}>Dipakai di</th>
              </tr>
            </thead>
            <tbody>
              {dims.map((d) => {
                const ok = sum(groups, d.ok);
                const miss = sum(groups, (g) => !d.ok(g));
                return (
                  <tr key={d.label} className={tr}>
                    <td className="py-2 pr-3 text-gray-900 dark:text-gray-50">{d.label}</td>
                    <td className="py-2 pr-3 text-right text-gray-900 dark:text-gray-50">
                      {formatRupiah(ok.omzet)} <span className="text-gray-600 dark:text-gray-400">({pct(ok.omzet)})</span>
                    </td>
                    <td className="py-2 pr-3 text-right font-medium text-amber-800 dark:text-amber-300">
                      {formatRupiah(miss.omzet)} <span className="font-normal">({pct(miss.omzet)})</span>
                      <div className="text-xs font-normal text-gray-600 dark:text-gray-400">
                        {formatAngka(miss.rows)} baris · {formatAngka(miss.orders)} order
                      </div>
                    </td>
                    <td className="py-2 text-gray-700 dark:text-gray-300">{d.used}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`${card} mb-4`}>
        <h2 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-50">Kombinasi data yang ada dan kosong</h2>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
          Contoh: ada kota dan kecamatan tapi produk kosong dihitung di Kota & Kecamatan, tidak di Produk.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={thHead}>
                <th className={th}>Pola</th>
                <th className={th}>Produk</th>
                <th className={th}>Kota</th>
                <th className={th}>Kecamatan</th>
                <th className={`${th} pr-3 text-right`}>Baris</th>
                <th className={`${th} pr-3 text-right`}>Omzet</th>
                <th className={th}>Dihitung di</th>
              </tr>
            </thead>
            <tbody>
              {patterns.map((p) => (
                <tr key={p.note} className={tr}>
                  <td className="py-2 pr-3 text-gray-900 dark:text-gray-50">{p.note}</td>
                  <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{yesNo(p.hp)}</td>
                  <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{yesNo(p.hc)}</td>
                  <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{yesNo(p.hd)}</td>
                  <td className="py-2 pr-3 text-right text-gray-700 dark:text-gray-300">{formatAngka(p.rows)}</td>
                  <td className="py-2 pr-3 text-right font-medium text-gray-900 dark:text-gray-50">
                    {formatRupiah(p.omzet)} <span className="font-normal text-gray-600 dark:text-gray-400">({pct(p.omzet)})</span>
                  </td>
                  <td className="py-2 text-gray-700 dark:text-gray-300">{p.used}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`${card} mb-4`}>
        <h2 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-50">
          Perlu keputusan: nama produk yang ambigu
        </h2>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
          {formatAngka(belum.total)} nama, {formatRupiah(belum.omzet)}. Yang terbesar ditampilkan. Isi kolom FINAL SKU di file
          BERESIN-2 keputusan produk untuk mengonfirmasi.
        </p>
        {belum.items.length === 0 ? (
          <EmptyState text="Tidak ada yang perlu dikonfirmasi" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={thHead}>
                  <th className={th}>Nama di data</th>
                  <th className={`${th} pr-3 text-right`}>Baris</th>
                  <th className={`${th} pr-3 text-right`}>Omzet</th>
                  <th className={th}>Usulan SKU master</th>
                  <th className={th}>Alasan</th>
                </tr>
              </thead>
              <tbody>
                {belum.items.map((i) => (
                  <tr key={i.id} className={tr}>
                    <td className="py-2 pr-3 text-gray-900 dark:text-gray-50">{i.name}</td>
                    <td className="py-2 pr-3 text-right text-gray-700 dark:text-gray-300">{formatAngka(i.rows)}</td>
                    <td className="py-2 pr-3 text-right font-medium text-gray-900 dark:text-gray-50">{formatRupiah(i.omzet)}</td>
                    <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{i.suggestions || "-"}</td>
                    <td className="py-2 text-gray-700 dark:text-gray-300">{i.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={`${card} mb-4`}>
        <h2 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-50">
          Info: nama produk yang dicocokkan otomatis (dianggap benar)
        </h2>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
          {formatAngka(otomatis.total)} nama, {formatRupiah(otomatis.omzet)}. Diputuskan otomatis dari kata depan dan
          singkatan; tidak perlu dicek kecuali Anda menemukan yang salah.
        </p>
        {otomatis.items.length === 0 ? (
          <EmptyState text="Tidak ada" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={thHead}>
                  <th className={th}>Nama di data</th>
                  <th className={`${th} pr-3 text-right`}>Baris</th>
                  <th className={`${th} pr-3 text-right`}>Omzet</th>
                  <th className={th}>Dicocokkan ke</th>
                  <th className={th}>Cara cocok</th>
                </tr>
              </thead>
              <tbody>
                {otomatis.items.map((i) => (
                  <tr key={i.id} className={tr}>
                    <td className="py-2 pr-3 text-gray-900 dark:text-gray-50">{i.name}</td>
                    <td className="py-2 pr-3 text-right text-gray-700 dark:text-gray-300">{formatAngka(i.rows)}</td>
                    <td className="py-2 pr-3 text-right font-medium text-gray-900 dark:text-gray-50">{formatRupiah(i.omzet)}</td>
                    <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{i.resultSku}</td>
                    <td className="py-2 text-gray-700 dark:text-gray-300">{i.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={card}>
        <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-50">Aturan yang sedang dipakai</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
          <li>Operator = nama operator di platform (DITA, YUNI, TRINDA, DILLA, MARIS); kalau tidak tertulis diambil dari kolom PENGINPUT; kalau tetap tidak ada = ZANEVA.</li>
          <li>Brand = isi tanda kurung; tanpa kurung = ZANEVA, kecuali nama toko itu sendiri brand (OBERBE, BESYARI, MUSWIM, ELYASR).</li>
          <li>Nomor order ZNV-PVJ / CIWALK / TSM / BRAGA = channel Booth Mall; ZNV-PUNDFIT = Komunitas / Kolaborasi. Lokasinya lokasi acara, jadi tidak dihitung di Kota & Kecamatan.</li>
          <li>Nomor order ZNV-CODOFFICE = channel Kantor / Walk-in (lokasi kantor Cimahi tetap dihitung di Kota & Kecamatan).</li>
          <li>Paket &quot;A + B&quot; dipecah: omzet dibagi rata, qty tiap produk sama dengan qty paket.</li>
          <li>Retur dan dispute kalah tidak dihitung sebagai omzet.</li>
          <li>Nama produk dicocokkan ke master lewat kata depan; ukuran Jumbo/Extra harus sama. Singkatan tim: BD = Bergo Diamond, Jum = Jumbo, D.Pink = Dusty Pink.</li>
          <li>Nama yang tidak mirip SKU master mana pun dianggap produk baru (kategori &quot;(di luar master)&quot;), tidak perlu keputusan.</li>
          <li>Daftar baris lengkap (per pesanan) ada di file AUDIT - data yang perlu dicek.xlsx.</li>
        </ul>
      </div>
    </div>
  );
}
