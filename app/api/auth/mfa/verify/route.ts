import { NextRequest } from "next/server";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { currentSessionId } from "@/app/auth";
import { RECOVERY_COUNT, decryptSecret, hashRecovery, newRecoveryCode } from "@/lib/mfa";
import { verifyTotp } from "@/lib/totp";
import { normalizeDigits } from "@/lib/digits";
import { BAD_CODE, auditStmt, err, mfaGuard, ok, triesAllowed } from "@/lib/mfa-routes";
import { AUDIT_UNAVAILABLE, runAudited } from "@/lib/audit";

const schema = z.object({ code: z.string().transform(v => normalizeDigits(v.trim())).pipe(z.string().regex(/^\d{6}$/)) });

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
    if (!(await runAudited(db, async () => [await auditStmt(g.user, g.ip, "MFA_FAILED", { method: "totp", why })]))) return err(AUDIT_UNAVAILABLE, 503);
    return err(BAD_CODE, 401);
  };
  if (!parsed.success) return fail("format");
  let step: number | null;
  try { step = await verifyTotp(await decryptSecret(row.secret_enc, uid), parsed.data.code, Date.now(), row.last_step); }
  catch { return err("MFA_SECRET_UNREADABLE", 500); }
  if (step === null) return fail("code");
  // Atomic replay guard: only one request can move last_step forward to this step. It stays outside the audited
  // batch on purpose (a spent code must stay spent). enabled_at is set INSIDE the batch below, so a failed audit
  // write leaves the account not enrolled; the user then retries with the next code and gets the recovery codes.
  const now = Date.now();
  const moved = await db.prepare("UPDATE user_mfa SET last_step=? WHERE user_id=? AND (last_step IS NULL OR last_step<?)").bind(step, uid, step).run();
  if (moved.meta.changes !== 1) return fail("replay");
  const sid = await currentSessionId();
  const first = row.enabled_at == null;
  const stmts = [
    db.prepare("UPDATE user_mfa SET enabled_at=COALESCE(enabled_at,?) WHERE user_id=?").bind(now, uid),
    db.prepare("UPDATE sessions SET mfa_verified_at=? WHERE id=?").bind(now, sid),
  ];
  const codes: string[] = [];
  if (first) {
    stmts.push(db.prepare("DELETE FROM mfa_recovery_codes WHERE user_id=?").bind(uid));
    for (let i = 0; i < RECOVERY_COUNT; i++) {
      const c = newRecoveryCode();
      codes.push(c);
      stmts.push(db.prepare("INSERT INTO mfa_recovery_codes(id,user_id,code_hash,used_at) VALUES(?,?,?,NULL)").bind(crypto.randomUUID(), uid, await hashRecovery(c)));
    }
  }
  if (!(await runAudited(db, async () => [...stmts, await auditStmt(g.user, g.ip, first ? "MFA_ENROLLED" : "MFA_VERIFIED")]))) return err(AUDIT_UNAVAILABLE, 503);
  return ok(first ? { enrolled: true, recoveryCodes: codes } : { enrolled: false });
}
