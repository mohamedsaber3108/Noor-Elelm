import { NextRequest, NextResponse } from "next/server";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { getCurrentUser, isAdmin } from "@/app/auth";
import { SECRET_KEY, verifyAuditChain } from "@/lib/audit";
import { auditAdminDenied } from "@/lib/audit-denied";

const NO_STORE = { "Cache-Control": "no-store" };
const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;
const DETAIL_MAX = 500;

const err = (error: string, status: number) => NextResponse.json({ error }, { status, headers: NO_STORE });

// UTC ISO date or date-time. A value without a zone is read as UTC.
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const when = z.string().max(40).regex(ISO).refine((s) => !Number.isNaN(Date.parse(/(Z|[+-]\d{2}:\d{2})$/.test(s) || !s.includes("T") ? s : s + "Z")))
  .transform((s) => new Date(/(Z|[+-]\d{2}:\d{2})$/.test(s) || !s.includes("T") ? s : s + "Z"));
const intParam = z.string().regex(/^\d{1,12}$/).transform(Number);

const query = z.object({
  action: z.string().min(1).max(64).regex(/^[A-Za-z0-9_.:-]+$/).optional(),
  actor: z.string().min(1).max(64).optional(),
  target: z.string().min(1).max(128).optional(),
  result: z.enum(["success", "denied", "failed"]).optional(),
  from: when.optional(),
  to: when.optional(),
  limit: intParam.pipe(z.number().int().min(1)).optional(),
  before: intParam.optional(),
  beforeOld: intParam.optional(),
  verify: z.enum(["0", "1"]).optional(),
});

/** SQLite CURRENT_TIMESTAMP shape ("YYYY-MM-DD HH:MM:SS", UTC), the same text the audit writer stores. */
const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEY.test(k) ? "[redacted]" : redact(x)]));
  return v;
}

/** detail_json for display: parsed, secret-looking keys blanked, cut to DETAIL_MAX characters. */
function showDetail(raw: string | null): { detail: string; detailCut: boolean } {
  let text: string;
  try { text = JSON.stringify(redact(JSON.parse(raw ?? "{}"))); } catch { text = '"[unreadable]"'; }
  return text.length > DETAIL_MAX ? { detail: text.slice(0, DETAIL_MAX), detailCut: true } : { detail: text, detailCut: false };
}

type Row = {
  rid: number; seq: number | null; created_at: string | null; actor_id: string; actor_role: string | null; action: string;
  target_id: string; result: string | null; source: string | null; reason: string | null; detail_json: string | null;
};

/**
 * GET: read-only list of audit rows, newest first. Admin with a verified MFA session only.
 * Cursor: `before` = seq of the last row you have (chained rows), then `beforeOld` = rowid of the last old row.
 * shortcut: rows from before migration 0007 have no seq; they come after every chained row, in insertion order
 * (which is time order, created_at defaults to the insert time). Upgrade if old rows are ever imported out of order.
 */
export async function GET(req: NextRequest) {
  const u = await getCurrentUser();
  if (!isAdmin(u)) {
    await auditAdminDenied(req, "/api/admin/audit");
    return err("ADMIN_ACCESS_REQUIRED", 403);
  }
  const db = env.DB;
  if (!db) return err("DATABASE_UNAVAILABLE", 503);
  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return err("INVALID_INPUT", 400);
  const q = parsed.data;
  const size = Math.min(q.limit ?? DEFAULT_PAGE, MAX_PAGE);

  const where: string[] = [];
  const args: (string | number)[] = [];
  const add = (sql: string, v: string | number) => { where.push(sql); args.push(v); };
  if (q.action) add("action=?", q.action);
  if (q.actor) add("actor_id=?", q.actor);
  if (q.target) add("target_id=?", q.target);
  if (q.result) add("result=?", q.result);
  if (q.from) add("created_at>=?", sqlTime(q.from));
  if (q.to) add("created_at<=?", sqlTime(q.to));
  if (q.beforeOld !== undefined) { where.push("seq IS NULL"); add("rowid<?", q.beforeOld); }
  else if (q.before !== undefined) add("(seq<? OR seq IS NULL)", q.before);

  const rows = (await db.prepare(
    "SELECT rowid AS rid,seq,created_at,actor_id,actor_role,action,target_id,result,source,reason,detail_json FROM audit_events" +
      (where.length ? " WHERE " + where.join(" AND ") : "") +
      " ORDER BY (seq IS NULL), seq DESC, rowid DESC LIMIT ?",
  ).bind(...args, size + 1).all<Row>()).results;
  const more = rows.length > size;
  const page = rows.slice(0, size);
  const last = page[page.length - 1];
  const next = more && last ? (last.seq !== null ? { before: last.seq } : { beforeOld: last.rid }) : null;

  return NextResponse.json({
    rows: page.map((r) => ({
      seq: r.seq, time: r.created_at ? r.created_at.replace(" ", "T") + "Z" : null, actorId: r.actor_id, actorRole: r.actor_role,
      action: r.action, target: r.target_id, result: r.result, source: r.source, reason: r.reason, ...showDetail(r.detail_json),
    })),
    pageSize: size, next,
    ...(q.verify === "1" ? { chain: await verifyAuditChain(db) } : {}),
  }, { headers: NO_STORE });
}
