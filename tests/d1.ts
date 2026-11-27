import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/**
 * Small D1 stand-in on Node's built-in node:sqlite (in-memory).
 * Supports prepare/bind/first/all/run/batch. batch() is one transaction: any failure rolls all back.
 * shortcut: only the D1 calls this app uses; no raw(), dump() or exec().
 */
class Stmt {
  constructor(private db: DatabaseSync, readonly sql: string, private args: SQLInputValue[] = []) {}
  bind(...args: unknown[]) {
    return new Stmt(this.db, this.sql, args as SQLInputValue[]);
  }
  private reads() {
    return this.db.prepare(this.sql).columns().length > 0;
  }
  /** Runs synchronously; used by both single calls and batch. */
  exec() {
    const s = this.db.prepare(this.sql);
    if (this.reads()) {
      const results = s.all(...this.args) as Record<string, unknown>[];
      return { success: true, results, meta: { changes: 0, rows_read: results.length } };
    }
    const r = s.run(...this.args);
    return { success: true, results: [] as Record<string, unknown>[], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async first<T = Record<string, unknown>>(col?: string): Promise<T | null> {
    const row = this.exec().results[0];
    if (!row) return null;
    return (col ? row[col] : row) as T;
  }
  async all<T = Record<string, unknown>>() {
    const r = this.exec();
    return { ...r, results: r.results as T[] };
  }
  async run() {
    return this.exec();
  }
}

export class D1Stub {
  constructor(private db: DatabaseSync) {}
  prepare(sql: string) {
    return new Stmt(this.db, sql);
  }
  async batch(stmts: Stmt[]) {
    this.db.exec("BEGIN");
    try {
      const out = stmts.map((s) => s.exec());
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}

const MIGRATIONS = new URL("../drizzle/", import.meta.url);

/** New in-memory database with the real drizzle migrations 0000..0004 applied in order. */
export function newDb() {
  const db = new DatabaseSync(":memory:");
  const files = readdirSync(MIGRATIONS).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    for (const part of readFileSync(new URL(f, MIGRATIONS), "utf8").split("--> statement-breakpoint")) {
      if (part.trim()) db.exec(part);
    }
  }
  return db;
}
