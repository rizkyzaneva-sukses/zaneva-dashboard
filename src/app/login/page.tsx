"use client";

import * as React from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/** Hanya path relatif same-origin ("/x"); tolak "//host", "/\host", URL absolut, karakter kontrol. */
function amanReturnTo(raw: string | null): string {
  if (!raw || raw.length > 2000) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return "/";
  if (raw === "/login" || raw.startsWith("/login?") || raw.startsWith("/api/")) return "/";
  return raw;
}

export default function LoginPage() {
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Gagal login");
        return;
      }
      toast.success(`Selamat datang, ${data.nama}`);
      window.location.assign(amanReturnTo(new URLSearchParams(window.location.search).get("return_to")));
    } catch {
      toast.error("Tidak bisa terhubung ke server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-card p-6 shadow-sm dark:border-zinc-700">
        <h1 className="mb-1 text-xl font-semibold text-gray-900 dark:text-gray-50">
          Zaneva Dashboard
        </h1>
        <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
          Masuk untuk melihat data penjualan konsolidasi
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Username
            </label>
            <input
              autoFocus
              autoComplete="username"
              maxLength={64}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-sm",
                "border-gray-300 bg-white text-gray-900 placeholder:text-gray-500",
                "dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-50 dark:placeholder:text-gray-400",
                "focus:outline-none focus:ring-2 focus:ring-blue-500"
              )}
              placeholder="admin"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              maxLength={200}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-sm",
                "border-gray-300 bg-white text-gray-900 placeholder:text-gray-500",
                "dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-50 dark:placeholder:text-gray-400",
                "focus:outline-none focus:ring-2 focus:ring-blue-500"
              )}
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-400"
          >
            {loading ? "Memproses..." : "Masuk"}
          </button>
        </form>
      </div>
    </div>
  );
}
