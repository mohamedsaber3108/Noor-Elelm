/**
 * Tamper-evident audit log (N-14a). Each row carries seq, prev_hash and hash (SHA-256 over a fixed canonical string).
 * Migration 0007 adds triggers that refuse UPDATE and DELETE on audit_events.
 *
 * Use auditStatement() inside the SAME db.batch as the action it records, through runAudited(): if the audit
 * row cannot be written, the whole batch (the action too) is not applied.
 *
 * shortcut: one writer wins per seq (unique index); the loser retries once, then the caller answers 503.
 * Upgrade to a durable-object counter if audit writes ever become hot.
 */

export const GENESIS = "0".repeat(64);
export const AUDIT_UNAVAILABLE = "AUDIT_UNAVAILABLE";

export type AuditInput = {
  id?: string; // row id; default random (the correction report id is its audit row id)
  actorId: string;
  actorRole?: string | null;
  action: string;
  targetId: string;
  detail?: Record<string, string | number | boolean | null>;
  result?: string;
  source?: string | null;
  reason?: string | null;
};

type Chained = {
  seq: number; prev_hash: string; actor_id: string; actor_role: string | null; action: string; target_id: string;
  detail_json: string; result: string | null; source: string | null; reason: string | null; created_at: string;
};

// A detail key that looks like a secret is a bug in the caller: refuse it instead of storing it.
const SECRET_KEY = /pass(word)?|token|secret|code|hash|key|cookie|otp/i;

const field = (v: string | number | null) => (v === null ? "-1:" : `${String(v).length}:${String(v)}`);

/** Fixed field order, each value length-prefixed (null = "-1:"), so no two different rows share one string. */
export function canonical(r: Chained): string {
  return [r.seq, r.prev_hash, r.actor_id, r.actor_role, r.action, r.target_id, r.detail_json, r.result, r.source, r.reason, r.created_at]
    .map(field).join("|");
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Same shape as CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS", UTC), so existing time queries keep working. */
const nowSql = () => new Date().toISOString().slice(0, 19).replace("T", " ");

/** Prepared INSERT for one audit row. Reads the chain tip just before; put the result in the action's batch. */
export async function auditStatement(db: D1Database, i: AuditInput): Promise<D1PreparedStatement> {
  const detail = i.detail ?? {};
  for (const k of Object.keys(detail)) if (SECRET_KEY.test(k)) throw new Error(`AUDIT_DETAIL_KEY_REFUSED:${k}`);
  const tip = await db.prepare("SELECT seq,hash FROM audit_events WHERE seq IS NOT NULL ORDER BY seq DESC LIMIT 1").first<{ seq: number; hash: string }>();
  const row: Chained = {
    seq: (tip?.seq ?? 0) + 1, prev_hash: tip?.hash ?? GENESIS, actor_id: i.actorId, actor_role: i.actorRole ?? null,
    action: i.action, target_id: i.targetId, detail_json: JSON.stringify(detail), result: i.result ?? "success",
    source: i.source ?? null, reason: i.reason ?? null, created_at: nowSql(),
  };
  const hash = await sha256Hex(canonical(row));
  return db.prepare(
    "INSERT INTO audit_events(id,actor_id,action,target_id,detail_json,created_at,seq,prev_hash,hash,actor_role,result,source,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).bind(i.id ?? crypto.randomUUID(), row.actor_id, row.action, row.target_id, row.detail_json, row.created_at, row.seq, row.prev_hash, hash, row.actor_role, row.result, row.source, row.reason);
}

/**
 * Runs build()'s statements as one batch. On failure (for example a concurrent writer took the same seq) it
 * rebuilds and tries once more. Returns false when both tries fail: nothing was applied, the caller answers 503.
 */
export async function runAudited(db: D1Database, build: () => Promise<D1PreparedStatement[]>): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await db.batch(await build());
      return true;
    } catch {
      /* retry once */
    }
  }
  return false;
}

export type AuditVerdict = { ok: boolean; brokenAt: number | null; checked: number; skipped: number };

/** Walks rows by seq. Rows without seq (written before migration 0007) are skipped and counted. */
export async function verifyAuditChain(db: D1Database): Promise<AuditVerdict> {
  const skipped = (await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE seq IS NULL").first<{ n: number }>())?.n ?? 0;
  let lastSeq = 0, lastHash = GENESIS, checked = 0;
  for (;;) {
    const rows = (await db.prepare(
      "SELECT seq,prev_hash,hash,actor_id,actor_role,action,target_id,detail_json,result,source,reason,created_at FROM audit_events WHERE seq>? ORDER BY seq LIMIT 500",
    ).bind(lastSeq).all<Chained & { hash: string }>()).results;
    if (rows.length === 0) return { ok: true, brokenAt: null, checked, skipped };
    for (const r of rows) {
      const bad = r.seq !== lastSeq + 1 || r.prev_hash !== lastHash || r.hash !== (await sha256Hex(canonical(r)));
      if (bad) return { ok: false, brokenAt: r.seq, checked, skipped };
      lastSeq = r.seq; lastHash = r.hash; checked++;
    }
  }
}
