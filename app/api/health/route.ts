import { NextResponse } from "next/server";
import { getSql } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getSql()`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("Health check failed", error);
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
