import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { DELETE, GET, PATCH, POST } from "@/app/api/account/route";
import { PASSWORD, call, count, db, signIn, EVIL } from "../helpers";

describe("GET /api/account", () => {
  it("returns 401 without a session", async () => {
    expect((await GET()).status).toBe(401);
  });
  it("returns the profile and active session count", async () => {
    const u = await signIn("learner");
    const j = await (await GET()).json();
    expect(j).toMatchObject({ email: u.email, role: "learner", activeSessions: 1 });
  });
  it("returns 503 when the database is not bound", async () => {
    await signIn("learner");
    env.DB = undefined;
    // getCurrentUser returns null without a DB, so the route answers 401 before it can answer 503.
    expect((await GET()).status).toBe(401);
  });
});

describe("PATCH /api/account (rename)", () => {
  it("renames the user", async () => {
    const u = await signIn("learner");
    const res = await PATCH(call("PATCH", "/api/account", { name: "  Nour  " }));
    expect(res.status).toBe(200);
    expect((await db().prepare("SELECT display_name AS n FROM users WHERE id=?").bind(u.id).first<{ n: string }>())?.n).toBe("Nour");
  });
  it("returns 401 without a session", async () => {
    expect((await PATCH(call("PATCH", "/api/account", { name: "Nour" }))).status).toBe(401);
  });
  it("returns 400 for a too short name or broken JSON", async () => {
    await signIn("learner");
    expect((await PATCH(call("PATCH", "/api/account", { name: "x" }))).status).toBe(400);
    expect((await PATCH(call("PATCH", "/api/account", "{bad"))).status).toBe(400);
  });
  it("returns 403 BAD_ORIGIN cross-origin and leaves the name unchanged", async () => {
    const u = await signIn("learner");
    const res = await PATCH(call("PATCH", "/api/account", { name: "Hacked" }, EVIL));
    expect(res.status).toBe(403);
    expect((await db().prepare("SELECT display_name AS n FROM users WHERE id=?").bind(u.id).first<{ n: string }>())?.n).toBe("User learner");
  });
});

describe("POST /api/account (change password)", () => {
  const body = { current: PASSWORD, next: "a-brand-new-password" };
  it("changes the password, revokes old sessions, starts a new one, and writes an audit row", async () => {
    const u = await signIn("learner");
    const res = await POST(call("POST", "/api/account", body));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("nai_session=");
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id=?", u.id)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='PASSWORD_CHANGED' AND actor_id=?", u.id)).toBe(1);
  });
  it("returns 401 INVALID_CREDENTIALS for a wrong current password", async () => {
    await signIn("learner");
    const res = await POST(call("POST", "/api/account", { ...body, current: "not-the-password" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("INVALID_CREDENTIALS");
  });
  it("returns 400 for a new password shorter than 10", async () => {
    await signIn("learner");
    expect((await POST(call("POST", "/api/account", { ...body, next: "short" }))).status).toBe(400);
  });
  it("returns 401 without a session", async () => {
    expect((await POST(call("POST", "/api/account", body))).status).toBe(401);
  });
  it("returns 403 BAD_ORIGIN cross-origin", async () => {
    await signIn("learner");
    expect((await POST(call("POST", "/api/account", body, EVIL))).status).toBe(403);
  });
  it("returns 429 after 6 attempts in 15 minutes", async () => {
    await signIn("learner");
    let last = 0;
    for (let i = 0; i < 7; i++) last = (await POST(call("POST", "/api/account", { ...body, current: "wrong-password" }))).status;
    expect(last).toBe(429);
  });
});

describe("DELETE /api/account", () => {
  it("deletes the user and personal data, audits it, and clears the cookie", async () => {
    const u = await signIn("learner");
    await db().prepare("INSERT INTO bookmarks(user_id,content_id) VALUES(?,'x')").bind(u.id).run();
    const res = await DELETE(call("DELETE", "/api/account", { password: PASSWORD }));
    expect(res.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE id=?", u.id)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM bookmarks WHERE user_id=?", u.id)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id=?", u.id)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='ACCOUNT_DELETED' AND target_id=?", u.id)).toBe(1);
  });
  it("returns 401 without a session", async () => {
    expect((await DELETE(call("DELETE", "/api/account", { password: PASSWORD }))).status).toBe(401);
  });
  it("returns 401 INVALID_CREDENTIALS for a wrong password and keeps the user", async () => {
    const u = await signIn("learner");
    expect((await DELETE(call("DELETE", "/api/account", { password: "wrong-password" }))).status).toBe(401);
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE id=?", u.id)).toBe(1);
  });
  it("returns 400 for a missing password", async () => {
    await signIn("learner");
    expect((await DELETE(call("DELETE", "/api/account", {}))).status).toBe(400);
  });
  it("returns 403 BAD_ORIGIN cross-origin and keeps the user", async () => {
    const u = await signIn("learner");
    expect((await DELETE(call("DELETE", "/api/account", { password: PASSWORD }, EVIL))).status).toBe(403);
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE id=?", u.id)).toBe(1);
  });
  it("refuses to delete the only admin with 409 LAST_ADMIN", async () => {
    const u = await signIn("admin");
    const res = await DELETE(call("DELETE", "/api/account", { password: PASSWORD }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("LAST_ADMIN");
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE id=?", u.id)).toBe(1);
  });
});
