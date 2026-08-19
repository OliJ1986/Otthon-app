import { NextResponse } from "next/server";
import { getSql } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await getSql()`
      SELECT count(*)::int AS "priceRows", max(data_date)::text AS "priceDataDate"
      FROM price_catalog
    ` as unknown as Array<{ priceRows: number; priceDataDate: string | null }>;
    return NextResponse.json({ status: "ok", ...rows[0] });
  } catch (error) {
    console.error("Health check failed", error);
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
