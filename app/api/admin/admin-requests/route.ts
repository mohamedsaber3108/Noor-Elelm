import { NextRequest, NextResponse } from "next/server";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { getCurrentUser, isAdmin, sameOrigin } from "@/app/auth";
import { auditAdminDenied } from "@/lib/audit-denied";
import { stepUp } from "@/lib/step-up";
import { decideRequest, expireRequests } from "@/lib/admin-requests";

const NO_STORE = { "Cache-Control": "no-store" };
const ROUTE = "/api/admin/admin-requests";
const err = (error: string, status: number) => NextResponse.json({ error }, { status, headers: NO_STORE });

async function adminOnly() {
  const u = await getCurrentUser();
  return u && isAdmin(u) ? u : null;
}

/** GET: open admin promotion requests (N-15c). Verified admins only. */
export async function GET(req: NextRequest) {
  const admin = await adminOnly();
  if (!admin) { await auditAdminDenied(req, ROUTE); return err("ADMIN_ACCESS_REQUIRED", 403); }
  const db = env.DB;
  if (!db) return err("DATABASE_UNAVAILABLE", 503);
  await expireRequests(db);
  const rows = await db.prepare(
    "SELECT r.id, r.target_id, t.display_name AS target_name, t.email AS target_email, r.requested_by, q.display_name AS requested_by_name, " +
      "r.reason, r.created_at, r.expires_at FROM admin_requests r LEFT JOIN users t ON t.id=r.target_id LEFT JOIN users q ON q.id=r.requested_by " +
      "WHERE r.status='PENDING' ORDER BY r.created_at LIMIT 50",
  ).all();
  return NextResponse.json({ requests: rows.results, me: admin.userId }, { headers: NO_STORE });
}

const postSchema = z.object({
  id: z.string().min(1).max(64),
  decision: z.enum(["APPROVE", "REJECT"]),
  password: z.string().max(200).optional(),
  reason: z.string().max(1000).optional(),
});

/** POST {id, decision, password, reason}: a different admin approves or rejects, after step-up. */
export async function POST(req: NextRequest) {
  const admin = await adminOnly();
  if (!admin) { await auditAdminDenied(req, ROUTE); return err("ADMIN_ACCESS_REQUIRED", 403); }
  if (!sameOrigin(req)) return err("BAD_ORIGIN", 403);
  const db = env.DB;
  if (!db) return err("DATABASE_UNAVAILABLE", 503);
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err("INVALID_INPUT", 400);
  const su = await stepUp(db, req, admin, parsed.data, ROUTE);
  if (!su.ok) return err(su.error, su.status);
  const r = await decideRequest(db, req, admin, parsed.data.id, parsed.data.decision, su.reason);
  if (!r.ok) return err(r.error, r.status);
  return NextResponse.json({ ok: true, status: r.status }, { headers: NO_STORE });
}
