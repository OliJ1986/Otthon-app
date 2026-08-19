import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (!await getSessionUser(request)) return NextResponse.json({ error: "Bejelentkezés szükséges." }, { status: 401 });
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) return NextResponse.json({ error: "Az értesítések még nincsenek beállítva." }, { status: 503 });
  return NextResponse.json({ publicKey });
}
