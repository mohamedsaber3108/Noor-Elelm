import { NextResponse } from "next/server";
import { env } from "cloudflare:workers";
import { getCurrentUser, isReviewer } from "@/app/auth";
import { auditAdminDenied } from "@/lib/audit-denied";
import { archiveRows, visualQueue } from "@/lib/visual-queue";

const NO_STORE = { "Cache-Control": "no-store" };
const DECISIONS = ["APPROVE", "REJECT", "REQUEST_CHANGES"] as const;
// Bound parameters per query stay well under the D1 limit of 100.
const CHUNK = 90;

const err = (error: string, status: number) => NextResponse.json({ error }, { status, headers: NO_STORE });
const count = async (db: D1Database, sql: string, ...args: unknown[]) =>
  Number((await db.prepare(sql).bind(...args).first<{ n: number | null }>())?.n ?? 0);

/** SQLite CURRENT_TIMESTAMP text ("YYYY-MM-DD HH:MM:SS", UTC) to a Date. */
const fromSql = (t: string) => new Date(t.replace(" ", "T") + "Z");

/**
 * GET: editorial dashboard on real counts. Reviewer or admin with a verified MFA session. Read-only, no-store.
 * Every number is a database count; nothing is hard-coded. Publication is disabled, so the released count is 0.
 */
export async function GET(req?: Request) {
  const u = await getCurrentUser();
  if (!isReviewer(u)) {
    await auditAdminDenied(req, "/api/admin/editorial");
    return err("REVIEWER_ACCESS_REQUIRED", 403);
  }
  const db = env.DB;
  if (!db) return err("DATABASE_UNAVAILABLE", 503);

  const byStatus = (await db.prepare("SELECT status, COUNT(*) AS n FROM content_items GROUP BY status ORDER BY status").all<{ status: string; n: number }>()).results
    .map((r) => ({ status: r.status, count: Number(r.n) }));
  const imported = byStatus.reduce((a, r) => a + r.count, 0);

  const reviewRows = (await db.prepare(
    "SELECT decision, COUNT(*) AS total," +
      " SUM(CASE WHEN created_at>=datetime('now','-7 days') THEN 1 ELSE 0 END) AS d7," +
      " SUM(CASE WHEN created_at>=datetime('now','-30 days') THEN 1 ELSE 0 END) AS d30" +
      " FROM reviews GROUP BY decision",
  ).all<{ decision: string; total: number; d7: number | null; d30: number | null }>()).results;
  const reviews = DECISIONS.map((decision) => {
    const r = reviewRows.find((x) => x.decision === decision);
    return { decision, total: Number(r?.total ?? 0), last7Days: Number(r?.d7 ?? 0), last30Days: Number(r?.d30 ?? 0) };
  });
  const reviewedItems = await count(db, "SELECT COUNT(DISTINCT content_id) AS n FROM reviews");

  const corrTotal = await count(db, "SELECT COUNT(*) AS n FROM audit_events WHERE action='CORRECTION_REPORT'");
  const corr7 = await count(db, "SELECT COUNT(*) AS n FROM audit_events WHERE action='CORRECTION_REPORT' AND created_at>=datetime('now','-7 days')");
  const oldest = (await db.prepare("SELECT MIN(created_at) AS t FROM audit_events WHERE action='CORRECTION_REPORT'").first<{ t: string | null }>())?.t ?? null;
  const oldestAgeDays = oldest ? Math.max(0, Math.floor((Date.now() - fromSql(oldest).getTime()) / 86_400_000)) : null;

  const ids = visualQueue.map((r) => r.id);
  const reviewedInQueue = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const rows = (await db.prepare(`SELECT DISTINCT content_id FROM reviews WHERE content_id IN (${part.map(() => "?").join(",")})`)
      .bind(...part).all<{ content_id: string }>()).results;
    for (const r of rows) reviewedInQueue.add(r.content_id);
  }

  return NextResponse.json({
    content: { byStatus, imported, available: archiveRows.length },
    reviews: { byDecision: reviews, reviewedItems },
    corrections: { total: corrTotal, last7Days: corr7, oldestAgeDays, statusField: false },
    infographics: { queue: ids.length, withDecision: reviewedInQueue.size },
    publication: { enabled: false, released: 0 },
  }, { headers: NO_STORE });
}
