import { NextRequest } from "next/server";
import { env } from "cloudflare:workers";
import { clientIp, getCurrentUser, rateLimit, sameOrigin } from "@/app/auth";
import { issueMail } from "@/lib/auth-tokens";
import { err, ok } from "@/lib/mfa-routes";

const HOUR = 60 * 60 * 1000;

/** Signed-in users ask for a new verification mail. An already verified account gets the same answer and no mail. */
export async function POST(req: NextRequest) {
  if (!env.DB) return err("DATABASE_UNAVAILABLE", 503);
  if (!sameOrigin(req)) return err("BAD_ORIGIN", 403);
  const user = await getCurrentUser();
  if (!user) return err("SIGN_IN_REQUIRED", 401);
  const byUser = await rateLimit(`verify:u:${user.userId}`, 5, HOUR);
  const byIp = await rateLimit(`verify:ip:${clientIp(req)}`, 5, HOUR);
  if (!byUser || !byIp) return err("RATE_LIMITED", 429);
  if (!user.emailVerified) await issueMail({ id: user.userId, email: user.email }, "verify");
  return ok({});
}
