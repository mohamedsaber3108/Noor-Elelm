import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { GET, POST } from "@/app/api/auth/[action]/route";
import { PASSWORD, authCtx, call, count, db, seedUser, signIn, EVIL } from "../helpers";

const reg = { email: "New.User@Example.test", password: "a-long-password-1", name: "New User" };

describe("POST /api/auth/register", () => {
  it("creates the user, lowercases the email, and sets an httpOnly session cookie", async () => {
    const res = await POST(call("POST", "/api/auth/register", reg), authCtx("register"));
    expect(res.status).toBe(201);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("nai_session=");
    expect(cookie.toLowerCase()).toContain("httponly");
    const row = await db().prepare("SELECT role FROM users WHERE email='new.user@example.test'").first<{ role: string }>();
    expect(row?.role).toBe("learner");
  });
  it("rejects bad input with 400 (short password, bad email, short name)", async () => {
    for (const bad of [{ ...reg, password: "short" }, { ...reg, email: "nope" }, { ...reg, name: "x" }, {}]) {
      const res = await POST(call("POST", "/api/auth/register", bad), authCtx("register"));
      expect(res.status).toBe(400);
    }
  });
  it("rejects broken JSON with 400", async () => {
    const res = await POST(call("POST", "/api/auth/register", "{not json"), authCtx("register"));
    expect(res.status).toBe(400);
  });
  it("returns 409 EMAIL_TAKEN for a second registration with the same email", async () => {
    await POST(call("POST", "/api/auth/register", reg), authCtx("register"));
    const res = await POST(call("POST", "/api/auth/register", reg), authCtx("register"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("EMAIL_TAKEN");
  });
  it("returns 403 BAD_ORIGIN for a cross-origin POST", async () => {
    const res = await POST(call("POST", "/api/auth/register", reg, EVIL), authCtx("register"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("BAD_ORIGIN");
    expect(await count("SELECT COUNT(*) AS n FROM users")).toBe(0);
  });
  it("accepts a same-origin browser POST", async () => {
    const res = await POST(call("POST", "/api/auth/register", reg, { origin: "http://localhost:3000" }), authCtx("register"));
    expect(res.status).toBe(201);
  });
  it("returns 429 after 5 registrations from one address in an hour", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await POST(call("POST", "/api/auth/register", { ...reg, email: `u${i}@example.test` }), authCtx("register"));
      codes.push(res.status);
    }
    expect(codes).toEqual([201, 201, 201, 201, 201, 429]);
  });
  it("returns 503 when the database is not bound", async () => {
    env.DB = undefined;
    expect((await POST(call("POST", "/api/auth/register", reg), authCtx("register"))).status).toBe(503);
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with the right password and sets a session cookie", async () => {
    const u = await seedUser("learner", "a@example.test");
    const res = await POST(call("POST", "/api/auth/login", { email: u.email, password: PASSWORD }), authCtx("login"));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("nai_session=");
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id=?", u.id)).toBe(1);
  });
  it("returns 401 INVALID_CREDENTIALS for a wrong password and for an unknown email alike", async () => {
    const u = await seedUser("learner", "a@example.test");
    const wrong = await POST(call("POST", "/api/auth/login", { email: u.email, password: "wrong-password" }), authCtx("login"));
    const unknown = await POST(call("POST", "/api/auth/login", { email: "x@example.test", password: PASSWORD }), authCtx("login"));
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });
  it("returns 400 for bad input", async () => {
    expect((await POST(call("POST", "/api/auth/login", { email: "bad", password: "x" }), authCtx("login"))).status).toBe(400);
    expect((await POST(call("POST", "/api/auth/login", "nope"), authCtx("login"))).status).toBe(400);
  });
  it("returns 403 BAD_ORIGIN for a cross-origin POST", async () => {
    const u = await seedUser("learner", "a@example.test");
    const res = await POST(call("POST", "/api/auth/login", { email: u.email, password: PASSWORD }, EVIL), authCtx("login"));
    expect(res.status).toBe(403);
  });
  it("returns 429 after 8 attempts for one email from one address", async () => {
    const u = await seedUser("learner", "a@example.test");
    let last = 0;
    for (let i = 0; i < 9; i++) last = (await POST(call("POST", "/api/auth/login", { email: u.email, password: "wrong-password" }), authCtx("login"))).status;
    expect(last).toBe(429);
  });
});

describe("POST /api/auth/logout and other actions", () => {
  it("logout deletes the session row and clears the cookie", async () => {
    const u = await seedUser("learner", "a@example.test");
    const login = await POST(call("POST", "/api/auth/login", { email: u.email, password: PASSWORD }), authCtx("login"));
    const token = /nai_session=([^;]+)/.exec(login.headers.get("set-cookie")!)![1];
    const res = await POST(call("POST", "/api/auth/logout", {}, { headers: { cookie: `nai_session=${token}` } }), authCtx("logout"));
    expect(res.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM sessions")).toBe(0);
  });
  it("logout is refused cross-origin", async () => {
    expect((await POST(call("POST", "/api/auth/logout", {}, EVIL), authCtx("logout"))).status).toBe(403);
  });
  it("unknown POST action returns 404", async () => {
    expect((await POST(call("POST", "/api/auth/nope", {}), authCtx("nope"))).status).toBe(404);
  });
});

describe("GET /api/auth/session", () => {
  it("returns user null without a session", async () => {
    const res = await GET(call("GET", "/api/auth/session"), authCtx("session"));
    expect(await res.json()).toEqual({ user: null });
  });
  it("shows reviewer false for a learner and true for a reviewer", async () => {
    await signIn("learner");
    expect((await (await GET(call("GET", "/api/auth/session"), authCtx("session"))).json()).user.reviewer).toBe(false);
    await signIn("reviewer");
    expect((await (await GET(call("GET", "/api/auth/session"), authCtx("session"))).json()).user.reviewer).toBe(true);
  });
  it("unknown GET action returns 404", async () => {
    expect((await GET(call("GET", "/api/auth/other"), authCtx("other"))).status).toBe(404);
  });
});
