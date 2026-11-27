import { NextRequest } from "next/server";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { clientIp, rateLimit, sameOrigin } from "@/app/auth";
import { consumeToken } from "@/lib/auth-tokens";
import { err, ok } from "@/lib/mfa-routes";
import { AUDIT_UNAVAILABLE, auditStatement, runAudited } from "@/lib/audit";

const schema = z.object({ token: z.string().min(1).max(128) });

/** The link is opened in any browser, so no sign-in is needed. The token alone proves the mailbox. */
export async function POST(req: NextRequest) {
  if (!env.DB) return err("DATABASE_UNAVAILABLE", 503);
  if (!sameOrigin(req)) return err("BAD_ORIGIN", 403);
  let body: unknown;
  try { body = await req.json(); } catch { return err("INVALID_JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return err("INVALID_INPUT", 400);
  if (!(await rateLimit(`verifyconfirm:ip:${clientIp(req)}`, 5, 60 * 60 * 1000))) return err("RATE_LIMITED", 429);
  const userId = await consumeToken(parsed.data.token, "verify");
  if (!userId) return err("INVALID_OR_EXPIRED_TOKEN", 400);
  const db = env.DB;
  const done = await runAudited(db, async () => [
    db.prepare("UPDATE users SET email_verified_at=? WHERE id=? AND email_verified_at IS NULL").bind(Date.now(), userId),
    await auditStatement(db, { actorId: userId, action: "EMAIL_VERIFIED", targetId: userId, source: clientIp(req) }),
  ]);
  if (!done) return err(AUDIT_UNAVAILABLE, 503);
  return ok({});
}
