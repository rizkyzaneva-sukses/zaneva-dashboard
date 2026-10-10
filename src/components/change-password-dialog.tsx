"use client";

import * as React from "react";
import { KeyRound, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const inputCls = cn(
  "w-full rounded-lg border px-3 py-2 text-sm",
  "border-gray-300 bg-white text-gray-900 placeholder:text-gray-500",
  "dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-50 dark:placeholder:text-gray-400",
  "focus:outline-none focus:ring-2 focus:ring-blue-500"
);

export function ChangePasswordDialog() {
  const [open, setOpen] = React.useState(false);
  const [lama, setLama] = React.useState("");
  const [baru, setBaru] = React.useState("");
  const [konfirmasi, setKonfirmasi] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  function resetTutup() {
    setOpen(false);
    setLama("");
    setBaru("");
    setKonfirmasi("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (baru.length < 8) {
      toast.error("Password baru minimal 8 karakter");
      return;
    }
    if (baru !== konfirmasi) {
      toast.error("Konfirmasi password tidak cocok");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lama, baru }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Gagal mengganti password");
        return;
      }
      toast.success("Password berhasil diganti");
      resetTutup();
    } catch {
      toast.error("Tidak bisa terhubung ke server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Ganti Password"
        title="Ganti Password"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-zinc-700 dark:text-gray-400 dark:hover:bg-zinc-700"
      >
        <KeyRound className="h-4 w-4" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4"
          onClick={resetTutup}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-gray-200 bg-card p-6 shadow-lg dark:border-zinc-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">
                Ganti Password
              </h2>
              <button
                onClick={resetTutup}
                aria-label="Tutup"
                className="text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Password Lama
                </label>
                <input
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  maxLength={200}
                  value={lama}
                  onChange={(e) => setLama(e.target.value)}
                  className={inputCls}
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Password Baru
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  maxLength={200}
                  value={baru}
                  onChange={(e) => setBaru(e.target.value)}
                  className={inputCls}
                  placeholder="Minimal 8 karakter"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Konfirmasi Password Baru
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  maxLength={200}
                  value={konfirmasi}
                  onChange={(e) => setKonfirmasi(e.target.value)}
                  className={inputCls}
                  placeholder="Ulangi password baru"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={resetTutup}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-zinc-700 dark:text-gray-300 dark:hover:bg-zinc-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-400"
                >
                  {loading ? "Menyimpan..." : "Simpan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
