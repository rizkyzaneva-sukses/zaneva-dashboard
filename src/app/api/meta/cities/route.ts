import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/api-helpers";
import { searchCityOptionsCached } from "@/lib/orders";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Belum login" }, { status: 401 });
  }
  try {
    const params = new URL(req.url).searchParams;
    const q = (params.get("q") ?? "").trim().slice(0, 100);
    const province = params.get("province")?.slice(0, 200) || null;
    const cities = await searchCityOptionsCached(q, province, 50);
    return NextResponse.json({ options: cities.map((c) => ({ value: c, label: c })) });
  } catch (error) {
    console.error("[api/meta/cities]", error);
    return NextResponse.json({ error: "Terjadi kesalahan di server" }, { status: 500 });
  }
}
