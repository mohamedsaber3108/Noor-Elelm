import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { env } from "cloudflare:workers";
import { GET as verifyGet } from "@/app/api/admin/audit/verify/route";
import { DELETE as usersDel, PUT as usersPut } from "@/app/api/admin/users/route";
import { GENESIS, auditStatement, canonical, runAudited, verifyAuditChain } from "@/lib/audit";
import { call, count, db, seedUser, signIn, signInUnverified } from "../helpers";

const D = () => env.DB as unknown as D1Database;
const put = (body: unknown) => usersPut(call("PUT", "/api/admin/users", body));
const rows = async () =>
  (await db().prepare("SELECT * FROM audit_events WHERE seq IS NOT NULL ORDER BY seq").all<Record<string, string | number | null>>()).results;
const log = (action: string, extra: object = {}) =>
  runAudited(D(), async () => [await auditStatement(D(), { actorId: "a", actorRole: "admin", action, targetId: "t", source: "1.2.3.4", ...extra })]);

describe("audit chain", () => {
  it("links rows: seq counts up, prev_hash is the previous hash, the first starts at GENESIS", async () => {
    await log("A");
    await log("B", { detail: { n: 1 } });
    await log("C", { reason: "because" });
    const r = await rows();
    expect(r.map((x) => x.seq)).toEqual([1, 2, 3]);
    expect(r[0].prev_hash).toBe(GENESIS);
    expect(r[1].prev_hash).toBe(r[0].hash);
    expect(r[2].prev_hash).toBe(r[1].hash);
    expect(r[0]).toMatchObject({ actor_role: "admin", result: "success", source: "1.2.3.4" });
    expect(await verifyAuditChain(D())).toEqual({ ok: true, brokenAt: null, checked: 3, skipped: 0 });
  });

  it("canonical string is length-prefixed, so moving text between fields changes it", () => {
    const base = { seq: 1, prev_hash: GENESIS, actor_id: "ab", actor_role: null, action: "c", target_id: "t", detail_json: "{}", result: "success", source: null, reason: null, created_at: "x" };
    expect(canonical(base)).not.toBe(canonical({ ...base, actor_id: "a", action: "bc" }));
    expect(canonical(base)).not.toBe(canonical({ ...base, source: "" }));
  });

  it("the verifier finds a row whose content was changed after hashing", async () => {
    await log("A");
    await log("B");
    const r = await rows();
    // A forged row with the right link but a detail that was changed after the hash was made.
    const good = { seq: 3, prev_hash: r[1].hash as string, actor_id: "a", actor_role: "admin", action: "C", target_id: "t", detail_json: "{}", result: "success", source: null, reason: null, created_at: "2026-01-01 00:00:00" };
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(good))))].map((b) => b.toString(16).padStart(2, "0")).join("");
    await db().prepare("INSERT INTO audit_events(id,actor_id,action,target_id,detail_json,created_at,seq,prev_hash,hash,actor_role,result) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .bind("forged", "a", "C", "t", '{"changed":true}', good.created_at, 3, good.prev_hash, hash, "admin", "success").run();
    expect(await verifyAuditChain(D())).toMatchObject({ ok: false, brokenAt: 3, checked: 2 });
  });

  it("the verifier finds a gap in seq and a wrong prev_hash", async () => {
    await log("A");
    await db().prepare("INSERT INTO audit_events(id,actor_id,action,target_id,seq,prev_hash,hash) VALUES('g','a','X','t',5,'p','h')").run();
    expect(await verifyAuditChain(D())).toMatchObject({ ok: false, brokenAt: 5 });
  });

  it("old rows without seq are skipped and counted, and do not break new rows", async () => {
    await db().prepare("INSERT INTO audit_events(id,actor_id,action,target_id) VALUES('old1','u','OLD','t')").run();
    await db().prepare("INSERT INTO audit_events(id,actor_id,action,target_id) VALUES('old2','u','OLD','t')").run();
    expect(await verifyAuditChain(D())).toEqual({ ok: true, brokenAt: null, checked: 0, skipped: 2 });
    await log("NEW");
    expect(await verifyAuditChain(D())).toEqual({ ok: true, brokenAt: null, checked: 1, skipped: 2 });
    expect((await rows())[0].prev_hash).toBe(GENESIS);
  });
});

describe("append-only triggers", () => {
  it("migration 0007 holds both triggers", () => {
    const sql = readFileSync(new URL("../../drizzle/0007_audit_chain.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/CREATE TRIGGER `audit_events_no_update` BEFORE UPDATE ON `audit_events`[\s\S]*RAISE\(ABORT, 'AUDIT_APPEND_ONLY'\)/);
    expect(sql).toMatch(/CREATE TRIGGER `audit_events_no_delete` BEFORE DELETE ON `audit_events`[\s\S]*RAISE\(ABORT, 'AUDIT_APPEND_ONLY'\)/);
  });
  it("the stand-in applies the migration: UPDATE and DELETE are refused, for new and old rows", async () => {
    await log("A");
    await db().prepare("INSERT INTO audit_events(id,actor_id,action,target_id) VALUES('old','u','OLD','t')").run();
    for (const sql of ["UPDATE audit_events SET action='X'", "DELETE FROM audit_events", "UPDATE audit_events SET hash='x' WHERE id='old'", "DELETE FROM audit_events WHERE id='old'"]) {
      await expect(db().prepare(sql).run()).rejects.toThrow(/AUDIT_APPEND_ONLY/);
    }
    expect(await count("SELECT COUNT(*) AS n FROM audit_events")).toBe(2);
  });
});

describe("concurrent writers and failed audit writes", () => {
  it("two writers read the same tip: one wins, the retry lets both land in order", async () => {
    const [a, b] = await Promise.all([log("A"), log("B")]);
    expect(a && b).toBe(true);
    const r = await rows();
    expect(r.map((x) => x.seq)).toEqual([1, 2]);
    expect(r[1].prev_hash).toBe(r[0].hash);
    expect((await verifyAuditChain(D())).ok).toBe(true);
  });
  it("the unique index refuses a second row with the same seq", async () => {
    const s1 = await auditStatement(D(), { actorId: "a", action: "A", targetId: "t" });
    const s2 = await auditStatement(D(), { actorId: "a", action: "B", targetId: "t" });
    await s1.run();
    await expect(s2.run()).rejects.toThrow(/UNIQUE/);
  });
  it("a failing audit write fails the action: role change answers 503 and is not applied", async () => {
    await signIn("admin");
    const t = await seedUser("learner");
    await db().prepare("CREATE TRIGGER test_audit_down BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'DOWN'); END").run();
    const res = await put({ id: t.id, role: "reviewer" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("AUDIT_UNAVAILABLE");
    expect((await db().prepare("SELECT role FROM users WHERE id=?").bind(t.id).first<{ role: string }>())?.role).toBe("learner");
    expect(await count("SELECT COUNT(*) AS n FROM audit_events")).toBe(0);
  });
});

describe("converted writers", () => {
  it("role change, sessions revoked and MFA reset each write a chained row with role and source", async () => {
    const admin = await signIn("admin");
    const t = await seedUser("learner");
    expect((await put({ id: t.id, role: "reviewer" })).status).toBe(200);
    expect((await usersDel(call("DELETE", "/api/admin/users", { id: t.id }))).status).toBe(200);
    expect((await put({ id: t.id, resetMfa: true })).status).toBe(200);
    const r = await rows();
    expect(r.map((x) => x.action)).toEqual(["ROLE_CHANGED", "SESSIONS_REVOKED", "MFA_RESET"]);
    for (const x of r) expect(x).toMatchObject({ actor_id: admin.id, actor_role: "admin", result: "success", target_id: t.id });
    for (const x of r) expect(typeof x.source).toBe("string");
    expect(JSON.parse(r[0].detail_json as string)).toEqual({ from: "learner", to: "reviewer" });
    expect((await verifyAuditChain(D())).checked).toBe(3);
  });
  it("detail keys that look like secrets are refused before anything is written", async () => {
    for (const k of ["password", "token", "secret", "code", "hash", "apiKey"]) {
      await expect(auditStatement(D(), { actorId: "a", action: "A", targetId: "t", detail: { [k]: "x" } })).rejects.toThrow(/AUDIT_DETAIL_KEY_REFUSED/);
    }
    expect(await count("SELECT COUNT(*) AS n FROM audit_events")).toBe(0);
  });
});

describe("GET /api/admin/audit/verify", () => {
  const get = () => verifyGet();
  it("is refused with no session, for a learner, a reviewer, and an admin without verified MFA", async () => {
    expect((await get()).status).toBe(403);
    await signIn("learner");
    expect((await get()).status).toBe(403);
    await signIn("reviewer");
    expect((await get()).status).toBe(403);
    await signInUnverified("admin");
    expect((await get()).status).toBe(403);
  });
  it("returns the verdict to a verified admin, with no cache", async () => {
    await signIn("admin");
    await log("A");
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, brokenAt: null, checked: 1, skipped: 0 });
  });
});
