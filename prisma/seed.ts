import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const isProd = process.env.NODE_ENV === "production";
  const dariEnv = process.env.SEED_ADMIN_PASSWORD;
  const lemah = !dariEnv || dariEnv === "admin123" || dariEnv.length < 10;

  if (isProd && lemah) {
    throw new Error(
      "Seed di production wajib SEED_ADMIN_PASSWORD (minimal 10 karakter, bukan 'admin123')."
    );
  }

  const password = dariEnv || "admin123";
  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      nama: "Rizky",
      username: "admin",
      passwordHash,
    },
  });

  console.log(`Admin siap: ${admin.username}`);
  if (!dariEnv) {
    console.log("SEED_ADMIN_PASSWORD kosong, memakai password default (hanya untuk dev) — segera ganti.");
  }
  // update: {} → user yang sudah ada TIDAK ditimpa passwordnya; ganti password lewat cara lain.
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
