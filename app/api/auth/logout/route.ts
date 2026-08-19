import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, destroySession, sameOrigin } from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Érvénytelen kérés." }, { status: 403 });
  await destroySession(request).catch((error) => console.error("Logout error", error));
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
