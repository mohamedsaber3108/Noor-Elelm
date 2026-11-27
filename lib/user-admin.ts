/**
 * Admin user management (N-18a): suspend or reactivate an account, and a short staff note.
 *
 * Suspending ends every session of that user at once. A suspended account cannot sign in
 * (app/api/auth/[action]/route.ts answers ACCOUNT_SUSPENDED only after the right password) and cannot use a
 * session (app/auth.ts getCurrentUser treats it as signed out). The caller (PUT /api/admin/users) has already
 * checked admin, origin and, for suspend and reactivate, step-up. Suspended admins do not count as active admins.
 * The note is plain text for staff only. Its audit row keeps only the length, never the text.
 */
import { clientIp } from "@/app/auth";
import { AUDIT_UNAVAILABLE, auditStatement, runAudited } from "@/lib/audit";

export const NOTE_MAX = 1000;
// No tags, no control characters (newline and tab allowed), no bidi control marks.
const BAD_NOTE = /[<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/;

type Actor = { userId: string; role: string };
type Result = { ok: true } | { ok: false; error: string; status: number };

/** Admins who are not suspended. */
export async function activeAdmins(db: D1Database): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND suspended_at IS NULL").first<{ n: number }>())?.n ?? 0;
}

/** Suspends (and signs out everywhere) or reactivates one account. reason is the step-up reason. */
export async function setSuspended(db: D1Database, req: Request, admin: Actor, id: string, suspend: boolean, reason: string): Promise<Result> {
  const t = await db.prepare("SELECT role,suspended_at FROM users WHERE id=?").bind(id).first<{ role: string; suspended_at: number | null }>();
  if (!t) return { ok: false, error: "NOT_FOUND", status: 404 };
  if (suspend === (t.suspended_at != null)) return { ok: false, error: suspend ? "ALREADY_SUSPENDED" : "NOT_SUSPENDED", status: 409 };
  if (suspend && t.role === "admin" && (await activeAdmins(db)) <= 1) return { ok: false, error: "LAST_ADMIN", status: 409 };
  const source = clientIp(req);
  const done = await runAudited(db, async () => [
    db.prepare("UPDATE users SET suspended_at=? WHERE id=?").bind(suspend ? Date.now() : null, id),
    ...(suspend ? [db.prepare("DELETE FROM sessions WHERE user_id=?").bind(id)] : []),
    await auditStatement(db, {
      actorId: admin.userId, actorRole: admin.role, action: suspend ? "USER_SUSPENDED" : "USER_REACTIVATED",
      targetId: id, detail: { role: t.role }, source, reason,
    }),
  ]);
  return done ? { ok: true } : { ok: false, error: AUDIT_UNAVAILABLE, status: 503 };
}

/** Sets or clears (empty text) the staff note. */
export async function setStaffNote(db: D1Database, req: Request, admin: Actor, id: string, raw: string): Promise<Result> {
  const note = raw.trim();
  if (note.length > NOTE_MAX || BAD_NOTE.test(note)) return { ok: false, error: "INVALID_NOTE", status: 400 };
  const t = await db.prepare("SELECT id FROM users WHERE id=?").bind(id).first();
  if (!t) return { ok: false, error: "NOT_FOUND", status: 404 };
  const done = await runAudited(db, async () => [
    db.prepare("UPDATE users SET staff_note=? WHERE id=?").bind(note || null, id),
    await auditStatement(db, { actorId: admin.userId, actorRole: admin.role, action: "STAFF_NOTE_SET", targetId: id, detail: { length: note.length }, source: clientIp(req) }),
  ]);
  return done ? { ok: true } : { ok: false, error: AUDIT_UNAVAILABLE, status: 503 };
}
