import { NextRequest } from "next/server";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { clientIp, hashPassword, rateLimit, sameOrigin } from "@/app/auth";
import { consumeToken } from "@/lib/auth-tokens";
import { err, ok } from "@/lib/mfa-routes";
import { AUDIT_UNAVAILABLE, auditStatement, runAudited } from "@/lib/audit";

const schema = z.object({ token: z.string().min(1).max(128), password: z.string().min(10).max(200) });

/**
 * Sets a new password with a single-use token, ends every session of the user, and does NOT sign anyone in.
 * MFA rows are not touched: staff still pass MFA at the next sign-in.
 */
export async function POST(req: NextRequest) {
  if (!env.DB) return err("DATABASE_UNAVAILABLE", 503);
  if (!sameOrigin(req)) return err("BAD_ORIGIN", 403);
  let body: unknown;
  try { body = await req.json(); } catch { return err("INVALID_JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return err("INVALID_INPUT", 400);
  if (!(await rateLimit(`pwconfirm:ip:${clientIp(req)}`, 5, 60 * 60 * 1000))) return err("RATE_LIMITED", 429);
  const hash = await hashPassword(parsed.data.password); // before the token check, so a bad token costs the same time
  const userId = await consumeToken(parsed.data.token, "reset");
  if (!userId) return err("INVALID_OR_EXPIRED_TOKEN", 400);
  const now = Date.now();
  const db = env.DB;
  const done = await runAudited(db, async () => [
    db.prepare("UPDATE users SET password_hash=? WHERE id=?").bind(hash, userId),
    db.prepare("DELETE FROM sessions WHERE user_id=?").bind(userId),
    db.prepare("UPDATE auth_tokens SET used_at=? WHERE user_id=? AND kind='reset' AND used_at IS NULL").bind(now, userId),
    await auditStatement(db, { actorId: userId, action: "PASSWORD_RESET", targetId: userId, source: clientIp(req) }),
  ]);
  if (!done) return err(AUDIT_UNAVAILABLE, 503);
  return ok({});
}
