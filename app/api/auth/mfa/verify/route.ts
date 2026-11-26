import { NextRequest } from "next/server";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { currentSessionId } from "@/app/auth";
import { RECOVERY_COUNT, decryptSecret, hashRecovery, newRecoveryCode } from "@/lib/mfa";
import { verifyTotp } from "@/lib/totp";
import { BAD_CODE, auditStmt, err, mfaGuard, ok, triesAllowed } from "@/lib/mfa-routes";

const schema = z.object({ code: z.string().trim().regex(/^\d{6}$/) });

/** POST {code}: confirms enrolment (first success, returns the recovery codes once) or verifies a staff session. */
export async function POST(req: NextRequest) {
  const g = await mfaGuard(req);
  if ("res" in g) return g.res;
  const db = env.DB!, uid = g.user.userId;
  if (!(await triesAllowed(uid, g.ip))) return err("RATE_LIMITED", 429);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  const row = await db.prepare("SELECT secret_enc,enabled_at,last_step FROM user_mfa WHERE user_id=?").bind(uid).first<{ secret_enc: string; enabled_at: number | null; last_step: number | null }>();
  if (!row) return err("MFA_NOT_ENROLLED", 409);
  const fail = async (why: string) => {
    await auditStmt(uid, "MFA_FAILED", uid, { method: "totp", why }).run();
    return err(BAD_CODE, 401);
  };
  if (!parsed.success) return fail("format");
  let step: number | null;
  try { step = await verifyTotp(await decryptSecret(row.secret_enc, uid), parsed.data.code, Date.now(), row.last_step); }
  catch { return err("MFA_SECRET_UNREADABLE", 500); }
  if (step === null) return fail("code");
  // Atomic replay guard: only one request can move last_step forward to this step.
  const now = Date.now();
  const moved = await db.prepare("UPDATE user_mfa SET last_step=?,enabled_at=COALESCE(enabled_at,?) WHERE user_id=? AND (last_step IS NULL OR last_step<?)").bind(step, now, uid, step).run();
  if (moved.meta.changes !== 1) return fail("replay");
  const sid = await currentSessionId();
  const first = row.enabled_at == null;
  const stmts = [db.prepare("UPDATE sessions SET mfa_verified_at=? WHERE id=?").bind(now, sid)];
  const codes: string[] = [];
  if (first) {
    stmts.push(db.prepare("DELETE FROM mfa_recovery_codes WHERE user_id=?").bind(uid));
    for (let i = 0; i < RECOVERY_COUNT; i++) {
      const c = newRecoveryCode();
      codes.push(c);
      stmts.push(db.prepare("INSERT INTO mfa_recovery_codes(id,user_id,code_hash,used_at) VALUES(?,?,?,NULL)").bind(crypto.randomUUID(), uid, await hashRecovery(c)));
    }
  }
  stmts.push(auditStmt(uid, first ? "MFA_ENROLLED" : "MFA_VERIFIED", uid));
  await db.batch(stmts);
  return ok(first ? { enrolled: true, recoveryCodes: codes } : { enrolled: false });
}
