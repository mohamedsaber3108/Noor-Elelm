import { NextRequest, NextResponse } from "next/server";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { clientIp, getCurrentUser, isAdmin, sameOrigin } from "@/app/auth";
import { AUDIT_UNAVAILABLE, auditStatement, runAudited } from "@/lib/audit";
import { auditAdminDenied } from "@/lib/audit-denied";
import { stepUp } from "@/lib/step-up";
import { csvFile, csvRow } from "@/lib/csv";

/**
 * POST /api/admin/users/export (N-18b): the user list as a CSV file.
 * Admin only, same origin, N-15b step-up (own password and a reason). The USER_EXPORT audit row is written FIRST:
 * no audit row, no file. The audit row holds only the row count, never personal data.
 * Columns hold no password hash, no MFA data and no staff note. At most EXPORT_MAX rows (header X-Export-Truncated).
 */
const ROUTE = "/api/admin/users/export";
const NO_STORE = { "Cache-Control": "no-store" };
export const EXPORT_MAX = 50_000;
export const EXPORT_COLUMNS = ["id", "email", "name", "role", "status", "email_verified", "created_at", "last_login_at", "coins"] as const;

const err = (error: string, status: number) => NextResponse.json({ error }, { status, headers: NO_STORE });
const schema = z.object({ password: z.string().max(200).optional(), reason: z.string().max(1000).optional() });

type Row = {
  id: string; email: string; name: string; role: string; suspended_at: number | null; email_verified_at: number | null;
  created_at: string | null; last_login_at: string | null; coins: number;
};

export async function POST(req: NextRequest) {
  const u = await getCurrentUser();
  const admin = u && isAdmin(u) ? u : null;
  if (!admin) { await auditAdminDenied(req, ROUTE); return err("ADMIN_ACCESS_REQUIRED", 403); }
  if (!sameOrigin(req)) return err("BAD_ORIGIN", 403);
  const db = env.DB;
  if (!db) return err("DATABASE_UNAVAILABLE", 503);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err("INVALID_INPUT", 400);
  const su = await stepUp(db, req, admin, parsed.data, ROUTE);
  if (!su.ok) return err(su.error, su.status);
  const rows = (await db.prepare(
    "SELECT u.id,u.email,u.display_name AS name,u.role,u.suspended_at,u.email_verified_at,u.created_at,u.last_login_at," +
      "COALESCE((SELECT SUM(delta) FROM point_ledger p WHERE p.user_id=u.id),0) AS coins FROM users u ORDER BY u.created_at, u.id LIMIT ?",
  ).bind(EXPORT_MAX + 1).all<Row>()).results;
  const truncated = rows.length > EXPORT_MAX;
  const out = rows.slice(0, EXPORT_MAX);
  const done = await runAudited(db, async () => [
    await auditStatement(db, {
      actorId: admin.userId, actorRole: admin.role, action: "USER_EXPORT", targetId: "users",
      detail: { rows: out.length, truncated }, source: clientIp(req), reason: su.reason,
    }),
  ]);
  if (!done) return err(AUDIT_UNAVAILABLE, 503);
  const body = csvFile([
    csvRow(EXPORT_COLUMNS),
    ...out.map((r) => csvRow([
      r.id, r.email, r.name, r.role, r.suspended_at != null ? "suspended" : "active", r.email_verified_at != null ? "yes" : "no",
      r.created_at, r.last_login_at, String(r.coins),
    ])),
  ]);
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    headers: {
      ...NO_STORE,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="noor-users-${day}.csv"`,
      "X-Content-Type-Options": "nosniff",
      ...(truncated ? { "X-Export-Truncated": "1" } : {}),
    },
  });
}
