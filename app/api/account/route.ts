import { NextRequest, NextResponse } from "next/server";
import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  SESSION_COOKIE, createSession, getCurrentUser, hashPassword, rateLimit, sameOrigin, sessionCookieOptions, verifyPassword,
} from "@/app/auth";

const err = (error: string, status: number) => NextResponse.json({ error }, { status });
const isSecure = (req: NextRequest) => new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
const pwSchema = z.object({ current: z.string().min(1).max(200), next: z.string().min(10).max(200) });
const nameSchema = z.object({ name: z.string().trim().min(2).max(60) });
const deleteSchema = z.object({ password: z.string().min(1).max(200) });

export async function GET() {
  const u = await getCurrentUser();
  if (!u || !env.DB) return err(u ? "DATABASE_UNAVAILABLE" : "SIGN_IN_REQUIRED", u ? 503 : 401);
  const [row, sessions] = await Promise.all([
    env.DB.prepare("SELECT created_at FROM users WHERE id=?").bind(u.userId).first<{ created_at: string }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id=? AND expires_at>?").bind(u.userId, Date.now()).first<{ n: number }>(),
  ]);
  return NextResponse.json({ name: u.displayName, email: u.email, role: u.role, createdAt: row?.created_at ?? null, activeSessions: sessions?.n ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}

/** PATCH {name} renames the account. POST {current,next} changes the password. */
export async function PATCH(req: NextRequest) {
  const u = await getCurrentUser();
  if (!u || !env.DB) return err(u ? "DATABASE_UNAVAILABLE" : "SIGN_IN_REQUIRED", u ? 503 : 401);
  if (!sameOrigin(req)) return err("BAD_ORIGIN", 403);
  const parsed = nameSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err("INVALID_INPUT", 400);
  await env.DB.prepare("UPDATE users SET display_name=? WHERE id=?").bind(parsed.data.name, u.userId).run();
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const u = await getCurrentUser();
  if (!u || !env.DB) return err(u ? "DATABASE_UNAVAILABLE" : "SIGN_IN_REQUIRED", u ? 503 : 401);
  if (!sameOrigin(req)) return err("BAD_ORIGIN", 403);
  if (!(await rateLimit(`pw:${u.userId}`, 6, 15 * 60 * 1000))) return err("RATE_LIMITED", 429);
  const parsed = pwSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err("INVALID_INPUT", 400);
  const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id=?").bind(u.userId).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(parsed.data.current, row.password_hash))) return err("INVALID_CREDENTIALS", 401);
  const hash = await hashPassword(parsed.data.next);
  // Change the password and revoke every existing session in one batch, then start a fresh session.
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash=? WHERE id=?").bind(hash, u.userId),
    env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(u.userId),
    env.DB.prepare("INSERT INTO audit_events(id,actor_id,action,target_id) VALUES(?,?,?,?)").bind(crypto.randomUUID(), u.userId, "PASSWORD_CHANGED", u.userId),
  ]);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSession(u.userId, req.headers.get("user-agent"), { mfaVerified: u.mfaVerified }), sessionCookieOptions(isSecure(req)));
  return res;
}

/** Permanently deletes the account and its personal learning data. Requires the current password. */
export async function DELETE(req: NextRequest) {
  const u = await getCurrentUser();
  if (!u || !env.DB) return err(u ? "DATABASE_UNAVAILABLE" : "SIGN_IN_REQUIRED", u ? 503 : 401);
  if (!sameOrigin(req)) return err("BAD_ORIGIN", 403);
  if (!(await rateLimit(`del:${u.userId}`, 5, 15 * 60 * 1000))) return err("RATE_LIMITED", 429);
  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err("INVALID_INPUT", 400);
  const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id=?").bind(u.userId).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(parsed.data.password, row.password_hash))) return err("INVALID_CREDENTIALS", 401);
  if (u.role === "admin") {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").first<{ n: number }>();
    if ((n?.n ?? 0) <= 1) return err("LAST_ADMIN", 409);
  }
  const id = u.userId;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(id),
    env.DB.prepare("DELETE FROM user_mfa WHERE user_id=?").bind(id),
    env.DB.prepare("DELETE FROM mfa_recovery_codes WHERE user_id=?").bind(id),
    env.DB.prepare("DELETE FROM auth_tokens WHERE user_id=?").bind(id),
    env.DB.prepare("DELETE FROM bookmarks WHERE user_id=?").bind(id),
    env.DB.prepare("DELETE FROM progress WHERE user_id=?").bind(id),
    env.DB.prepare("DELETE FROM quiz_served WHERE user_id=?").bind(id),
    env.DB.prepare("DELETE FROM quiz_attempts WHERE user_id=?").bind(id),
    env.DB.prepare("DELETE FROM point_ledger WHERE user_id=?").bind(id),
    env.DB.prepare("DELETE FROM redemptions WHERE user_id=?").bind(id),
    env.DB.prepare("DELETE FROM users WHERE id=?").bind(id),
    env.DB.prepare("INSERT INTO audit_events(id,actor_id,action,target_id) VALUES(?,?,?,?)").bind(crypto.randomUUID(), "system", "ACCOUNT_DELETED", id),
  ]);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(isSecure(req), 0));
  return res;
}
