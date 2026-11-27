import { NextRequest } from "next/server";
import { sameOrigin } from "@/app/auth";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { SESSION_COOKIE, currentSessionId, isSecureRequest, rotationStatements, sessionCookieOptions } from "@/app/auth";
import { matchesRecovery } from "@/lib/mfa";
import { BAD_CODE, auditStmt, err, mfaGuard, ok, triesAllowed } from "@/lib/mfa-routes";
import { AUDIT_UNAVAILABLE, runAudited } from "@/lib/audit";

const schema = z.object({ code: z.string().trim().min(8).max(24) });

/** POST {code}: signs a staff session in with one unused recovery code. The code is spent at once. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err("BAD_ORIGIN", 403);
  const g = await mfaGuard(req);
  if ("res" in g) return g.res;
  const db = env.DB!, uid = g.user.userId;
  if (!(await triesAllowed(uid, g.ip))) return err("RATE_LIMITED", 429);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  const fail = async () => {
    if (!(await runAudited(db, async () => [await auditStmt(g.user, g.ip, "MFA_FAILED", { method: "recovery" })]))) return err(AUDIT_UNAVAILABLE, 503);
    return err(BAD_CODE, 401);
  };
  if (!parsed.success) return fail();
  // Recovery works only for an enrolled account (codes exist only after the first confirmed code).
  const rows = (await db.prepare("SELECT id,code_hash FROM mfa_recovery_codes WHERE user_id=? AND used_at IS NULL").bind(uid).all<{ id: string; code_hash: string }>()).results;
  let hit: string | null = null;
  for (const r of rows) if (await matchesRecovery(parsed.data.code, r.code_hash)) hit = r.id;
  if (!hit) return fail();
  const now = Date.now();
  const spent = await db.prepare("UPDATE mfa_recovery_codes SET used_at=? WHERE id=? AND used_at IS NULL").bind(now, hit).run();
  if (spent.meta.changes !== 1) return fail();
  const sid = await currentSessionId();
  const rot = await rotationStatements(sid, uid, req.headers.get("user-agent"), now); // step-up: new session id (N-11)
  const done = await runAudited(db, async () => [
    ...rot.stmts,
    await auditStmt(g.user, g.ip, "MFA_RECOVERY_USED", { remaining: rows.length - 1 }),
  ]);
  if (!done) return err(AUDIT_UNAVAILABLE, 503);
  const res = ok({ remaining: rows.length - 1 });
  res.cookies.set(SESSION_COOKIE, rot.token, sessionCookieOptions(isSecureRequest(req)));
  return res;
}
