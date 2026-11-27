import { describe, expect, it } from "vitest";
import { db, count } from "./helpers";

describe("D1 stand-in", () => {
  it("applies the real migrations", async () => {
    const t = await db().prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('users','sessions','point_ledger','audit_events','content_items')").first<{ n: number }>();
    expect(t?.n).toBe(5);
  });
  it("binds positional and numbered parameters", async () => {
    expect(await db().prepare("SELECT ?1 + ?2 AS n").bind(2, 3).first("n")).toBe(5);
  });
  it("batch is a transaction: a failing statement rolls back the earlier ones", async () => {
    const ins = (id: string) => db().prepare("INSERT INTO users(id,email,display_name,password_hash) VALUES(?,?,?,?)").bind(id, `${id}@x.test`, "n", "h");
    await expect(db().batch([ins("a"), ins("b"), ins("a")])).rejects.toThrow();
    expect(await count("SELECT COUNT(*) AS n FROM users")).toBe(0);
  });
  it("run reports changes", async () => {
    const r = await db().prepare("DELETE FROM users").run();
    expect(r.meta.changes).toBe(0);
  });
});
