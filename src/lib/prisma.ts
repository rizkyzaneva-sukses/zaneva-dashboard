import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !/^postgres(ql)?:\/\//.test(connectionString)) {
    throw new Error("DATABASE_URL harus berupa koneksi PostgreSQL (postgresql://...)");
  }

  // SSL: atur lewat DATABASE_URL (?sslmode=require) atau, kalau URL tidak memuat sslmode,
  // lewat DATABASE_SSL=true (+ DATABASE_SSL_REJECT_UNAUTHORIZED=false untuk sertifikat self-signed).
  const ssl =
    process.env.DATABASE_SSL === "true" && !/[?&]sslmode=/.test(connectionString)
      ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" }
      : undefined;

  const adapter = new PrismaPg(
    {
      connectionString,
      ssl,
      // Pool kecil cukup untuk container kecil; naikkan lewat PG_POOL_MAX bila perlu.
      max: intEnv("PG_POOL_MAX", 10, 1, 50),
      idleTimeoutMillis: intEnv("PG_IDLE_TIMEOUT_MS", 30_000, 1_000, 600_000),
      connectionTimeoutMillis: intEnv("PG_CONNECT_TIMEOUT_MS", 10_000, 1_000, 60_000),
      // Query agregat yang nyangkut tidak boleh menahan koneksi selamanya.
      statement_timeout: intEnv("PG_STATEMENT_TIMEOUT_MS", 60_000, 1_000, 600_000),
    },
    { onPoolError: (err) => console.error("[db] koneksi idle error:", err.message) }
  );
  return new PrismaClient({ adapter });
}

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) globalForPrisma.prisma = createPrismaClient();
  return globalForPrisma.prisma;
}
