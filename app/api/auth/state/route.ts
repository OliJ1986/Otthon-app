import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql } from "@/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await getSessionUser(request);
    const rows = await getSql()`SELECT EXISTS(SELECT 1 FROM users) AS "hasUsers"` as unknown as Array<{ hasUsers: boolean }>;
    return NextResponse.json({ actor, setupRequired: !rows[0]?.hasUsers });
  } catch (error) {
    console.error("Auth state error", error);
    return NextResponse.json({ error: "Az adatbázis nem érhető el." }, { status: 503 });
  }
}
