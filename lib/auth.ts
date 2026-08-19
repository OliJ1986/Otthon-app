import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/db";

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = "otthon_session";
const SESSION_DAYS = 30;

export type SessionUser = {
  id: number;
  username: string;
  displayName: string;
  role: "owner" | "member";
};

export function normalizeUsername(value: unknown) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("hu-HU") : "";
}

export function validUsername(value: string) {
  return /^[a-z0-9._-]{3,30}$/.test(value);
}

export function validPassword(value: unknown) {
  return typeof value === "string" && value.length >= 10 && value.length <= 200;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, expectedHex] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: number) {
  const sql = getSql();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await sql`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (${tokenHash(token)}, ${userId}, ${expiresAt})
  `;
  return { token, expiresAt };
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: Date) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getSessionUser(request: NextRequest): Promise<SessionUser | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const sql = getSql();
  const rows = await sql`
    SELECT u.id, u.username, u.display_name AS "displayName", u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash(token)} AND s.expires_at > now()
    LIMIT 1
  ` as unknown as SessionUser[];
  const user = rows[0] || null;
  if (user) {
    void sql`UPDATE users SET last_seen_at = now() WHERE id = ${user.id}`;
  }
  return user;
}

export async function destroySession(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) await getSql()`DELETE FROM sessions WHERE token_hash = ${tokenHash(token)}`;
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    return false;
  }

  const requestUrl = new URL(request.url);
  const allowedOrigins = new Set([requestUrl.origin]);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.split(",", 1)[0]?.trim();
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const protocol = forwardedProtocol || requestUrl.protocol.replace(":", "");

  if (host && (protocol === "http" || protocol === "https")) {
    try {
      allowedOrigins.add(new URL(`${protocol}://${host}`).origin);
    } catch {
      return false;
    }
  }

  return allowedOrigins.has(normalizedOrigin);
}
