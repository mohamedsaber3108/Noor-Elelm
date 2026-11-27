import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { GET as auditGet } from "@/app/api/admin/audit/route";
import { GET as usersGet } from "@/app/api/admin/users/route";
import { GET as importGet } from "@/app/api/admin/import/route";
import { POST as authPost } from "@/app/api/auth/[action]/route";
import { auditStatement, runAudited } from "@/lib/audit";
import { PASSWORD, authCtx, call, count, db, seedUser, signIn, signInUnverified } from "../helpers";

const D = () => env.DB as unknown as D1Database;
const log = (action: string, extra: object = {}) =>
  runAudited(D(), async () => [await auditStatement(D(), { actorId: "a1", actorRole: "admin", action, targetId: "t1", source: "1.2.3.4", ...extra })]);
const list = (qs = "") => auditGet(call("GET", "/api/admin/audit" + qs));
const old = (id: string, created: string, detail = "{}", action = "OLD") =>
  db().prepare("INSERT INTO audit_events(id,actor_id,action,target_id,detail_json,created_at) VALUES(?,?,?,?,?,?)").bind(id, "u", action, "t", detail, created).run();
const denied = () => db().prepare("SELECT * FROM audit_events WHERE action='ADMIN_DENIED' ORDER BY seq").all<Record<string, string | number | null>>().then((r) => r.results);

describe("GET /api/admin/audit access", () => {
  it("is refused with no session, for a learner, a reviewer and an admin without verified MFA", async () => {
    expect((await list()).status).toBe(403);
    await signIn("learner");
    expect((await list()).status).toBe(403);
    await signIn("reviewer");
    expect((await list()).status).toBe(403);
    await signInUnverified("admin");
    expect((await list()).status).toBe(403);
  });
  it("answers a verified admin with no-store and the documented fields", async () => {
    await signIn("admin");
    await log("A", { reason: "why", detail: { n: 1 } });
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const j = await res.json();
    expect(j.pageSize).toBe(50);
    expect(j.next).toBeNull();
    expect(j.chain).toBeUndefined();
    expect(j.rows[0]).toMatchObject({ seq: 1, actorId: "a1", actorRole: "admin", action: "A", target: "t1", result: "success", source: "1.2.3.4", reason: "why", detail: '{"n":1}', detailCut: false });
    expect(j.rows[0].time).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });
  it("adds the chain verdict only with ?verify=1", async () => {
    await signIn("admin");
    await log("A");
    expect((await (await list("?verify=1")).json()).chain).toEqual({ ok: true, brokenAt: null, checked: 1, skipped: 0 });
  });
});

describe("GET /api/admin/audit filters and paging", () => {
  it("filters by action, actor, target, result and date", async () => {
    await signIn("admin");
    await log("A");
    await log("B", { actorId: "a2", targetId: "t2", result: "denied" });
    await old("o1", "2020-01-03 10:00:00", "{}", "A");
    const rows = async (qs: string) => (await (await list(qs)).json()).rows as { action: string }[];
    expect((await rows("?action=A")).length).toBe(2);
    expect((await rows("?action=B")).map((r) => r.action)).toEqual(["B"]);
    expect((await rows("?actor=a2")).length).toBe(1);
    expect((await rows("?target=t2")).length).toBe(1);
    expect((await rows("?result=denied")).length).toBe(1);
    expect((await rows("?from=2020-01-02T00:00:00Z&to=2020-01-04T00:00:00Z")).length).toBe(1);
    expect((await rows("?from=2021-01-01")).length).toBe(2);
    expect((await rows("?to=2020-01-03")).length).toBe(1); // date-only "to" includes that whole day
    expect((await rows("?to=2020-01-02")).length).toBe(0);
    expect((await rows("?to=2021-01-01")).length).toBe(1);
    expect((await rows("?action=NONE")).length).toBe(0);
  });
  it("refuses bad filter values with 400", async () => {
    await signIn("admin");
    for (const qs of ["?result=maybe", "?from=yesterday", "?limit=0", "?limit=abc", "?before=-1", "?action=a%20b", `?actor=${"x".repeat(65)}`]) {
      expect((await list(qs)).status, qs).toBe(400);
    }
  });
  it("pages newest first with the before cursor", async () => {
    await signIn("admin");
    for (let i = 1; i <= 7; i++) await log("E" + i);
    const p1 = await (await list("?limit=3")).json();
    expect(p1.rows.map((r: { seq: number }) => r.seq)).toEqual([7, 6, 5]);
    expect(p1.next).toEqual({ before: 5 });
    const p2 = await (await list("?limit=3&before=5")).json();
    expect(p2.rows.map((r: { seq: number }) => r.seq)).toEqual([4, 3, 2]);
    const p3 = await (await list("?limit=3&before=2")).json();
    expect(p3.rows.map((r: { seq: number }) => r.seq)).toEqual([1]);
    expect(p3.next).toBeNull();
  });
  it("caps the page size at 100 and defaults to 50", async () => {
    await signIn("admin");
    for (let i = 0; i < 105; i++) await old("o" + i, "2020-01-01 00:00:00");
    const big = await (await list("?limit=1000")).json();
    expect(big.pageSize).toBe(100);
    expect(big.rows.length).toBe(100);
    expect(big.next).not.toBeNull();
    expect((await (await list()).json()).rows.length).toBe(50);
  });
  it("returns old rows without seq after the chained rows, and pages through them", async () => {
    await signIn("admin");
    await old("o1", "2020-01-01 00:00:00");
    await old("o2", "2020-01-02 00:00:00");
    await log("N1");
    await log("N2");
    const p1 = await (await list("?limit=3")).json();
    expect(p1.rows.map((r: { seq: number | null }) => r.seq)).toEqual([2, 1, null]);
    expect(p1.rows[2].time).toBe("2020-01-02T00:00:00Z");
    expect(p1.next).toHaveProperty("beforeOld");
    const p2 = await (await list(`?limit=3&beforeOld=${p1.next.beforeOld}`)).json();
    expect(p2.rows.map((r: { time: string }) => r.time)).toEqual(["2020-01-01T00:00:00Z"]);
    expect(p2.next).toBeNull();
  });
});

describe("GET /api/admin/audit output", () => {
  it("blanks secret-looking keys on read and cuts detail at 500 characters", async () => {
    await signIn("admin");
    await old("s1", "2020-01-01 00:00:00", JSON.stringify({ password: "hunter2", nested: { apiKey: "k-123", fine: 1 }, list: [{ token: "t-9" }] }));
    await old("s2", "2020-01-02 00:00:00", JSON.stringify({ note: "x".repeat(900) }));
    await old("s3", "2020-01-03 00:00:00", "{broken");
    const j = await (await list()).json();
    const text = JSON.stringify(j);
    for (const secret of ["hunter2", "k-123", "t-9"]) expect(text).not.toContain(secret);
    const s1 = j.rows.find((r: { time: string }) => r.time.startsWith("2020-01-01"));
    expect(JSON.parse(s1.detail)).toEqual({ password: "[redacted]", nested: { apiKey: "[redacted]", fine: 1 }, list: [{ token: "[redacted]" }] });
    const s2 = j.rows.find((r: { time: string }) => r.time.startsWith("2020-01-02"));
    expect(s2.detail.length).toBe(500);
    expect(s2.detailCut).toBe(true);
    expect(j.rows.find((r: { time: string }) => r.time.startsWith("2020-01-03")).detail).toBe('"[unreadable]"');
  });
});

describe("ADMIN_DENIED rows", () => {
  it("a reviewer calling /api/admin/users gets 403 and a denied row with role, route and method", async () => {
    const u = await signIn("reviewer");
    const res = await usersGet(call("GET", "/api/admin/users?q=secret-search"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ADMIN_ACCESS_REQUIRED" });
    const r = await denied();
    expect(r.length).toBe(1);
    expect(r[0]).toMatchObject({ actor_id: u.id, actor_role: "reviewer", target_id: "GET /api/admin/users", result: "denied" });
    expect(typeof r[0].source).toBe("string");
  });
  it("an admin without MFA and a learner are logged; the two routes without a request argument are logged too", async () => {
    const a = await signInUnverified("admin");
    expect((await usersGet(call("GET", "/api/admin/users"))).status).toBe(403);
    expect((await denied())[0]).toMatchObject({ actor_id: a.id, actor_role: "admin" });
    await signIn("learner");
    expect((await importGet()).status).toBe(403);
    expect((await denied()).map((x) => x.target_id)).toEqual(["GET /api/admin/users", "GET /api/admin/import"]);
  });
  it("an anonymous request writes no row", async () => {
    expect((await usersGet(call("GET", "/api/admin/users"))).status).toBe(403);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events")).toBe(0);
  });
  it("writes at most 5 rows per actor and action in the window, and still answers 403 each time", async () => {
    await signIn("reviewer");
    for (let i = 0; i < 8; i++) expect((await usersGet(call("GET", "/api/admin/users"))).status).toBe(403);
    expect((await denied()).length).toBe(5);
  });
  it("a failed audit write does not turn the 403 into a 500", async () => {
    await signIn("reviewer");
    await db().prepare("CREATE TRIGGER test_audit_down BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'AUDIT_DOWN'); END").run();
    const res = await usersGet(call("GET", "/api/admin/users"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "ADMIN_ACCESS_REQUIRED" });
    expect(await count("SELECT COUNT(*) AS n FROM audit_events")).toBe(0);
  });
  it("the viewer itself logs a refused caller", async () => {
    await signIn("learner");
    expect((await list()).status).toBe(403);
    expect((await denied())[0].target_id).toBe("GET /api/admin/audit");
  });
});

describe("LOGIN_FAILED rows", () => {
  const login = (email: string, password: string) => authPost(call("POST", "/api/auth/login", { email, password }), authCtx("login"));
  it("a wrong password for an existing account writes a failed row with the account id and no password", async () => {
    const u = await seedUser("learner");
    const res = await login(u.email, "wrong-password-123");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "INVALID_CREDENTIALS" });
    const rows = (await db().prepare("SELECT * FROM audit_events WHERE action='LOGIN_FAILED'").all<Record<string, string | null>>()).results;
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ actor_id: u.id, target_id: u.id, actor_role: "learner", result: "failed" });
    expect(JSON.stringify(rows)).not.toContain("wrong-password-123");
    expect(JSON.stringify(rows)).not.toContain(u.email);
  });
  it("an unknown email writes nothing and answers the same", async () => {
    const res = await login("nobody@example.test", "wrong-password-123");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "INVALID_CREDENTIALS" });
    expect(await count("SELECT COUNT(*) AS n FROM audit_events")).toBe(0);
  });
  it("a good login writes no row, and repeated failures stop at 5 rows", async () => {
    const u = await seedUser("learner");
    expect((await login(u.email, PASSWORD)).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events")).toBe(0);
    for (let i = 0; i < 7; i++) expect((await login(u.email, "wrong-password-123")).status).toBe(401);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='LOGIN_FAILED'")).toBe(5);
  });
  it("a failed audit write leaves the 401 as it was", async () => {
    const u = await seedUser("learner");
    await db().prepare("CREATE TRIGGER test_audit_down BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'AUDIT_DOWN'); END").run();
    const res = await login(u.email, "wrong-password-123");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "INVALID_CREDENTIALS" });
  });
});

describe("clientIp", () => {
  it("caps the source header at 64 characters", async () => {
    const { clientIp } = await import("@/app/auth");
    expect(clientIp(new Request("http://x/", { headers: { "cf-connecting-ip": "1".repeat(500) } })).length).toBe(64);
  });
});
