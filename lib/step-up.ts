/**
 * Step-up for sensitive admin actions (N-15b, ADMIN_FOUNDATION s.6).
 *
 * The caller types their own password again and gives a reason. Used today by every role change in
 * /api/admin/users, which includes making someone an admin. User export (N-18) must call it too.
 * - No password: 400 STEP_UP_REQUIRED.
 * - Reason shorter than REASON_MIN or longer than REASON_MAX characters after trim: 400 REASON_REQUIRED.
 * - Wrong password: 403 STEP_UP_FAILED and one STEP_UP_FAILED audit row (lib/audit-denied.ts).
 * - After MAX_FAILS wrong passwords in WINDOW_MS: 429 RATE_LIMITED, even with the right password, until the window ends.
 * The password is checked against the caller's own row. It is never stored, logged or returned.
 */
import { rateLimit, verifyPassword } from "@/app/auth";
import { auditStepUpFailed } from "@/lib/audit-denied";

export const MAX_FAILS = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const REASON_MIN = 10;
export const REASON_MAX = 300;

export type StepUpResult =
  | { ok: true; reason: string }
  | { ok: false; error: "STEP_UP_REQUIRED" | "REASON_REQUIRED" | "STEP_UP_FAILED" | "RATE_LIMITED"; status: 400 | 403 | 429 };

export async function stepUp(
  db: D1Database,
  req: Request,
  user: { userId: string; role: string },
  body: { password?: string; reason?: string },
  route: string,
): Promise<StepUpResult> {
  const password = body.password ?? "";
  const reason = (body.reason ?? "").trim();
  if (!password) return { ok: false, error: "STEP_UP_REQUIRED", status: 400 };
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) return { ok: false, error: "REASON_REQUIRED", status: 400 };
  const key = `stepupfail:${user.userId}`;
  // Count the attempt first, in one atomic upsert (app/auth.ts rateLimit), so parallel guesses cannot all pass a
  // separate read. A right password gives the count back below, so only wrong passwords use up the limit.
  if (!(await rateLimit(key, MAX_FAILS, WINDOW_MS))) return { ok: false, error: "RATE_LIMITED", status: 429 };
  const row = await db.prepare("SELECT password_hash FROM users WHERE id=?").bind(user.userId).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    await auditStepUpFailed(req, user, route);
    return { ok: false, error: "STEP_UP_FAILED", status: 403 };
  }
  await db.prepare("UPDATE rate_limits SET count=count-1 WHERE key=? AND count>0").bind(key).run();
  return { ok: true, reason };
}
