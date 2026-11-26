import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as sessionGet } from "@/app/api/auth/[action]/route";
import { GET as corrGet } from "@/app/api/corrections/route";
import { GET as meGet } from "@/app/api/me/route";
import { POST as enroll } from "@/app/api/auth/mfa/enroll/route";
import { POST as verify } from "@/app/api/auth/mfa/verify/route";
import { POST as recover } from "@/app/api/auth/mfa/recover/route";
import { SESSION_COOKIE, createSession, staffLimitsMs } from "@/app/auth";
import { base32Decode, stepAt, totpAt } from "@/lib/totp";
import { setCookie } from "../mocks/next-headers";
import { authCtx, call, count, db, seedUser, setEnv, signIn, signInUnverified } from "../helpers";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const realNow = Date.now.bind(Date);
let offset = 0;
beforeEach(() => {
  offset = 0;
  vi.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
  setEnv("MFA_SECRET_KEY", crypto.randomUUID() + crypto.randomUUID());
});
afterEach(() => {
  vi.restoreAllMocks();
  setEnv("STAFF_IDLE_MINUTES", undefined);
  setEnv("STAFF_ABSOLUTE_HOURS", undefined);
});

const probe = async (peek = false) => (await (await sessionGet(call("GET", `/api/auth/session${peek ? "?peek=1" : ""}`) as never, authCtx("session"))).json()).user;
const lastSeen = async (userId: string) => (await db().prepare("SELECT last_seen_at AS t FROM sessions WHERE user_id=?").bind(userId).first<{ t: number | null }>())?.t;
const post = (h: (r: never) => Promise<Response>, body: unknown) => h(call("POST", "/api/auth/mfa/x", body) as never);
const newCookie = (r: Response) => (r as unknown as { cookies: { get: (n: string) => { value: string } | undefined } }).cookies.get(SESSION_COOKIE)?.value;

describe("staff idle and absolute limits", () => {
  it("idle: 29 minutes of silence is fine, 31 ends the session and removes the row", async () => {
    const u = await signIn("reviewer");
    offset = 29 * MIN;
    expect((await corrGet()).status).toBe(200); // counts as use
    offset = 29 * MIN + 29 * MIN;
    expect((await corrGet()).status).toBe(200);
    offset += 31 * MIN;
    expect((await corrGet()).status).toBe(403);
    expect(await probe()).toBeNull();
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id=?", u.id)).toBe(0);
  });
  it("absolute: 8 hours after MFA ends the session even with steady use", async () => {
    await signIn("admin");
    for (let i = 1; i <= 16; i++) { offset = i * 29 * MIN; expect((await corrGet()).status).toBe(200); } // 7h44, used every 29 min
    offset = 7 * HOUR + 55 * MIN; // inside the 8 hours
    expect((await corrGet()).status).toBe(200);
    offset = 8 * HOUR + MIN; // 6 min after the last use, but past 8 hours
    expect((await corrGet()).status).toBe(403);
  });
  it("a staff user from REVIEWER_IDS is limited too", async () => {
    const u = await signIn("learner");
    setEnv("REVIEWER_IDS", u.id);
    await db().prepare("UPDATE sessions SET mfa_verified_at=? WHERE user_id=?").bind(Date.now(), u.id).run();
    expect((await corrGet()).status).toBe(200);
    offset = 31 * MIN;
    expect((await corrGet()).status).toBe(403);
  });
  it("a learner is not limited: still signed in at 29 days, gone at 31", async () => {
    await signIn("learner");
    offset = 29 * DAY;
    expect((await meGet()).status).toBe(200);
    expect((await probe()).staffExpiresInSeconds).toBeNull();
    offset = 31 * DAY;
    expect((await meGet()).status).toBe(401);
  });
  it("last_seen_at is written at most once a minute", async () => {
    const u = await signIn("reviewer");
    expect(await lastSeen(u.id)).toBeNull();
    offset = 30_000;
    await corrGet();
    expect(await lastSeen(u.id)).toBeNull(); // under 60 s: no write
    offset = 61_000;
    await corrGet();
    const t1 = (await lastSeen(u.id))!;
    expect(t1).toBeGreaterThan(0);
    offset = 100_000;
    await corrGet();
    expect(await lastSeen(u.id)).toBe(t1); // 39 s later: no write
    offset = 125_000;
    await corrGet();
    expect(await lastSeen(u.id)).toBeGreaterThan(t1);
  });
  it("env overrides limits; bad values fall back to 30 minutes and 8 hours", () => {
    expect(staffLimitsMs()).toEqual({ idle: 30 * MIN, absolute: 8 * HOUR });
    setEnv("STAFF_IDLE_MINUTES", "5");
    setEnv("STAFF_ABSOLUTE_HOURS", "2");
    expect(staffLimitsMs()).toEqual({ idle: 5 * MIN, absolute: 2 * HOUR });
    for (const bad of ["abc", "0", "-3", "", "NaN", "Infinity"]) {
      setEnv("STAFF_IDLE_MINUTES", bad);
      setEnv("STAFF_ABSOLUTE_HOURS", bad);
      expect(staffLimitsMs()).toEqual({ idle: 30 * MIN, absolute: 8 * HOUR });
    }
  });
  it("a short idle limit from env ends a session", async () => {
    await signIn("admin");
    setEnv("STAFF_IDLE_MINUTES", "5");
    offset = 6 * MIN;
    expect((await corrGet()).status).toBe(403);
  });
});

describe("session probe", () => {
  it("reports staffExpiresInSeconds for verified staff, null for learners", async () => {
    await signIn("reviewer");
    const s = (await probe()).staffExpiresInSeconds;
    expect(s).toBeGreaterThan(30 * 60 - 5);
    expect(s).toBeLessThanOrEqual(30 * 60);
    offset = 20 * MIN;
    expect((await probe(true)).staffExpiresInSeconds).toBeLessThanOrEqual(10 * 60);
  });
  it("is capped by the absolute limit", async () => {
    await signIn("admin");
    offset = 7 * HOUR + 50 * MIN;
    await db().prepare("UPDATE sessions SET last_seen_at=?").bind(Date.now()).run();
    const s = (await probe()).staffExpiresInSeconds;
    expect(s).toBeLessThanOrEqual(10 * 60);
    expect(s).toBeGreaterThan(0);
  });
  it("peek does not count as use; a normal read does", async () => {
    const u = await signIn("reviewer");
    offset = 20 * MIN;
    await probe(true);
    expect(await lastSeen(u.id)).toBeNull();
    await probe();
    expect(await lastSeen(u.id)).not.toBeNull();
  });
  it("a learner and an unverified staff session report null", async () => {
    await signIn("learner");
    expect((await probe()).staffExpiresInSeconds).toBeNull();
    await signInUnverified("reviewer");
    expect((await probe()).staffExpiresInSeconds).toBeNull();
  });
});

describe("session id rotation after MFA", () => {
  const codeFor = async (secret: string, off = 0) => totpAt(base32Decode(secret), stepAt(Date.now()) + off);
  it("verify: the old cookie is dead, the new one works, the audit row exists", async () => {
    const u = await signInUnverified("admin");
    const e = await (await post(enroll, undefined)).json();
    const r = await post(verify, { code: await codeFor(e.secret) });
    expect(r.status).toBe(200);
    const fresh = newCookie(r);
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(u.token);
    setCookie(SESSION_COOKIE, u.token);
    expect((await corrGet()).status).toBe(403);
    expect(await probe()).toBeNull();
    setCookie(SESSION_COOKIE, fresh!);
    expect((await corrGet()).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id=?", u.id)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='MFA_ENROLLED' AND actor_id=?", u.id)).toBe(1);
  });
  it("recover: the old cookie is dead, the new one works, the audit row exists", async () => {
    const u = await signInUnverified("reviewer");
    const e = await (await post(enroll, undefined)).json();
    const first = await post(verify, { code: await codeFor(e.secret) });
    const codes = (await first.json()).recoveryCodes as string[];
    const old = await createSession(u.id, "vitest");
    setCookie(SESSION_COOKIE, old);
    const r = await post(recover, { code: codes[0] });
    expect(r.status).toBe(200);
    const fresh = newCookie(r);
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(old);
    setCookie(SESSION_COOKIE, old);
    expect((await corrGet()).status).toBe(403);
    setCookie(SESSION_COOKIE, fresh!);
    expect((await corrGet()).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='MFA_RECOVERY_USED' AND actor_id=?", u.id)).toBe(1);
  });
  it("a wrong code does not rotate or set a cookie", async () => {
    const u = await signInUnverified("admin");
    await post(enroll, undefined);
    const r = await post(verify, { code: "000000" });
    expect(r.status).toBe(401);
    expect(newCookie(r)).toBeUndefined();
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id=?", u.id)).toBe(1);
  });
  it("a staff session that has not passed MFA is not cut by the idle limit", async () => {
    await seedUser("learner");
    const u = await signInUnverified("reviewer");
    offset = 2 * HOUR;
    expect((await probe()).mfa).toBe("required");
    expect(u.id).toBeTruthy();
  });
});
