import { NextRequest } from "next/server";
import { sameOrigin } from "@/app/auth";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { currentSessionId } from "@/app/auth";
import { matchesRecovery } from "@/lib/mfa";
import { BAD_CODE, auditStmt, err, mfaGuard, ok, triesAllowed } from "@/lib/mfa-routes";

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
    await auditStmt(uid, "MFA_FAILED", uid, { method: "recovery" }).run();
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
  await db.batch([
    db.prepare("UPDATE sessions SET mfa_verified_at=? WHERE id=?").bind(now, await currentSessionId()),
    auditStmt(uid, "MFA_RECOVERY_USED", uid, { remaining: rows.length - 1 }),
  ]);
  return ok({ remaining: rows.length - 1 });
}
