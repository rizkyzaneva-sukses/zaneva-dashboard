import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/api-helpers";
import { searchProductOptionsCached } from "@/lib/orders";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Belum login" }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim().slice(0, 100);
    const skus = await searchProductOptionsCached(q, 50);
    return NextResponse.json({ options: skus.map((s) => ({ value: s, label: s })) });
  } catch (error) {
    console.error("[api/meta/products]", error);
    return NextResponse.json({ error: "Terjadi kesalahan di server" }, { status: 500 });
  }
}
