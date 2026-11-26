import { beforeEach, describe, expect, it } from "vitest";
import { POST as resetRequest } from "@/app/api/auth/password-reset/request/route";
import { POST as resetConfirm } from "@/app/api/auth/password-reset/confirm/route";
import { POST as verifyRequest } from "@/app/api/auth/verify-email/request/route";
import { POST as verifyConfirm } from "@/app/api/auth/verify-email/confirm/route";
import { POST as authPost } from "@/app/api/auth/[action]/route";
import { SESSION_COOKIE, createSession, verifyPassword } from "@/app/auth";
import { createToken } from "@/lib/auth-tokens";
import { sendMail, setTestOutbox, type Mail } from "@/lib/mail";
import { PASSWORD, authCtx, call, count, db, seedUser, setEnv, signIn, EVIL } from "../helpers";
import { clearCookies, setCookie } from "../mocks/next-headers";

const NEW_PASSWORD = "brand-new-password-9";
let box: Mail[];

beforeEach(() => {
  box = [];
  setTestOutbox(box);
  setEnv("MAIL_PROVIDER", "outbox");
  setEnv("MAIL_LINK_BASE", "https://noor.test");
  setEnv("MAIL_FROM", "Noor al-Ilm");
});

const tokenOf = (m: Mail) => /#t=([A-Za-z0-9_-]+)/.exec(m.text)![1];
const ipHeader = (ip: string) => ({ headers: { "cf-connecting-ip": ip } });
const askReset = (email: string, ip = "10.0.0.1", opts: object = {}) =>
  resetRequest(call("POST", "/api/auth/password-reset/request", { email }, { ...ipHeader(ip), ...opts }));
const doReset = (token: string, password = NEW_PASSWORD, ip = "10.0.0.2") =>
  resetConfirm(call("POST", "/api/auth/password-reset/confirm", { token, password }, ipHeader(ip)));
const doVerify = (token: string, ip = "10.0.0.3") =>
  verifyConfirm(call("POST", "/api/auth/verify-email/confirm", { token }, ipHeader(ip)));
const passwordOf = async (id: string) => (await db().prepare("SELECT password_hash FROM users WHERE id=?").bind(id).first<{ password_hash: string }>())!.password_hash;

describe("password reset request", () => {
  it("mails a bilingual link with the token in the fragment, and stores only a hash", async () => {
    const u = await seedUser("learner");
    const res = await askReset(u.email);
    expect(res.status).toBe(200);
    expect(box).toHaveLength(1);
    expect(box[0].to).toBe(u.email);
    const token = tokenOf(box[0]);
    expect(token).toHaveLength(43);
    expect(box[0].text).toContain(`https://noor.test/reset#t=${token}`);
    expect(box[0].text).toMatch(/[\u0600-\u06FF]/);
    expect(box[0].text).toContain("30 minutes");
    const row = await db().prepare("SELECT token_hash,kind,expires_at FROM auth_tokens WHERE user_id=?").bind(u.id).first<{ token_hash: string; kind: string; expires_at: number }>();
    expect(row!.kind).toBe("reset");
    expect(row!.token_hash).toHaveLength(64);
    expect(row!.token_hash).not.toContain(token);
    expect(Math.abs(row!.expires_at - Date.now() - 30 * 60 * 1000)).toBeLessThan(5000);
  });

  it("answers the same for a known and an unknown address", async () => {
    const u = await seedUser("learner");
    const known = await askReset(u.email, "10.0.1.1");
    const unknown = await askReset("nobody@example.test", "10.0.1.2");
    expect(unknown.status).toBe(known.status);
    expect(await unknown.text()).toBe(await known.text());
    expect(unknown.headers.get("set-cookie")).toBeNull();
    expect(box).toHaveLength(1);
    expect(await count("SELECT COUNT(*) AS n FROM auth_tokens")).toBe(1);
  });

  it("sends nothing and answers the same when MAIL_PROVIDER is unset", async () => {
    const u = await seedUser("learner");
    const withMail = await askReset(u.email, "10.0.2.1");
    const body = await withMail.text();
    setEnv("MAIL_PROVIDER", undefined);
    const res = await askReset(u.email, "10.0.2.2");
    expect(res.status).toBe(withMail.status);
    expect(await res.text()).toBe(body);
    expect(box).toHaveLength(1);
    setEnv("MAIL_PROVIDER", "none");
    expect((await askReset(u.email, "10.0.2.3")).status).toBe(200);
    expect(box).toHaveLength(1);
  });

  it("a new token retires the older one", async () => {
    const u = await seedUser("learner");
    await askReset(u.email, "10.0.3.1");
    await askReset(u.email, "10.0.3.2");
    expect(box).toHaveLength(2);
    expect((await doReset(tokenOf(box[0]))).status).toBe(400);
    expect((await doReset(tokenOf(box[1]))).status).toBe(200);
  });

  it("limits to 5 per address and 5 per IP in an hour, with the same answer for unknown addresses", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await askReset("ghost@example.test", `10.0.4.${i}`)).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
    const ipCodes: number[] = [];
    for (let i = 0; i < 6; i++) ipCodes.push((await askReset(`ghost${i}@example.test`, "10.0.5.1")).status);
    expect(ipCodes).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it("refuses a cross-origin request and bad input", async () => {
    const u = await seedUser("learner");
    const res = await askReset(u.email, "10.0.6.1", EVIL);
    expect(res.status).toBe(403);
    expect(box).toHaveLength(0);
    const bad = await resetRequest(call("POST", "/api/auth/password-reset/request", { email: "nope" }));
    expect(bad.status).toBe(400);
  });

  it("makes no mail and no token when the link base is missing", async () => {
    const u = await seedUser("learner");
    setEnv("MAIL_LINK_BASE", undefined);
    expect((await askReset(u.email)).status).toBe(200);
    expect(box).toHaveLength(0);
    expect(await count("SELECT COUNT(*) AS n FROM auth_tokens")).toBe(0);
  });
});

describe("password reset confirm", () => {
  it("sets the password, ends all sessions, signs nobody in, and writes an audit row without the token", async () => {
    const u = await seedUser("learner");
    await createSession(u.id, "a");
    await createSession(u.id, "b");
    await askReset(u.email);
    const token = tokenOf(box[0]);
    const res = await doReset(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    const text = await res.text();
    expect(text).not.toContain(token);
    expect(await verifyPassword(NEW_PASSWORD, await passwordOf(u.id))).toBe(true);
    expect(await verifyPassword(PASSWORD, await passwordOf(u.id))).toBe(false);
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id=?", u.id)).toBe(0);
    const audit = await db().prepare("SELECT * FROM audit_events WHERE action='PASSWORD_RESET'").all<Record<string, string>>();
    expect(audit.results).toHaveLength(1);
    expect(audit.results[0].target_id).toBe(u.id);
    expect(JSON.stringify(audit.results[0])).not.toContain(token);
    const stored = await db().prepare("SELECT * FROM auth_tokens").all();
    expect(JSON.stringify(stored.results)).not.toContain(token);
  });

  it("works once only", async () => {
    const u = await seedUser("learner");
    await askReset(u.email);
    const token = tokenOf(box[0]);
    expect((await doReset(token)).status).toBe(200);
    const again = await doReset(token, "another-password-77");
    expect(again.status).toBe(400);
    expect((await again.json()).error).toBe("INVALID_OR_EXPIRED_TOKEN");
    expect(await verifyPassword(NEW_PASSWORD, await passwordOf(u.id))).toBe(true);
  });

  it("two parallel uses of one token: only one wins", async () => {
    const u = await seedUser("learner");
    await askReset(u.email);
    const token = tokenOf(box[0]);
    const codes = (await Promise.all([doReset(token, NEW_PASSWORD, "10.1.0.1"), doReset(token, "second-password-88", "10.1.0.2")])).map((r) => r.status).sort();
    expect(codes).toEqual([200, 400]);
  });

  it("refuses an expired token and leaves the password alone", async () => {
    const u = await seedUser("learner");
    await askReset(u.email);
    const before = await passwordOf(u.id);
    await db().prepare("UPDATE auth_tokens SET expires_at=?").bind(Date.now() - 1).run();
    expect((await doReset(tokenOf(box[0]))).status).toBe(400);
    expect(await passwordOf(u.id)).toBe(before);
  });

  it("refuses unknown tokens, short passwords and cross-origin calls", async () => {
    const u = await seedUser("learner");
    await askReset(u.email);
    const token = tokenOf(box[0]);
    expect((await doReset("x".repeat(43))).status).toBe(400);
    expect((await doReset(token, "short")).status).toBe(400);
    const evil = await resetConfirm(call("POST", "/api/auth/password-reset/confirm", { token, password: NEW_PASSWORD }, EVIL));
    expect(evil.status).toBe(403);
    expect((await doReset(token)).status).toBe(200); // the refused calls did not use the token
  });

  it("limits attempts to 5 per IP in an hour", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await doReset("y".repeat(43), NEW_PASSWORD, "10.1.1.1")).status);
    expect(codes).toEqual([400, 400, 400, 400, 400, 429]);
  });

  it("keeps MFA rows, and staff still need MFA at the next sign-in", async () => {
    const admin = await seedUser("admin");
    await db().prepare("INSERT INTO user_mfa(user_id,secret_enc,enabled_at) VALUES(?,?,?)").bind(admin.id, "enc", 1).run();
    await askReset(admin.email);
    expect((await doReset(tokenOf(box[0]))).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM user_mfa WHERE user_id=?", admin.id)).toBe(1);
    const login = await authPost(call("POST", "/api/auth/login", { email: admin.email, password: NEW_PASSWORD }, ipHeader("10.1.2.1")), authCtx("login"));
    expect(login.status).toBe(200);
    expect((await login.json()).mfa).toBe("required");
    const cookie = /nai_session=([^;]+)/.exec(login.headers.get("set-cookie") ?? "")![1];
    setCookie(SESSION_COOKIE, cookie);
    const me = await (await import("@/app/auth")).getCurrentUser();
    expect(me).toBeNull(); // unverified staff session counts as signed out
  });
});

describe("email verification", () => {
  it("mails a 24 hour token, and confirm sets the flag once with an audit row", async () => {
    const u = await signIn("learner");
    const res = await verifyRequest(call("POST", "/api/auth/verify-email/request", {}, ipHeader("10.2.0.1")));
    expect(res.status).toBe(200);
    expect(box).toHaveLength(1);
    expect(box[0].text).toContain("https://noor.test/verify-email#t=");
    expect(box[0].text).toContain("24 hours");
    const token = tokenOf(box[0]);
    clearCookies();
    const ok = await doVerify(token);
    expect(ok.status).toBe(200);
    expect(await ok.text()).not.toContain(token);
    const row = await db().prepare("SELECT email_verified_at FROM users WHERE id=?").bind(u.id).first<{ email_verified_at: number }>();
    expect(row!.email_verified_at).toBeGreaterThan(0);
    const audit = await db().prepare("SELECT * FROM audit_events WHERE action='EMAIL_VERIFIED'").all<Record<string, string>>();
    expect(audit.results).toHaveLength(1);
    expect(JSON.stringify(audit.results[0])).not.toContain(token);
    expect((await doVerify(token)).status).toBe(400);
  });

  it("refuses an expired verify token, and a reset token cannot verify", async () => {
    const u = await seedUser("learner");
    const v = await createToken(u.id, "verify");
    const r = await createToken(u.id, "reset");
    expect((await doVerify(r.token)).status).toBe(400);
    await db().prepare("UPDATE auth_tokens SET expires_at=? WHERE kind='verify'").bind(Date.now() - 1).run();
    expect((await doVerify(v.token)).status).toBe(400);
    expect((await resetConfirm(call("POST", "/api/auth/password-reset/confirm", { token: v.token, password: NEW_PASSWORD }))).status).toBe(400);
    const row = await db().prepare("SELECT email_verified_at FROM users WHERE id=?").bind(u.id).first<{ email_verified_at: number | null }>();
    expect(row!.email_verified_at).toBeNull();
  });

  it("a newer verify token retires the older one", async () => {
    const u = await seedUser("learner");
    const a = await createToken(u.id, "verify");
    const b = await createToken(u.id, "verify");
    expect((await doVerify(a.token)).status).toBe(400);
    expect((await doVerify(b.token)).status).toBe(200);
  });

  it("request needs a sign-in, is same-origin only, is limited to 5 an hour, and skips verified users", async () => {
    expect((await verifyRequest(call("POST", "/api/auth/verify-email/request", {}))).status).toBe(401);
    const u = await signIn("learner");
    expect((await verifyRequest(call("POST", "/api/auth/verify-email/request", {}, EVIL))).status).toBe(403);
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await verifyRequest(call("POST", "/api/auth/verify-email/request", {}, ipHeader(`10.2.1.${i}`)))).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
    box.length = 0;
    await db().prepare("UPDATE users SET email_verified_at=1 WHERE id=?").bind(u.id).run();
    await db().prepare("DELETE FROM rate_limits").run();
    expect((await verifyRequest(call("POST", "/api/auth/verify-email/request", {}))).status).toBe(200);
    expect(box).toHaveLength(0);
  });

  it("confirm is same-origin only and rate limited", async () => {
    expect((await verifyConfirm(call("POST", "/api/auth/verify-email/confirm", { token: "t" }, EVIL))).status).toBe(403);
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await doVerify("z".repeat(43), "10.2.2.1")).status);
    expect(codes).toEqual([400, 400, 400, 400, 400, 429]);
  });

  it("registration (open) mails a verification link and still signs the user in without it", async () => {
    setEnv("REGISTRATION_MODE", "open");
    const res = await authPost(call("POST", "/api/auth/register", { email: "fresh@example.test", password: "a-long-password-1", name: "Fresh One" }), authCtx("register"));
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toContain("nai_session=");
    expect(box).toHaveLength(1);
    expect(box[0].to).toBe("fresh@example.test");
    expect(box[0].text).toContain("/verify-email#t=");
    const session = await (await import("@/app/api/auth/[action]/route")).GET(call("GET", "/api/auth/session"), authCtx("session"));
    expect(session.status).toBe(200);
  });

  it("registration still works when the mail provider is not implemented", async () => {
    setEnv("REGISTRATION_MODE", "open");
    setEnv("MAIL_PROVIDER", "somevendor");
    const res = await authPost(call("POST", "/api/auth/register", { email: "fresh2@example.test", password: "a-long-password-1", name: "Fresh Two" }), authCtx("register"));
    expect(res.status).toBe(201);
  });
});

describe("mail sender", () => {
  it("sends nothing when unset or none", async () => {
    setEnv("MAIL_PROVIDER", undefined);
    expect(await sendMail({ to: "a@b.test", subject: "s", text: "t" })).toEqual({ ok: true, sent: false });
    setEnv("MAIL_PROVIDER", "none");
    expect(await sendMail({ to: "a@b.test", subject: "s", text: "t" })).toEqual({ ok: true, sent: false });
    expect(box).toHaveLength(0);
  });

  it("outbox mode works only when a test registered a sink", async () => {
    setTestOutbox(null);
    expect(await sendMail({ to: "a@b.test", subject: "s", text: "t" })).toEqual({ ok: false, error: "MAIL_OUTBOX_TEST_ONLY" });
  });

  it("a named provider returns a clear code and does not leak its text", async () => {
    setEnv("MAIL_PROVIDER", "somevendor");
    const r = await sendMail({ to: "a@b.test", subject: "s", text: "secret-link" });
    expect(r).toEqual({ ok: false, error: "MAIL_PROVIDER_NOT_IMPLEMENTED" });
    expect(JSON.stringify(r)).not.toContain("secret-link");
  });

  it("no outbox or mail table exists in the database", async () => {
    const t = await db().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%mail%' OR name LIKE '%outbox%'").all();
    expect(t.results).toHaveLength(0);
  });
});
