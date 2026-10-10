"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { SearchableSelect, type SelectOption } from "@/components/ui/searchable-select";
import { PRESET_OPTIONS } from "@/lib/date-presets";
import { cn } from "@/lib/utils";

const MARKETPLACE_OPTIONS: SelectOption[] = [
  { value: "SHOPEE", label: "Shopee" },
  { value: "TIKTOK", label: "TikTok" },
  { value: "LAZADA", label: "Lazada" },
  { value: "BOOTH", label: "Booth Mall" },
  { value: "KOMUNITAS", label: "Komunitas / Kolaborasi" },
  { value: "KANTOR", label: "Kantor / Walk-in" },
  { value: "CASH_COD", label: "Cash / COD / Reseller" },
  { value: "LAINNYA", label: "Lainnya" },
];

const toOptions = (list: string[]): SelectOption[] => list.map((v) => ({ value: v, label: v }));

function useRemoteOptions(endpoint: string, selected: string | null, extra: string | null = null) {
  const [options, setOptions] = React.useState<SelectOption[]>(
    selected ? [{ value: selected, label: selected }] : []
  );

  const search = React.useCallback(
    (q: string) => {
      const params = new URLSearchParams({ q });
      if (extra) params.set("province", extra);
      fetch(`${endpoint}?${params.toString()}`)
        .then((r) => r.json())
        .then((d) => {
          const list: SelectOption[] = d.options ?? [];
          const withSelected =
            selected && !list.some((o) => o.value === selected)
              ? [{ value: selected, label: selected }, ...list]
              : list;
          setOptions(withSelected);
        })
        .catch(() => {});
    },
    [endpoint, selected, extra]
  );

  React.useEffect(() => {
    search("");
  }, [search]);

  return { options, search };
}

export function FilterBar({
  brands,
  accounts,
  provinces,
  categories,
}: {
  brands: string[];
  accounts: string[];
  provinces: string[];
  categories: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const preset = searchParams.get("preset") ?? "all";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const brand = searchParams.get("brand");
  const marketplace = searchParams.get("marketplace");
  const account = searchParams.get("account");
  const category = searchParams.get("category");
  const province = searchParams.get("province");
  const city = searchParams.get("city");
  const sku = searchParams.get("sku");

  const products = useRemoteOptions("/api/meta/products", sku);
  const cities = useRemoteOptions("/api/meta/cities", city, province);

  function updateParams(patch: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  const dateInputClass = cn(
    "w-full rounded-lg border px-3 py-2 text-sm",
    "border-gray-300 bg-white text-gray-900",
    "dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-50",
    "focus:outline-none focus:ring-2 focus:ring-blue-500"
  );

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-card p-4 dark:border-zinc-700">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SearchableSelect
          label="Periode"
          value={preset}
          onChange={(v) => updateParams({ preset: v, from: null, to: null })}
          options={PRESET_OPTIONS}
          placeholder="Pilih periode"
        />
        <SearchableSelect
          label="Brand"
          value={brand}
          onChange={(v) => updateParams({ brand: v })}
          options={toOptions(brands)}
          placeholder="Semua brand"
          emptyText="Brand tidak ditemukan"
        />
        <SearchableSelect
          label="Channel Penjualan"
          value={marketplace}
          onChange={(v) => updateParams({ marketplace: v })}
          options={MARKETPLACE_OPTIONS}
          placeholder="Semua channel"
        />
        <SearchableSelect
          label="Operator"
          value={account}
          onChange={(v) => updateParams({ account: v })}
          options={toOptions(accounts)}
          placeholder="Semua operator"
          emptyText="Operator tidak ditemukan"
        />
        <SearchableSelect
          label="Provinsi"
          value={province}
          onChange={(v) => updateParams({ province: v, city: null })}
          options={toOptions(provinces)}
          placeholder="Semua provinsi"
          emptyText="Provinsi tidak ditemukan"
        />
        <SearchableSelect
          label="Kota / Kabupaten"
          value={city}
          onChange={(v) => updateParams({ city: v })}
          options={cities.options}
          onSearch={cities.search}
          placeholder="Semua kota"
          searchPlaceholder="Cari kota..."
          emptyText="Kota tidak ditemukan"
        />
        <SearchableSelect
          label="Kategori Produk"
          value={category}
          onChange={(v) => updateParams({ category: v })}
          options={toOptions(categories)}
          placeholder="Semua kategori"
          emptyText="Kategori tidak ditemukan"
        />
        <SearchableSelect
          label="Produk"
          value={sku}
          onChange={(v) => updateParams({ sku: v })}
          options={products.options}
          onSearch={products.search}
          placeholder="Semua produk"
          searchPlaceholder="Cari nama produk..."
          emptyText="Produk tidak ditemukan"
        />
      </div>

      {preset === "custom" && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:w-1/2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Dari tanggal
            </label>
            <input type="date" value={from} onChange={(e) => updateParams({ from: e.target.value })} className={dateInputClass} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Sampai tanggal
            </label>
            <input type="date" value={to} onChange={(e) => updateParams({ to: e.target.value })} className={dateInputClass} />
          </div>
        </div>
      )}
    </div>
  );
}
