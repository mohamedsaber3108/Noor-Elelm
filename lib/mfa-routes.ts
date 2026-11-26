import { NextRequest, NextResponse } from "next/server";
import { env } from "cloudflare:workers";
import { clientIp, getCurrentUser, isStaff, rateLimit, sameOrigin, type AppUser } from "@/app/auth";
import { mfaConfigured } from "@/lib/mfa";

export const err = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
export const ok = (body: object, status = 200) => NextResponse.json({ ok: true, ...body }, { status, headers: { "Cache-Control": "no-store" } });

const WINDOW_MS = 15 * 60 * 1000;

/** Checks shared by the three MFA routes. Returns the staff user, or the error response to send. */
export async function mfaGuard(req: NextRequest): Promise<{ user: AppUser; ip: string } | { res: NextResponse }> {
  if (!env.DB) return { res: err("DATABASE_UNAVAILABLE", 503) };
  if (!sameOrigin(req)) return { res: err("BAD_ORIGIN", 403) };
  const user = await getCurrentUser({ allowUnverified: true });
  if (!user) return { res: err("SIGN_IN_REQUIRED", 401) };
  if (!isStaff(user)) return { res: err("MFA_NOT_REQUIRED", 403) };
  // Fail closed: without the key nothing can be enrolled or verified.
  if (!mfaConfigured()) return { res: err("MFA_NOT_CONFIGURED", 503) };
  return { user, ip: clientIp(req) };
}

/** 5 tries per user, then 15 minutes. The per-IP limit is wider so one office network is not locked out by a single user. */
export async function triesAllowed(userId: string, ip: string) {
  const a = await rateLimit(`mfa:u:${userId}`, 5, WINDOW_MS);
  const b = await rateLimit(`mfa:ip:${ip}`, 20, WINDOW_MS);
  return a && b;
}

/** Audit row. `detail` must never hold a secret, a code or a hash. */
export function auditStmt(actor: string, action: string, target: string, detail: Record<string, string | number | boolean> = {}) {
  return env.DB!.prepare("INSERT INTO audit_events(id,actor_id,action,target_id,detail_json) VALUES(?,?,?,?,?)")
    .bind(crypto.randomUUID(), actor, action, target, JSON.stringify(detail));
}

export const BAD_CODE = "MFA_INVALID_CODE";
