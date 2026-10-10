"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";

function useParamUpdater() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return React.useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") params.delete(k);
        else params.set(k, v);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );
}

export function TableSearch({ placeholder }: { placeholder: string }) {
  const searchParams = useSearchParams();
  const update = useParamUpdater();
  const [value, setValue] = React.useState(searchParams.get("q") ?? "");

  React.useEffect(() => {
    if (value === (searchParams.get("q") ?? "")) return;
    const t = setTimeout(() => update({ q: value.trim(), page: null }), 400);
    return () => clearTimeout(t);
  }, [value, searchParams, update]);

  return (
    <div className="relative mb-4 w-full sm:max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 dark:text-gray-400" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(
          "w-full rounded-lg border py-2 pl-9 pr-3 text-sm",
          "border-gray-300 bg-white text-gray-900 placeholder:text-gray-500",
          "dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-50 dark:placeholder:text-gray-400",
          "focus:outline-none focus:ring-2 focus:ring-blue-500"
        )}
      />
    </div>
  );
}

export function Pagination({ page, total, pageSize }: { page: number; total: number; pageSize: number }) {
  const update = useParamUpdater();
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  const btn = cn(
    "inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-sm",
    "border-gray-300 text-gray-700 hover:bg-gray-100",
    "dark:border-zinc-700 dark:text-gray-300 dark:hover:bg-zinc-700",
    "disabled:cursor-not-allowed disabled:opacity-50"
  );

  return (
    <div className="mt-4 flex items-center justify-between gap-2">
      <span className="text-sm text-gray-600 dark:text-gray-400">
        Halaman {page} dari {pageCount}
      </span>
      <div className="flex gap-2">
        <button className={btn} disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
          <ChevronLeft className="h-4 w-4" /> Sebelumnya
        </button>
        <button className={btn} disabled={page >= pageCount} onClick={() => update({ page: String(page + 1) })}>
          Berikutnya <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
