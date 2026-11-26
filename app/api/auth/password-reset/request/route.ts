import { NextRequest } from "next/server";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { clientIp, rateLimit, sameOrigin } from "@/app/auth";
import { decoyMail, issueMail } from "@/lib/auth-tokens";
import { err, ok } from "@/lib/mfa-routes";

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
const HOUR = 60 * 60 * 1000;

/** The answer is the same whether the address has an account or not (same status, same body, same work). */
export async function POST(req: NextRequest) {
  if (!env.DB) return err("DATABASE_UNAVAILABLE", 503);
  if (!sameOrigin(req)) return err("BAD_ORIGIN", 403);
  let body: unknown;
  try { body = await req.json(); } catch { return err("INVALID_JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return err("INVALID_INPUT", 400);
  const { email } = parsed.data;
  const byIp = await rateLimit(`pwreset:ip:${clientIp(req)}`, 5, HOUR);
  const byMail = await rateLimit(`pwreset:email:${email}`, 5, HOUR);
  if (!byIp || !byMail) return err("RATE_LIMITED", 429);
  const user = await env.DB.prepare("SELECT id,email FROM users WHERE email=?").bind(email).first<{ id: string; email: string }>();
  if (user) await issueMail(user, "reset"); else await decoyMail("reset");
  return ok({});
}
