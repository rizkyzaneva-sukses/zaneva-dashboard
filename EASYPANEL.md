# Deploy Zaneva Dashboard ke EasyPanel

## 1. Buat service

**a. Postgres** (Project → + Service → Postgres)
- Nama: `zaneva-db`, database: `zaneva_dashboard`. Catat user/password-nya.
- Versi Postgres sebaiknya **18** (sama dengan lokal) supaya restore dump tidak gagal.

**b. App** (+ Service → App)
- Source: repo Git (atau upload) berisi folder `zaneva-dashboard`; **Build → Dockerfile**, path `Dockerfile`.
  Kalau repo-nya berisi seluruh `RAPIHKAN DATA`, set *Build path* ke `1- APPS/zaneva-dashboard`.
- Domain: arahkan ke port **3000**, aktifkan HTTPS.
- Environment:

| Key | Isi |
|---|---|
| `DATABASE_URL` | `postgresql://USER:PASS@<project>_zaneva-db:5432/zaneva_dashboard` (host internal EasyPanel) |
| `SESSION_SECRET` | acak ≥ 32 karakter: `openssl rand -base64 48` (jangan pakai yang di `.env` lokal) |
| `SESSION_COOKIE_NAME` | `zaneva_session` |
| `PG_POOL_MAX` | opsional, default 10 |
| `SESSION_COOKIE_SECURE` | opsional; `false` hanya jika diakses lewat http murni |

Healthcheck container sudah ada di Dockerfile (`/api/health`).

## 2. Isi database (sekali, dari PC lokal)

Image app sengaja minimal (tanpa Prisma CLI / data). Jalankan dari PC. Buka dulu port Postgres di EasyPanel
(tab *Credentials/Advanced → External port*), **tutup lagi setelah selesai**.

**Opsi A — restore dump (paling cepat, termasuk tabel user):**
```bash
pg_restore --no-owner --clean --if-exists -h <HOST_EASYPANEL> -p <PORT> -U <USER> -d zaneva_dashboard pindah-pc/zaneva_dashboard.dump
```
Login di dump memakai password admin lokal → **ganti segera** (lihat langkah 3).

**Opsi B — schema + import ulang dari CSV:**
```bash
# set DATABASE_URL di shell ke DB EasyPanel, lalu:
npx prisma db push
SEED_ADMIN_PASSWORD='password-kuat-min-10-karakter' NODE_ENV=production npm run db:seed
NODE_OPTIONS=--max-old-space-size=2048 npm run import:orders -- --yes
```
`import:orders` menghapus semua order lalu memuat ulang (dalam satu transaksi) dan mencetak host target sebelum jalan.

## 3. Setelah live
- Ganti password admin (seed tidak menimpa admin yang sudah ada; ubah hash langsung di DB atau hapus user `admin` lalu seed ulang dengan password baru).
- Tutup external port Postgres.
- Setelah import ulang data, **restart app** agar cache query (30 menit) terbuang.
- Update data ke depan: jalankan ETL lokal → `import:orders` ke DB EasyPanel.
