import { NextRequest } from "next/server";
import { sameOrigin } from "@/app/auth";
import { env } from "cloudflare:workers";
import { decryptSecret, encryptSecret } from "@/lib/mfa";
import { base32Encode, newSecret, otpauthUri } from "@/lib/totp";
import { err, mfaGuard, ok, triesAllowed } from "@/lib/mfa-routes";

/** POST starts enrolment. A pending secret is returned again (a reload keeps the scan valid); otherwise a new one is made, stored encrypted and pending. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return err("BAD_ORIGIN", 403);
  const g = await mfaGuard(req);
  if ("res" in g) return g.res;
  if (!(await triesAllowed(g.user.userId, g.ip, "mfa-enroll"))) return err("RATE_LIMITED", 429);
  const db = env.DB!, uid = g.user.userId;
  const existing = await db.prepare("SELECT secret_enc,enabled_at FROM user_mfa WHERE user_id=?").bind(uid).first<{ secret_enc: string; enabled_at: number | null }>();
  // An enrolled account is never re-enrolled from a sign-in. Loss of the device goes through a recovery code or an admin reset.
  if (existing?.enabled_at != null) return err("MFA_ALREADY_ENROLLED", 409);
  let secret: Uint8Array;
  if (existing) {
    try { secret = await decryptSecret(existing.secret_enc, uid); } catch { return err("MFA_SECRET_UNREADABLE", 500); }
  } else {
    secret = newSecret();
    const secretEnc = await encryptSecret(secret, uid);
    // Conditional write: if the account became enabled after the read above, nothing changes and the answer is 409.
    const w = await db.prepare(
      "INSERT INTO user_mfa(user_id,secret_enc,enabled_at,last_step) VALUES(?,?,NULL,NULL) ON CONFLICT(user_id) DO UPDATE SET secret_enc=excluded.secret_enc,last_step=NULL WHERE user_mfa.enabled_at IS NULL",
    ).bind(uid, secretEnc).run();
    if (w.meta.changes !== 1) return err("MFA_ALREADY_ENROLLED", 409);
  }
  const text = base32Encode(secret);
  return ok({ secret: text, otpauth: otpauthUri(text, g.user.email, "Noor al-Ilm") });
}
