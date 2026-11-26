import { NextRequest, NextResponse } from "next/server";
import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  SESSION_COOKIE, clientIp, createSession, destroySession, getCurrentUser, hashPassword, isReviewer, isStaff,
  rateLimit, registrationAllowed, registrationMode, sameOrigin, sessionCookieOptions, verifyPassword,
} from "@/app/auth";

const email = z.string().trim().toLowerCase().email().max(254);
const registerSchema = z.object({ email, password: z.string().min(10).max(200), name: z.string().trim().min(2).max(60) });
const loginSchema = z.object({ email, password: z.string().min(1).max(200) });
// Verified against a throwaway hash so unknown accounts cost the same as known ones.
const DUMMY_HASH = "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

const err = (error: string, status: number) => NextResponse.json({ error }, { status });
const isSecure = (req: NextRequest) => new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  if ((await ctx.params).action !== "session") return err("NOT_FOUND", 404);
  const u = await getCurrentUser({ allowUnverified: true });
  // `mfa` tells the page that a staff session must finish MFA first; nothing else works until then.
  const mfa = u && isStaff(u) && !u.mfaVerified ? "required" : undefined;
  return NextResponse.json({ user: u ? { name: u.displayName, email: u.email, reviewer: isReviewer(u), ...(mfa ? { mfa } : {}) } : null, registrationOpen: registrationMode() !== "closed" }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (!env.DB) return err("DATABASE_UNAVAILABLE", 503);
  if (!sameOrigin(req)) return err("BAD_ORIGIN", 403);
  const ip = clientIp(req);

  if (action === "logout") {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (token) await destroySession(token);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(isSecure(req), 0));
    return res;
  }
  if (action !== "login" && action !== "register") return err("NOT_FOUND", 404);

  let body: unknown;
  try { body = await req.json(); } catch { return err("INVALID_JSON", 400); }

  if (action === "register") {
    // Same refusal for every case, so the response never says who is on the allowlist.
    const wanted = email.safeParse((body as { email?: unknown } | null)?.email);
    if (registrationMode() !== "open" && (!wanted.success || !registrationAllowed(wanted.data))) return err("REGISTRATION_CLOSED", 403);
    if (!(await rateLimit(`reg:${ip}`, 5, 60 * 60 * 1000))) return err("RATE_LIMITED", 429);
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) return err("INVALID_INPUT", 400);
    const { email: mail, password, name } = parsed.data;
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare("INSERT INTO users(id,email,display_name,password_hash) VALUES(?,?,?,?)")
        .bind(id, mail, name, await hashPassword(password)).run();
    } catch (e) {
      if (String(e).includes("UNIQUE")) return err("EMAIL_TAKEN", 409);
      throw e;
    }
    const res = NextResponse.json({ ok: true }, { status: 201 });
    res.cookies.set(SESSION_COOKIE, await createSession(id, req.headers.get("user-agent")), sessionCookieOptions(isSecure(req)));
    return res;
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return err("INVALID_INPUT", 400);
  const { email: mail, password } = parsed.data;
  if (!(await rateLimit(`login:${ip}:${mail}`, 8, 15 * 60 * 1000)) || !(await rateLimit(`loginip:${ip}`, 40, 15 * 60 * 1000))) return err("RATE_LIMITED", 429);
  const row = await env.DB.prepare("SELECT id,password_hash,role FROM users WHERE email=?").bind(mail).first<{ id: string; password_hash: string; role: string }>();
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) return err("INVALID_CREDENTIALS", 401);
  await env.DB.prepare("UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?").bind(row.id).run();
  // Staff get an unverified session; the page sends them to /mfa and nothing else works until they finish.
  const res = NextResponse.json({ ok: true, ...(isStaff({ userId: row.id, role: row.role }) ? { mfa: "required" } : {}) });
  res.cookies.set(SESSION_COOKIE, await createSession(row.id, req.headers.get("user-agent")), sessionCookieOptions(isSecure(req)));
  return res;
}
