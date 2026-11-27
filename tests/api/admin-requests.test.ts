import { describe, expect, it } from "vitest";
import { PUT as usersPut } from "@/app/api/admin/users/route";
import { GET as reqGet, POST as reqPost } from "@/app/api/admin/admin-requests/route";
import { REQUEST_TTL_MS, decideRequest, requestPromotion } from "@/lib/admin-requests";
import { env } from "cloudflare:workers";
import { SESSION_COOKIE, createSession } from "@/app/auth";
import { setCookie } from "../mocks/next-headers";
import { EVIL, STEP_UP, call, count, db, seedUser, signIn } from "../helpers";

const promote = (id: string) => usersPut(call("PUT", "/api/admin/users", { id, role: "admin", ...STEP_UP }));
const decide = (id: string, decision: string, extra: object = STEP_UP, o = {}) =>
  reqPost(call("POST", "/api/admin/admin-requests", { id, decision, ...extra }, o));
const list = async () =>
  (await (await reqGet(call("GET", "/api/admin/admin-requests"))).json()) as { requests: { id: string; target_id: string; requested_by: string }[]; me: string };
const roleOf = async (id: string) => (await db().prepare("SELECT role FROM users WHERE id=?").bind(id).first<{ role: string }>())?.role;
/** Switches the mocked cookie jar to a new verified session of this user. */
const actAs = async (userId: string) => setCookie(SESSION_COOKIE, await createSession(userId, "vitest", { mfaVerified: true }));

/** Two admins exist; the signed-in one (a1) asks to promote a learner (t). */
async function twoAdminsAndRequest() {
  const a1 = await signIn("admin");
  const a2 = await seedUser("admin");
  const t = await seedUser("learner");
  const res = await promote(t.id);
  return { a1, a2, t, res };
}

describe("promotion with fewer than 2 admins (single_admin_bootstrap)", () => {
  it("one admin promotes with step-up alone and the audit row is marked", async () => {
    await signIn("admin");
    const t = await seedUser("learner");
    expect((await promote(t.id)).status).toBe(200);
    expect(await roleOf(t.id)).toBe("admin");
    const a = await db().prepare("SELECT detail_json,reason FROM audit_events WHERE action='ROLE_CHANGED'").first<{ detail_json: string; reason: string }>();
    expect(JSON.parse(a!.detail_json)).toEqual({ from: "learner", to: "admin", mode: "single_admin_bootstrap" });
    expect(a!.reason).toBe(STEP_UP.reason);
    expect(await count("SELECT COUNT(*) AS n FROM admin_requests")).toBe(0);
  });
  it("with 2 admins, a non-admin role still changes at once", async () => {
    await signIn("admin");
    await seedUser("admin");
    const t = await seedUser("learner");
    expect((await usersPut(call("PUT", "/api/admin/users", { id: t.id, role: "scholar", ...STEP_UP }))).status).toBe(200);
    expect(await roleOf(t.id)).toBe("scholar");
  });
});

describe("promotion with 2 or more admins (second approver)", () => {
  it("becomes a PENDING request (202); the role does not change; the request is listed and audited", async () => {
    const { a1, t, res } = await twoAdminsAndRequest();
    expect(res.status).toBe(202);
    const j = await res.json();
    expect(j.status).toBe("PENDING_APPROVAL");
    expect(await roleOf(t.id)).toBe("learner");
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='ADMIN_PROMOTION_REQUESTED' AND actor_id=? AND target_id=?", a1.id, t.id)).toBe(1);
    const l = await list();
    expect(l.me).toBe(a1.id);
    expect(l.requests).toHaveLength(1);
    expect(l.requests[0]).toMatchObject({ id: j.requestId, target_id: t.id, requested_by: a1.id });
  });
  it("the requester cannot approve their own request: 403 SELF_APPROVAL_REFUSED", async () => {
    const { t, res } = await twoAdminsAndRequest();
    const { requestId } = await res.json();
    const r = await decide(requestId, "APPROVE");
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("SELF_APPROVAL_REFUSED");
    expect(await roleOf(t.id)).toBe("learner");
  });
  it("a different admin approves: role becomes admin, request APPROVED, ROLE_CHANGED says second_approver", async () => {
    const { a1, a2, t, res } = await twoAdminsAndRequest();
    const { requestId } = await res.json();
    await actAs(a2.id);
    const r = await decide(requestId, "APPROVE");
    expect(r.status).toBe(200);
    expect((await r.json()).status).toBe("APPROVED");
    expect(await roleOf(t.id)).toBe("admin");
    expect(await db().prepare("SELECT status,decided_by FROM admin_requests WHERE id=?").bind(requestId).first()).toEqual({ status: "APPROVED", decided_by: a2.id });
    const a = await db().prepare("SELECT actor_id,detail_json,reason FROM audit_events WHERE action='ROLE_CHANGED'").first<{ actor_id: string; detail_json: string; reason: string }>();
    expect(a!.actor_id).toBe(a2.id);
    expect(a!.reason).toBe(STEP_UP.reason);
    expect(JSON.parse(a!.detail_json)).toEqual({ from: "learner", to: "admin", mode: "second_approver", requestId, requestedBy: a1.id });
    const again = await decide(requestId, "APPROVE");
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("REQUEST_CLOSED");
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='ROLE_CHANGED'")).toBe(1);
  });
  it("a different admin rejects: role stays, request REJECTED, one ADMIN_PROMOTION_REJECTED row", async () => {
    const { a2, t, res } = await twoAdminsAndRequest();
    const { requestId } = await res.json();
    await actAs(a2.id);
    const r = await decide(requestId, "REJECT");
    expect(r.status).toBe(200);
    expect(await roleOf(t.id)).toBe("learner");
    expect((await db().prepare("SELECT status FROM admin_requests WHERE id=?").bind(requestId).first<{ status: string }>())?.status).toBe("REJECTED");
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='ADMIN_PROMOTION_REJECTED' AND actor_id=?", a2.id)).toBe(1);
  });
  it("approve needs step-up: no password 400, wrong password 403, role unchanged", async () => {
    const { a2, t, res } = await twoAdminsAndRequest();
    const { requestId } = await res.json();
    await actAs(a2.id);
    expect((await decide(requestId, "APPROVE", { reason: STEP_UP.reason })).status).toBe(400);
    expect((await decide(requestId, "APPROVE", { password: "wrong-password", reason: STEP_UP.reason })).status).toBe(403);
    expect(await roleOf(t.id)).toBe("learner");
  });
  it("one pending request per target: a second promotion gets 409 REQUEST_PENDING", async () => {
    const { t } = await twoAdminsAndRequest();
    const r = await promote(t.id);
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("REQUEST_PENDING");
    expect(await count("SELECT COUNT(*) AS n FROM admin_requests")).toBe(1);
  });
  it("an expired request cannot be approved (409 REQUEST_CLOSED); a new request can then be made", async () => {
    const { a2, t, res } = await twoAdminsAndRequest();
    const { requestId } = await res.json();
    await db().prepare("UPDATE admin_requests SET expires_at=? WHERE id=?").bind(Date.now() - 1, requestId).run();
    await actAs(a2.id);
    const r = await decide(requestId, "APPROVE");
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("REQUEST_CLOSED");
    expect(await roleOf(t.id)).toBe("learner");
    expect((await db().prepare("SELECT status FROM admin_requests WHERE id=?").bind(requestId).first<{ status: string }>())?.status).toBe("EXPIRED");
    expect((await promote(t.id)).status).toBe(202);
  });
  it("requests last 24 hours", () => {
    expect(REQUEST_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
  it("an unknown request id: 404", async () => {
    await signIn("admin");
    expect((await decide("nope", "APPROVE")).status).toBe(404);
  });
  it("bad input: 400", async () => {
    await signIn("admin");
    expect((await decide("x", "PUBLISH")).status).toBe(400);
    expect((await reqPost(call("POST", "/api/admin/admin-requests", "{bad"))).status).toBe(400);
  });
});

describe("/api/admin/admin-requests access", () => {
  it("no session: 403 on GET and POST", async () => {
    expect((await reqGet(call("GET", "/api/admin/admin-requests"))).status).toBe(403);
    expect((await decide("x", "APPROVE")).status).toBe(403);
  });
  it.each(["learner", "reviewer", "scholar"] as const)("%s: 403 on GET and POST", async (role) => {
    await signIn(role);
    expect((await reqGet(call("GET", "/api/admin/admin-requests"))).status).toBe(403);
    expect((await decide("x", "APPROVE")).status).toBe(403);
  });
  it("cross-origin POST: 403 BAD_ORIGIN", async () => {
    await signIn("admin");
    const r = await decide("x", "APPROVE", STEP_UP, EVIL);
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("BAD_ORIGIN");
  });
});

describe("decideRequest: two admins approve at the same moment", () => {
  it("exactly one wins; the other gets 409 REQUEST_CLOSED; one role change and one audit row", async () => {
    const { t, res } = await twoAdminsAndRequest();
    const { requestId } = await res.json();
    const a3 = await seedUser("admin");
    const a4 = await seedUser("admin");
    const D = env.DB as unknown as D1Database;
    const req = call("POST", "/api/admin/admin-requests");
    const out = await Promise.all([
      decideRequest(D, req, { userId: a3.id, role: "admin" }, requestId, "APPROVE", STEP_UP.reason),
      decideRequest(D, req, { userId: a4.id, role: "admin" }, requestId, "APPROVE", STEP_UP.reason),
    ]);
    expect(out.filter((r) => r.ok)).toHaveLength(1);
    expect(out.filter((r) => !r.ok)).toEqual([{ ok: false, error: "REQUEST_CLOSED", status: 409 }]);
    expect(await roleOf(t.id)).toBe("admin");
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='ROLE_CHANGED'")).toBe(1);
    expect((await db().prepare("SELECT status FROM admin_requests WHERE id=?").bind(requestId).first<{ status: string }>())?.status).toBe("APPROVED");
  });
  it("approve and reject at the same moment: exactly one wins", async () => {
    const { res } = await twoAdminsAndRequest();
    const { requestId } = await res.json();
    const a3 = await seedUser("admin");
    const a4 = await seedUser("admin");
    const D = env.DB as unknown as D1Database;
    const req = call("POST", "/api/admin/admin-requests");
    const out = await Promise.all([
      decideRequest(D, req, { userId: a3.id, role: "admin" }, requestId, "APPROVE", STEP_UP.reason),
      decideRequest(D, req, { userId: a4.id, role: "admin" }, requestId, "REJECT", STEP_UP.reason),
    ]);
    expect(out.filter((r) => r.ok)).toHaveLength(1);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action IN ('ROLE_CHANGED','ADMIN_PROMOTION_REJECTED')")).toBe(1);
  });
});

describe("requestPromotion and requester checks", () => {
  it("two admins ask at the same moment for the same target: exactly one request opens", async () => {
    const a1 = await signIn("admin");
    const a2 = await seedUser("admin");
    const t = await seedUser("learner");
    const D = env.DB as unknown as D1Database;
    const req = call("PUT", "/api/admin/users");
    const out = await Promise.all([
      requestPromotion(D, req, { userId: a1.id, role: "admin" }, t.id, STEP_UP.reason),
      requestPromotion(D, req, { userId: a2.id, role: "admin" }, t.id, STEP_UP.reason),
    ]);
    expect(out.filter((r) => r.ok)).toHaveLength(1);
    expect(out.filter((r) => !r.ok)).toEqual([{ ok: false, error: "REQUEST_PENDING", status: 409 }]);
    expect(await count("SELECT COUNT(*) AS n FROM admin_requests WHERE status='PENDING'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='ADMIN_PROMOTION_REQUESTED'")).toBe(1);
  });
  it("a request whose requester is no longer an admin cannot be approved (409 REQUEST_CLOSED)", async () => {
    const { a1, a2, t, res } = await twoAdminsAndRequest();
    const { requestId } = await res.json();
    await db().prepare("UPDATE users SET role='learner' WHERE id=?").bind(a1.id).run();
    await actAs(a2.id);
    const r = await decide(requestId, "APPROVE");
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("REQUEST_CLOSED");
    expect(await roleOf(t.id)).toBe("learner");
  });
});
