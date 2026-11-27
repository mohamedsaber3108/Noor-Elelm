/**
 * Admin promotion requests (N-15c, ADMIN_FOUNDATION s.6; default taken in QUESTIONS.md section H).
 *
 * From 2 admins on, making someone an admin is a request by one admin (after step-up, lib/step-up.ts) that a
 * different admin approves or rejects (also after step-up). The server refuses self-approval. A request expires
 * after REQUEST_TTL_MS. At most one PENDING request per target (unique partial index, migration 0010).
 * With fewer than 2 admins the users route promotes at once and marks the audit row single_admin_bootstrap.
 * Audit actions: ADMIN_PROMOTION_REQUESTED, ROLE_CHANGED (detail.mode "second_approver"), ADMIN_PROMOTION_REJECTED.
 */
import { clientIp } from "@/app/auth";
import { AUDIT_UNAVAILABLE, auditStatement, runAudited } from "@/lib/audit";

export const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

type Actor = { userId: string; role: string };
type Fail = { ok: false; error: string; status: number };

const isUniquePending = (e: unknown) => /UNIQUE/i.test(String(e instanceof Error ? e.message : e)) && /admin_requests/i.test(String(e instanceof Error ? e.message : e));
const isGuardStop = (e: unknown) => /integer overflow/i.test(String(e instanceof Error ? e.message : e));

/** Marks PENDING requests past their expiry as EXPIRED. */
export async function expireRequests(db: D1Database): Promise<void> {
  await db.prepare("UPDATE admin_requests SET status='EXPIRED' WHERE status='PENDING' AND expires_at<=?").bind(Date.now()).run();
}

/** Opens a PENDING promotion request. The caller has passed step-up; reason is the step-up reason. */
export async function requestPromotion(db: D1Database, req: Request, admin: Actor, targetId: string, reason: string): Promise<{ ok: true; id: string } | Fail> {
  await expireRequests(db);
  const open = await db.prepare("SELECT id FROM admin_requests WHERE target_id=? AND status='PENDING'").bind(targetId).first();
  if (open) return { ok: false, error: "REQUEST_PENDING", status: 409 };
  const id = crypto.randomUUID(), now = Date.now();
  try {
    const done = await runAudited(db, async () => [
      db.prepare("INSERT INTO admin_requests(id,target_id,requested_by,reason,status,created_at,expires_at) VALUES(?,?,?,?,'PENDING',?,?)")
        .bind(id, targetId, admin.userId, reason, now, now + REQUEST_TTL_MS),
      await auditStatement(db, { actorId: admin.userId, actorRole: admin.role, action: "ADMIN_PROMOTION_REQUESTED", targetId, detail: { requestId: id }, source: clientIp(req), reason }),
    ]);
    return done ? { ok: true, id } : { ok: false, error: AUDIT_UNAVAILABLE, status: 503 };
  } catch (e) {
    // Two admins asked at the same moment: the unique partial index let only one in.
    if (isUniquePending(e)) return { ok: false, error: "REQUEST_PENDING", status: 409 };
    throw e;
  }
}

/** A different admin approves or rejects a PENDING request. The caller has passed step-up; reason is the step-up reason. */
export async function decideRequest(
  db: D1Database, req: Request, admin: Actor, id: string, decision: "APPROVE" | "REJECT", reason: string,
): Promise<{ ok: true; status: "APPROVED" | "REJECTED" } | Fail> {
  await expireRequests(db);
  const r = await db.prepare("SELECT id,target_id,requested_by,status FROM admin_requests WHERE id=?").bind(id)
    .first<{ id: string; target_id: string; requested_by: string; status: string }>();
  if (!r) return { ok: false, error: "NOT_FOUND", status: 404 };
  if (r.status !== "PENDING") return { ok: false, error: "REQUEST_CLOSED", status: 409 };
  if (r.requested_by === admin.userId || r.target_id === admin.userId) return { ok: false, error: "SELF_APPROVAL_REFUSED", status: 403 };
  // The request stands only while its requester is still an admin.
  const requester = await db.prepare("SELECT role FROM users WHERE id=?").bind(r.requested_by).first<{ role: string }>();
  if (requester?.role !== "admin") return { ok: false, error: "REQUEST_CLOSED", status: 409 };
  const target = await db.prepare("SELECT role FROM users WHERE id=?").bind(r.target_id).first<{ role: string }>();
  if (!target) return { ok: false, error: "NOT_FOUND", status: 404 };
  const status = decision === "APPROVE" ? "APPROVED" : "REJECTED";
  const now = Date.now(), source = clientIp(req);
  // Guard first in the batch: if another admin closed the request after the read above, the batch stops here and
  // rolls back, so no role change and no second audit row are written.
  const guard = db.prepare("SELECT CASE WHEN EXISTS(SELECT 1 FROM admin_requests WHERE id=? AND status='PENDING' AND expires_at>?) THEN 1 ELSE abs(-9223372036854775808) END AS ok").bind(id, now);
  const close = db.prepare("UPDATE admin_requests SET status=?,decided_by=?,decided_at=? WHERE id=? AND status='PENDING'").bind(status, admin.userId, now, id);
  try {
    const done = await runAudited(db, async () => decision === "APPROVE"
      ? [
        guard,
        close,
        db.prepare("UPDATE users SET role='admin' WHERE id=?").bind(r.target_id),
        await auditStatement(db, {
          actorId: admin.userId, actorRole: admin.role, action: "ROLE_CHANGED", targetId: r.target_id,
          detail: { from: target.role, to: "admin", mode: "second_approver", requestId: id, requestedBy: r.requested_by }, source, reason,
        }),
      ]
      : [
        guard,
        close,
        await auditStatement(db, {
          actorId: admin.userId, actorRole: admin.role, action: "ADMIN_PROMOTION_REJECTED", targetId: r.target_id,
          detail: { requestId: id, requestedBy: r.requested_by }, source, reason,
        }),
      ]);
    return done ? { ok: true, status } : { ok: false, error: AUDIT_UNAVAILABLE, status: 503 };
  } catch (e) {
    if (isGuardStop(e)) return { ok: false, error: "REQUEST_CLOSED", status: 409 };
    throw e;
  }
}
