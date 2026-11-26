import { NextRequest } from "next/server";
import { env } from "cloudflare:workers";
import { encryptSecret } from "@/lib/mfa";
import { base32Encode, newSecret, otpauthUri } from "@/lib/totp";
import { err, mfaGuard, ok } from "@/lib/mfa-routes";

/** POST starts enrolment: makes a new secret, stores it encrypted and pending, and returns it once for the authenticator app. */
export async function POST(req: NextRequest) {
  const g = await mfaGuard(req);
  if ("res" in g) return g.res;
  const db = env.DB!;
  const existing = await db.prepare("SELECT enabled_at FROM user_mfa WHERE user_id=?").bind(g.user.userId).first<{ enabled_at: number | null }>();
  // An enrolled account is never re-enrolled from a sign-in. Loss of the device goes through a recovery code or an admin reset.
  if (existing?.enabled_at != null) return err("MFA_ALREADY_ENROLLED", 409);
  const secret = newSecret();
  const secretEnc = await encryptSecret(secret, g.user.userId);
  await db.prepare(
    "INSERT INTO user_mfa(user_id,secret_enc,enabled_at,last_step) VALUES(?,?,NULL,NULL) ON CONFLICT(user_id) DO UPDATE SET secret_enc=excluded.secret_enc,last_step=NULL",
  ).bind(g.user.userId, secretEnc).run();
  const text = base32Encode(secret);
  return ok({ secret: text, otpauth: otpauthUri(text, g.user.email, "Noor al-Ilm") });
}
