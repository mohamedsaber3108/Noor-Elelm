import { NextRequest, NextResponse } from "next/server";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { clientIp, getCurrentUser, isAdmin, sameOrigin } from "@/app/auth";
import { AUDIT_UNAVAILABLE, auditStatement, runAudited } from "@/lib/audit";
import { auditAdminDenied } from "@/lib/audit-denied";
import { ROLES } from "@/lib/rbac";
import { stepUp } from "@/lib/step-up";

const err = (error: string, status: number) => NextResponse.json({ error }, { status });
const PAGE = 25;

async function adminOnly() {
  const u = await getCurrentUser();
  return isAdmin(u) ? u : null;
}

/** GET ?q=&page= -> user list plus platform statistics. */
export async function GET(req: NextRequest) {
  const admin = await adminOnly();
  if (!admin) { await auditAdminDenied(req, "/api/admin/users"); return err("ADMIN_ACCESS_REQUIRED", 403); }
  const db = env.DB;
  if (!db) return err("DATABASE_UNAVAILABLE", 503);
  const q = (req.nextUrl.searchParams.get("q") || "").trim().slice(0, 80).toLowerCase();
  const page = Math.max(1, Math.min(10_000, Number(req.nextUrl.searchParams.get("page")) || 1));
  const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const [users, total, stats] = await Promise.all([
    db.prepare(
      "SELECT u.id,u.email,u.display_name AS name,u.role,u.created_at AS createdAt,u.last_login_at AS lastLoginAt," +
        "COALESCE((SELECT SUM(delta) FROM point_ledger p WHERE p.user_id=u.id),0) AS coins " +
        "FROM users u WHERE (?1='' OR lower(u.email) LIKE ?2 ESCAPE '\\' OR lower(u.display_name) LIKE ?2 ESCAPE '\\') " +
        "ORDER BY u.created_at DESC LIMIT ?3 OFFSET ?4",
    ).bind(q, like, PAGE, (page - 1) * PAGE).all(),
    db.prepare("SELECT COUNT(*) AS n FROM users u WHERE (?1='' OR lower(u.email) LIKE ?2 ESCAPE '\\' OR lower(u.display_name) LIKE ?2 ESCAPE '\\')").bind(q, like).first<{ n: number }>(),
    db.batch([
      db.prepare("SELECT COUNT(*) AS n FROM users"),
      db.prepare("SELECT COUNT(*) AS n FROM users WHERE created_at>=datetime('now','-7 days')"),
      db.prepare("SELECT COUNT(*) AS n FROM users WHERE last_login_at>=datetime('now','-7 days')"),
      db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE expires_at>?").bind(Date.now()),
      db.prepare("SELECT COUNT(*) AS n FROM quiz_attempts"),
      db.prepare("SELECT COUNT(*) AS n FROM quiz_attempts WHERE correct=1"),
      db.prepare("SELECT COALESCE(SUM(delta),0) AS n FROM point_ledger"),
      db.prepare("SELECT COUNT(*) AS n FROM bookmarks"),
      db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='CORRECTION_REPORT'"),
      db.prepare("SELECT COUNT(*) AS n FROM content_items"),
      db.prepare("SELECT COUNT(*) AS n FROM reviews"),
      db.prepare("SELECT role AS k, COUNT(*) AS n FROM users GROUP BY role"),
    ]),
  ]);
  const n = (i: number) => (stats[i].results[0] as { n: number } | undefined)?.n ?? 0;
  return NextResponse.json({
    users: users.results, total: total?.n ?? 0, page, pageSize: PAGE,
    stats: {
      users: n(0), newUsers7d: n(1), activeUsers7d: n(2), activeSessions: n(3), quizAttempts: n(4), quizCorrect: n(5),
      coinsIssued: n(6), bookmarks: n(7), correctionReports: n(8), importedDrafts: n(9), reviews: n(10),
      roles: Object.fromEntries((stats[11].results as { k: string; n: number }[]).map((r) => [r.k, r.n])),
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

const putSchema = z.union([
  z.object({ id: z.string().min(1).max(64), role: z.enum(ROLES), password: z.string().max(200).optional(), reason: z.string().max(1000).optional() }),
  z.object({ id: z.string().min(1).max(64), resetMfa: z.literal(true) }),
]);

/** PUT {id, role, password, reason} changes a user's role after step-up (lib/step-up.ts). PUT {id, resetMfa:true} clears another user's MFA (lost device); the admin needs their own verified MFA session. */
export async function PUT(req: NextRequest) {
  const admin = await adminOnly();
  if (!admin) { await auditAdminDenied(req, "/api/admin/users"); return err("ADMIN_ACCESS_REQUIRED", 403); }
  if (!sameOrigin(req)) return err("BAD_ORIGIN", 403);
  const db = env.DB;
  if (!db) return err("DATABASE_UNAVAILABLE", 503);
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err("INVALID_INPUT", 400);
  const { id } = parsed.data;
  if ("resetMfa" in parsed.data) {
    if (id === admin.userId) return err("SELF_RESET_REFUSED", 403);
    const who = await db.prepare("SELECT id FROM users WHERE id=?").bind(id).first();
    if (!who) return err("NOT_FOUND", 404);
    // The target must enrol again at next sign-in: MFA rows, recovery codes and all their sessions go.
    const done = await runAudited(db, async () => [
      db.prepare("DELETE FROM user_mfa WHERE user_id=?").bind(id),
      db.prepare("DELETE FROM mfa_recovery_codes WHERE user_id=?").bind(id),
      db.prepare("DELETE FROM sessions WHERE user_id=?").bind(id),
      await auditStatement(db, { actorId: admin.userId, actorRole: admin.role, action: "MFA_RESET", targetId: id, source: clientIp(req) }),
    ]);
    if (!done) return err(AUDIT_UNAVAILABLE, 503);
    return NextResponse.json({ ok: true });
  }
  const { role } = parsed.data;
  // Step-up (N-15b): every role change, including making an admin, needs the caller password again and a reason.
  const su = await stepUp(db, req, admin, parsed.data, "/api/admin/users");
  if (!su.ok) return err(su.error, su.status);
  const target = await db.prepare("SELECT role FROM users WHERE id=?").bind(id).first<{ role: string }>();
  if (!target) return err("NOT_FOUND", 404);
  if (target.role === "admin" && role !== "admin") {
    const n = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").first<{ n: number }>();
    if ((n?.n ?? 0) <= 1) return err("LAST_ADMIN", 409);
  }
  const done = await runAudited(db, async () => [
    db.prepare("UPDATE users SET role=? WHERE id=?").bind(role, id),
    await auditStatement(db, { actorId: admin.userId, actorRole: admin.role, action: "ROLE_CHANGED", targetId: id, detail: { from: target.role, to: role }, source: clientIp(req), reason: su.reason }),
  ]);
  if (!done) return err(AUDIT_UNAVAILABLE, 503);
  return NextResponse.json({ ok: true });
}

/** DELETE {id} signs a user out everywhere (revokes sessions). */
export async function DELETE(req: NextRequest) {
  const admin = await adminOnly();
  if (!admin) { await auditAdminDenied(req, "/api/admin/users"); return err("ADMIN_ACCESS_REQUIRED", 403); }
  if (!sameOrigin(req)) return err("BAD_ORIGIN", 403);
  const db = env.DB;
  if (!db) return err("DATABASE_UNAVAILABLE", 503);
  const parsed = z.object({ id: z.string().min(1).max(64) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err("INVALID_INPUT", 400);
  const done = await runAudited(db, async () => [
    db.prepare("DELETE FROM sessions WHERE user_id=?").bind(parsed.data.id),
    await auditStatement(db, { actorId: admin.userId, actorRole: admin.role, action: "SESSIONS_REVOKED", targetId: parsed.data.id, detail: {}, source: clientIp(req) }),
  ]);
  if (!done) return err(AUDIT_UNAVAILABLE, 503);
  return NextResponse.json({ ok: true });
}
