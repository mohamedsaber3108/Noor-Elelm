import { describe, expect, it } from "vitest";
import { GET as usersGet, PUT as usersPut } from "@/app/api/admin/users/route";
import { GET as meGet } from "@/app/api/me/route";
import { POST as authPost } from "@/app/api/auth/[action]/route";
import { DELETE as accountDelete } from "@/app/api/account/route";
import { SESSION_COOKIE, createSession } from "@/app/auth";
import { NOTE_MAX } from "@/lib/user-admin";
import { setCookie } from "../mocks/next-headers";
import { EVIL, PASSWORD, STEP_UP, authCtx, call, count, db, seedUser, signIn } from "../helpers";

const put = (body: unknown, o = {}) => usersPut(call("PUT", "/api/admin/users", body, o));
const suspend = (id: string, on = true, extra: object = STEP_UP) => put({ id, suspend: on, ...extra });
const login = (email: string, password: string) => authPost(call("POST", "/api/auth/login", { email, password }) as never, authCtx("login") as never);
const suspendedAt = async (id: string) => (await db().prepare("SELECT suspended_at FROM users WHERE id=?").bind(id).first<{ suspended_at: number | null }>())?.suspended_at ?? null;
const useSession = async (userId: string) => setCookie(SESSION_COOKIE, await createSession(userId, "vitest", { mfaVerified: true }));

describe("suspend and reactivate (N-18a)", () => {
  it("needs step-up: no password 400, wrong password 403, nothing changes", async () => {
    await signIn("admin");
    const t = await seedUser("learner");
    expect((await suspend(t.id, true, { reason: STEP_UP.reason })).status).toBe(400);
    expect((await suspend(t.id, true, { password: "wrong-password", reason: STEP_UP.reason })).status).toBe(403);
    expect(await suspendedAt(t.id)).toBeNull();
  });
  it("an admin cannot suspend themselves (403 SELF_SUSPEND_REFUSED)", async () => {
    const a = await signIn("admin");
    const r = await suspend(a.id);
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("SELF_SUSPEND_REFUSED");
  });
  it("suspending sets suspended_at, ends every session and writes USER_SUSPENDED with the reason", async () => {
    const a = await signIn("admin");
    const t = await seedUser("learner");
    await db().prepare("INSERT INTO sessions(id,user_id,expires_at) VALUES('s-t',?,?)").bind(t.id, Date.now() + 100000).run();
    expect((await suspend(t.id)).status).toBe(200);
    expect(await suspendedAt(t.id)).not.toBeNull();
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id=?", t.id)).toBe(0);
    const row = await db().prepare("SELECT actor_id,reason FROM audit_events WHERE action='USER_SUSPENDED' AND target_id=?").bind(t.id).first<{ actor_id: string; reason: string }>();
    expect(row).toEqual({ actor_id: a.id, reason: STEP_UP.reason });
  });
  it("a suspended account cannot use a session and cannot sign in; wrong password still gets 401", async () => {
    await signIn("admin");
    const t = await seedUser("learner");
    expect((await suspend(t.id)).status).toBe(200);
    await useSession(t.id);
    expect((await meGet()).status).toBe(401);
    const ok = await login(t.email, PASSWORD);
    expect(ok.status).toBe(403);
    expect((await ok.json()).error).toBe("ACCOUNT_SUSPENDED");
    const bad = await login(t.email, "wrong-password");
    expect(bad.status).toBe(401);
    expect((await bad.json()).error).toBe("INVALID_CREDENTIALS");
  });
  it("reactivating lets the account sign in again and writes USER_REACTIVATED", async () => {
    await signIn("admin");
    const t = await seedUser("learner");
    expect((await suspend(t.id)).status).toBe(200);
    expect((await suspend(t.id, false)).status).toBe(200);
    expect(await suspendedAt(t.id)).toBeNull();
    expect((await login(t.email, PASSWORD)).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='USER_REACTIVATED' AND target_id=?", t.id)).toBe(1);
  });
  it("double suspend 409 ALREADY_SUSPENDED; reactivate when active 409 NOT_SUSPENDED; unknown id 404", async () => {
    await signIn("admin");
    const t = await seedUser("learner");
    expect((await suspend(t.id, false)).status).toBe(409);
    expect((await suspend(t.id)).status).toBe(200);
    const again = await suspend(t.id);
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("ALREADY_SUSPENDED");
    expect((await suspend("nope")).status).toBe(404);
  });
  it("a suspended admin does not count: the last active admin cannot be demoted", async () => {
    const a1 = await signIn("admin");
    const a2 = await seedUser("admin");
    expect((await suspend(a2.id)).status).toBe(200);
    const r = await put({ id: a1.id, role: "learner", ...STEP_UP });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("LAST_ADMIN");
  });
  it("a suspended admin does not count: with one active admin a promotion is a bootstrap, not a request", async () => {
    await signIn("admin");
    const a2 = await seedUser("admin");
    expect((await suspend(a2.id)).status).toBe(200);
    const t = await seedUser("learner");
    expect((await put({ id: t.id, role: "admin", ...STEP_UP })).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM admin_requests")).toBe(0);
  });
  it("a suspended admin does not count: the last active admin cannot delete their own account", async () => {
    const a1 = await signIn("admin");
    const a2 = await seedUser("admin");
    expect((await suspend(a2.id)).status).toBe(200);
    const r = await accountDelete(call("DELETE", "/api/account", { password: PASSWORD }) as never);
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("LAST_ADMIN");
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE id=?", a1.id)).toBe(1);
  });
  it("a suspended admin can be demoted even when only one admin is active", async () => {
    await signIn("admin");
    const a2 = await seedUser("admin");
    expect((await suspend(a2.id)).status).toBe(200);
    expect((await put({ id: a2.id, role: "learner", ...STEP_UP })).status).toBe(200);
  });
  it("non-admins get 403; cross-origin gets 403 BAD_ORIGIN", async () => {
    const t = await seedUser("learner");
    await signIn("reviewer");
    expect((await suspend(t.id)).status).toBe(403);
    await signIn("admin");
    const r = await put({ id: t.id, suspend: true, ...STEP_UP }, EVIL);
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("BAD_ORIGIN");
    expect(await suspendedAt(t.id)).toBeNull();
  });
});

describe("staff note (N-18a)", () => {
  it("sets the note, shows it in the admin list, and the audit row keeps only the length", async () => {
    await signIn("admin");
    const t = await seedUser("learner", "note-target@example.test");
    const text = "Asked for a refund by mail; called back on Monday.";
    expect((await put({ id: t.id, note: `  ${text}  ` })).status).toBe(200);
    const list = await (await usersGet(call("GET", "/api/admin/users?q=note-target") as never)).json();
    expect(list.users[0].staffNote).toBe(text);
    const a = await db().prepare("SELECT detail_json FROM audit_events WHERE action='STAFF_NOTE_SET'").first<{ detail_json: string }>();
    expect(JSON.parse(a!.detail_json)).toEqual({ length: text.length });
    expect(a!.detail_json).not.toContain("refund");
  });
  it("an empty note clears it to null", async () => {
    await signIn("admin");
    const t = await seedUser("learner");
    await put({ id: t.id, note: "something to clear" });
    expect((await put({ id: t.id, note: "   " })).status).toBe(200);
    expect((await db().prepare("SELECT staff_note FROM users WHERE id=?").bind(t.id).first<{ staff_note: string | null }>())?.staff_note).toBeNull();
  });
  it("refuses a too long note, tags, control characters and bidi marks with 400 INVALID_NOTE", async () => {
    await signIn("admin");
    const t = await seedUser("learner");
    for (const note of ["x".repeat(NOTE_MAX + 1), "<b>x</b>", "a\u0000b", "a\u202Eb", "a\u061Cb"]) {
      const r = await put({ id: t.id, note });
      expect(r.status).toBe(400);
    }
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='STAFF_NOTE_SET'")).toBe(0);
  });
  it("a learner cannot set a note (403); an unknown id gets 404", async () => {
    await signIn("admin");
    expect((await put({ id: "nope", note: "hello there" })).status).toBe(404);
    const t = await seedUser("learner");
    await signIn("learner");
    expect((await put({ id: t.id, note: "hello there" })).status).toBe(403);
  });
});
