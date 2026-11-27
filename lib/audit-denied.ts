/**
 * Audit rows for denied and failed attempts (N-14b, ADMIN_FOUNDATION s.7).
 *
 * Unlike a sensitive action, nothing here may change the answer of the route: every failure is swallowed
 * (a 403 or 401 stays a 403 or 401, never a 500). Anonymous callers write no row. At most MAX_ROWS rows per
 * actor and action in WINDOW_MS, so a loop of bad requests cannot fill the table.
 */
import { env } from "cloudflare:workers";
import { clientIp, getCurrentUser, rateLimit } from "@/app/auth";
import { auditStatement, runAudited } from "@/lib/audit";

const MAX_ROWS = 5;
const WINDOW_MS = 15 * 60 * 1000;

async function write(actorId: string, actorRole: string | null, action: string, targetId: string, result: "denied" | "failed", source: string) {
  const db = env.DB;
  if (!db) return;
  if (!(await rateLimit(`auditdeny:${action}:${actorId}`, MAX_ROWS, WINDOW_MS))) return;
  await runAudited(db, async () => [await auditStatement(db, { actorId, actorRole, action, targetId, result, source })]);
}

/**
 * ADMIN_DENIED: a signed-in user (including staff whose session has no MFA yet) was refused on an admin route.
 * `route` is the fixed route path, not the URL, so no query text lands in the log. Target = "METHOD route".
 */
export async function auditAdminDenied(req: Request | undefined, route: string): Promise<void> {
  try {
    const u = await getCurrentUser({ allowUnverified: true, touch: false });
    if (!u) return;
    await write(u.userId, u.role, "ADMIN_DENIED", `${req?.method ?? "GET"} ${route}`, "denied", req ? clientIp(req) : "unknown");
  } catch { /* the refusal must still be answered as it was */ }
}

/** LOGIN_FAILED: wrong password for an existing account. Actor and target are the account id; the typed password is never read here. */
export async function auditLoginFailed(req: Request, accountId: string, role: string): Promise<void> {
  try {
    await write(accountId, role, "LOGIN_FAILED", accountId, "failed", clientIp(req));
  } catch { /* the 401 must still be answered as it was */ }
}

/** STEP_UP_FAILED: wrong password at a step-up prompt (N-15b). Target = "METHOD route". The typed password is never read here. */
export async function auditStepUpFailed(req: Request, user: { userId: string; role: string }, route: string): Promise<void> {
  try {
    await write(user.userId, user.role, "STEP_UP_FAILED", `${req.method} ${route}`, "failed", clientIp(req));
  } catch { /* the refusal must still be answered as it was */ }
}
