import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { DELETE, GET, PUT } from "@/app/api/admin/users/route";
import { setEnv, call, count, db, seedUser, signIn, EVIL } from "../helpers";

const put = (body: unknown, o = {}) => PUT(call("PUT", "/api/admin/users", body, o));
const del = (body: unknown, o = {}) => DELETE(call("DELETE", "/api/admin/users", body, o));
const get = (q = "") => GET(call("GET", "/api/admin/users" + q) as never);

describe("admin users: access control", () => {
  it("returns 403 ADMIN_ACCESS_REQUIRED with no session on GET, PUT and DELETE", async () => {
    for (const res of [await get(), await put({ id: "x", role: "admin" }), await del({ id: "x" })]) {
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("ADMIN_ACCESS_REQUIRED");
    }
  });
  it("returns 403 for a learner on GET, PUT and DELETE, and changes nothing", async () => {
    const u = await signIn("learner");
    expect((await get()).status).toBe(403);
    expect((await put({ id: u.id, role: "admin" })).status).toBe(403);
    expect((await del({ id: u.id })).status).toBe(403);
    expect((await db().prepare("SELECT role FROM users WHERE id=?").bind(u.id).first<{ role: string }>())?.role).toBe("learner");
  });
  it("returns 403 for a reviewer on GET, PUT and DELETE (admin only)", async () => {
    const u = await signIn("reviewer");
    expect((await get()).status).toBe(403);
    expect((await put({ id: u.id, role: "admin" })).status).toBe(403);
    expect((await del({ id: u.id })).status).toBe(403);
  });
  it("does not let REVIEWER_IDS grant admin access", async () => {
    const u = await signIn("learner");
    setEnv("REVIEWER_IDS", u.id);
    expect((await get()).status).toBe(403);
  });
});

describe("GET /api/admin/users", () => {
  it("lists users with coins and returns platform stats", async () => {
    await signIn("admin");
    const l = await seedUser("learner", "ali@example.test");
    await db().prepare("INSERT INTO point_ledger(id,user_id,question_id,kind,delta,attempt_id) VALUES('p1',?,'t01','FIRST_CORRECT',1,'a1')").bind(l.id).run();
    const j = await (await get()).json();
    expect(j.total).toBe(2);
    expect(j.users.find((u: { email: string }) => u.email === "ali@example.test").coins).toBe(1);
    expect(j.stats).toMatchObject({ users: 2, coinsIssued: 1, roles: { admin: 1, learner: 1 } });
  });
  it("filters by search text, treating % and _ as plain characters", async () => {
    await signIn("admin");
    await seedUser("learner", "ali@example.test");
    expect((await (await get("?q=ALI")).json()).total).toBe(1);
    expect((await (await get("?q=%25")).json()).total).toBe(0);
    expect((await (await get("?q=_")).json()).total).toBe(0);
  });
  it("treats a bad page number as page 1", async () => {
    await signIn("admin");
    expect((await (await get("?page=abc")).json()).page).toBe(1);
    expect((await (await get("?page=-5")).json()).page).toBe(1);
  });
  it("returns 403 (not 503) when the database is not bound, because the session lookup fails first", async () => {
    env.DB = undefined;
    expect((await get()).status).toBe(403);
  });
});

describe("PUT /api/admin/users (change role)", () => {
  it("changes the role and writes a ROLE_CHANGED audit row with from and to", async () => {
    const admin = await signIn("admin");
    const t = await seedUser("learner");
    const res = await put({ id: t.id, role: "reviewer" });
    expect(res.status).toBe(200);
    expect((await db().prepare("SELECT role FROM users WHERE id=?").bind(t.id).first<{ role: string }>())?.role).toBe("reviewer");
    const a = await db().prepare("SELECT actor_id,target_id,detail_json FROM audit_events WHERE action='ROLE_CHANGED'").first<{ actor_id: string; target_id: string; detail_json: string }>();
    expect(a).toMatchObject({ actor_id: admin.id, target_id: t.id });
    expect(JSON.parse(a!.detail_json)).toEqual({ from: "learner", to: "reviewer" });
  });
  it("last-admin guard: demoting the only admin returns 409 LAST_ADMIN and changes nothing", async () => {
    const admin = await signIn("admin");
    const res = await put({ id: admin.id, role: "learner" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("LAST_ADMIN");
    expect((await db().prepare("SELECT role FROM users WHERE id=?").bind(admin.id).first<{ role: string }>())?.role).toBe("admin");
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='ROLE_CHANGED'")).toBe(0);
  });
  it("allows demoting an admin when another admin exists", async () => {
    const admin = await signIn("admin");
    await seedUser("admin");
    expect((await put({ id: admin.id, role: "learner" })).status).toBe(200);
  });
  it("returns 404 for an unknown user and 400 for a bad role or missing fields", async () => {
    await signIn("admin");
    expect((await put({ id: "nope", role: "learner" })).status).toBe(404);
    expect((await put({ id: "nope", role: "superuser" })).status).toBe(400);
    expect((await put({})).status).toBe(400);
    expect((await PUT(call("PUT", "/api/admin/users", "{bad"))).status).toBe(400);
  });
  it("returns 403 BAD_ORIGIN cross-origin and changes nothing", async () => {
    await signIn("admin");
    const t = await seedUser("learner");
    const res = await put({ id: t.id, role: "admin" }, EVIL);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("BAD_ORIGIN");
    expect((await db().prepare("SELECT role FROM users WHERE id=?").bind(t.id).first<{ role: string }>())?.role).toBe("learner");
  });
});

describe("DELETE /api/admin/users (revoke sessions)", () => {
  it("revokes every session of the target and writes an audit row", async () => {
    await signIn("admin");
    const t = await seedUser("learner");
    await db().prepare("INSERT INTO sessions(id,user_id,expires_at) VALUES('s1',?,?)").bind(t.id, Date.now() + 100000).run();
    expect((await del({ id: t.id })).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id=?", t.id)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='SESSIONS_REVOKED' AND target_id=?", t.id)).toBe(1);
  });
  it("returns 400 for a missing id", async () => {
    await signIn("admin");
    expect((await del({})).status).toBe(400);
  });
  it("returns 403 BAD_ORIGIN cross-origin and keeps the sessions", async () => {
    await signIn("admin");
    const t = await seedUser("learner");
    await db().prepare("INSERT INTO sessions(id,user_id,expires_at) VALUES('s1',?,?)").bind(t.id, Date.now() + 100000).run();
    expect((await del({ id: t.id }, EVIL)).status).toBe(403);
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id=?", t.id)).toBe(1);
  });
});
