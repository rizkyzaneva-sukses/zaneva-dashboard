import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { PrismaClient, Prisma } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * SKRIP DESTRUKTIF: menghapus SEMUA data orders (dan product_review) lalu mengisi ulang dari CSV.
 *
 * Pemakaian:
 *   npm run import:orders -- --yes [--csv=/path/orders_clean.csv]
 *   CONFIRM_IMPORT=1 IMPORT_CSV_PATH=/data/orders_clean.csv npm run import:orders
 *
 * Opsi:
 *   --yes / CONFIRM_IMPORT=1      wajib; tanpa ini skrip hanya menampilkan target lalu berhenti.
 *   --csv= / IMPORT_CSV_PATH      lokasi orders_clean.csv (default: ./data/orders_clean.csv).
 *   IMPORT_REVIEW_CSV_PATH        lokasi product_review.csv (default: sefolder dengan orders CSV).
 *
 * Hapus + isi ulang dibungkus SATU transaksi: kalau gagal di tengah jalan, data lama tetap utuh.
 * Seluruh CSV dibaca ke memori (~490 ribu baris butuh sekitar 1 GB); jalankan dengan
 * NODE_OPTIONS=--max-old-space-size=2048 bila container kecil.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !/^postgres(ql)?:\/\//.test(databaseUrl)) {
  console.error("DATABASE_URL belum diatur atau bukan koneksi PostgreSQL.");
  process.exit(1);
}

const argv = process.argv.slice(2);
const argValue = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const confirmed = argv.includes("--yes") || process.env.CONFIRM_IMPORT === "1";

const CSV_PATH = path.resolve(
  argValue("csv") || process.env.IMPORT_CSV_PATH || path.join(__dirname, "..", "data", "orders_clean.csv")
);
const REVIEW_PATH = path.resolve(
  process.env.IMPORT_REVIEW_CSV_PATH || path.join(path.dirname(CSV_PATH), "product_review.csv")
);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

const MARKETPLACES = new Set(["SHOPEE", "TIKTOK", "LAZADA", "BOOTH", "KOMUNITAS", "KANTOR", "CASH_COD", "LAINNYA"]);

/** Host/port/db/user target tanpa password. */
function describeTarget(): string {
  try {
    const u = new URL(databaseUrl!);
    return `${u.hostname}:${u.port || "5432"}${u.pathname} (user ${decodeURIComponent(u.username)})`;
  } catch {
    return "(DATABASE_URL tidak bisa di-parse)";
  }
}

interface Row {
  orderNo: string;
  resi: string;
  orderDate: string;
  paymentMethod: string;
  sku: string;
  qty: string;
  revenue: string;
  shippingCost: string;
  city: string;
  district: string;
  province: string;
  platformRaw: string;
  marketplace: string;
  account: string;
  brand: string;
  category: string;
  sourceFile: string;
  venue: string;
}

async function main() {
  console.log("Database target :", describeTarget());
  console.log("File CSV        :", CSV_PATH);
  if (!confirmed) {
    console.error(
      "\nSkrip ini MENGHAPUS semua data orders di database target lalu mengimpor ulang dari CSV.\n" +
        "Jalankan ulang dengan --yes (atau CONFIRM_IMPORT=1) kalau memang itu yang dimau."
    );
    process.exit(1);
  }
  if (!fs.existsSync(CSV_PATH)) throw new Error(`File CSV tidak ditemukan: ${CSV_PATH}`);

  console.log("Membaca", CSV_PATH);
  const content = fs.readFileSync(CSV_PATH, "utf-8");
  const records: Row[] = parse(content, { columns: true, skip_empty_lines: true });
  console.log(`Ditemukan ${records.length} baris.`);

  // Validasi SEBELUM menghapus apa pun: CSV kosong/rusak tidak boleh mengosongkan database.
  if (records.length === 0) throw new Error("CSV kosong; import dibatalkan, data lama tidak disentuh.");
  records.forEach((r, i) => {
    const line = i + 2;
    if (!r.orderNo || !r.sku) throw new Error(`Baris ${line}: orderNo/sku kosong.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.orderDate) || Number.isNaN(new Date(r.orderDate + "T00:00:00Z").getTime()))
      throw new Error(`Baris ${line}: orderDate tidak valid (${r.orderDate}).`);
    if (!MARKETPLACES.has(r.marketplace)) throw new Error(`Baris ${line}: marketplace tidak dikenal (${r.marketplace}).`);
    if (!r.brand) throw new Error(`Baris ${line}: brand kosong.`);
    if (r.revenue === "" || Number.isNaN(Number(r.revenue))) throw new Error(`Baris ${line}: revenue tidak valid (${r.revenue}).`);
  });

  const orderKeys = new Map<string, number>();
  for (const r of records) if (!orderKeys.has(r.orderNo)) orderKeys.set(r.orderNo, orderKeys.size + 1);

  const lineCount = new Map<string, number>();
  for (const r of records) lineCount.set(r.orderNo, (lineCount.get(r.orderNo) ?? 0) + 1);

  const review: Record<string, string>[] | null = fs.existsSync(REVIEW_PATH)
    ? parse(fs.readFileSync(REVIEW_PATH, "utf-8"), { columns: true, skip_empty_lines: true })
    : null;

  const BATCH = 2000;
  let inserted = 0;
  await prisma.$transaction(
    async (tx) => {
      console.log("Menghapus data orders lama...");
      await tx.order.deleteMany({});

      for (let i = 0; i < records.length; i += BATCH) {
        const chunk = records.slice(i, i + BATCH).map((r) => ({
          orderNo: r.orderNo,
          resi: r.resi || null,
          orderDate: new Date(r.orderDate + "T00:00:00Z"),
          paymentMethod: r.paymentMethod || null,
          sku: r.sku,
          qty: parseInt(r.qty, 10) || 1,
          revenue: new Prisma.Decimal(r.revenue),
          shippingCost: r.shippingCost ? new Prisma.Decimal(r.shippingCost) : null,
          city: r.city || null,
          district: r.district || null,
          province: r.province || null,
          platformRaw: r.platformRaw || "",
          brand: r.brand,
          account: r.account || null,
          category: r.category || null,
          marketplace: r.marketplace as "SHOPEE" | "TIKTOK" | "LAZADA" | "BOOTH" | "KOMUNITAS" | "KANTOR" | "CASH_COD" | "LAINNYA",
          sourceFile: r.sourceFile,
          venue: r.venue || null,
          orderKey: orderKeys.get(r.orderNo)!,
          orderW: 1 / lineCount.get(r.orderNo)!,
        }));
        await tx.order.createMany({ data: chunk });
        inserted += chunk.length;
        process.stdout.write(`\rImport: ${inserted}/${records.length}`);
      }
      console.log(`\nTotal ${inserted} baris orders dimasukkan (belum commit).`);

      if (review) {
        await tx.productReview.deleteMany({});
        await tx.productReview.createMany({
          data: review.map((r) => ({
            kind: r.kind,
            name: r.name,
            rows: parseInt(r.rows, 10) || 0,
            omzet: new Prisma.Decimal(r.omzet || "0"),
            suggestions: r.suggestions || null,
            note: r.note || null,
            resultSku: r.resultSku || null,
          })),
        });
        console.log(`Daftar review produk: ${review.length} baris.`);
      } else {
        console.log("product_review.csv tidak ditemukan, daftar review lama dibiarkan:", REVIEW_PATH);
      }
    },
    // Satu transaksi besar: beri waktu lama (default Prisma hanya 5 detik).
    { timeout: 60 * 60 * 1000, maxWait: 30_000 }
  );
  console.log("Selesai, transaksi commit. Restart aplikasi agar cache hasil query (30 menit) bersih.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
