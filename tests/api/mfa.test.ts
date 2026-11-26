import { describe, expect, it } from "vitest";
import { GET as contentGet, PUT as contentPut } from "@/app/api/admin/content/route";
import { GET as importGet, POST as importPost } from "@/app/api/admin/import/route";
import { GET as reviewGet, POST as reviewPost } from "@/app/api/admin/review/route";
import { GET as queueGet } from "@/app/api/admin/visual-queue/route";
import { DELETE as usersDel, GET as usersGet, PUT as usersPut } from "@/app/api/admin/users/route";
import { GET as corrGet } from "@/app/api/corrections/route";
import { GET as meGet } from "@/app/api/me/route";
import { GET as sessionGet, POST as authPost } from "@/app/api/auth/[action]/route";
import { POST as enroll } from "@/app/api/auth/mfa/enroll/route";
import { POST as verify } from "@/app/api/auth/mfa/verify/route";
import { POST as recover } from "@/app/api/auth/mfa/recover/route";
import { setCookie } from "../mocks/next-headers";
import { SESSION_COOKIE, createSession } from "@/app/auth";
import { decryptSecret, encryptSecret, hashRecovery, matchesRecovery } from "@/lib/mfa";
import { base32Decode, base32Encode, stepAt, totpAt, verifyTotp } from "@/lib/totp";
import { PASSWORD, authCtx, call, count, db, seedUser, setEnv, signIn, signInUnverified, verifySessions, EVIL } from "../helpers";

// The key is made up at run time. No key value is written in this repository.
const useKey = () => setEnv("MFA_SECRET_KEY", crypto.randomUUID() + crypto.randomUUID());
const post = (h: (r: never) => Promise<Response>, body: unknown, o = {}) => h(call("POST", "/api/auth/mfa/x", body, o) as never);
const codeFor = async (secretText: string, offset = 0) => totpAt(base32Decode(secretText), stepAt(Date.now()) + offset);
const freshSession = async (userId: string) => setCookie(SESSION_COOKIE, await createSession(userId, "vitest"));

/** Enrols the signed-in (unverified) staff user and returns the secret and recovery codes. */
async function enrolNow() {
  const e = await (await post(enroll, undefined)).json();
  const v = await post(verify, { code: await codeFor(e.secret) });
  expect(v.status).toBe(200);
  return { secret: e.secret as string, recoveryCodes: (await v.json()).recoveryCodes as string[] };
}

describe("TOTP (RFC 6238 appendix B, SHA1, 8 digits)", () => {
  const key = new TextEncoder().encode("12345678901234567890");
  const vectors: [number, string][] = [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]];
  for (const [t, code] of vectors) it(`t=${t} gives ${code}`, async () => expect(await totpAt(key, stepAt(t * 1000), 8)).toBe(code));
  it("base32 round trip", () => {
    const b = crypto.getRandomValues(new Uint8Array(20));
    expect([...base32Decode(base32Encode(b))]).toEqual([...b]);
    expect(base32Encode(key)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });
  it("accepts previous, current and next step, refuses two steps away", async () => {
    const now = 1_700_000_000_000, s = stepAt(now);
    for (const off of [-1, 0, 1]) expect(await verifyTotp(key, await totpAt(key, s + off), now, null)).toBe(s + off);
    expect(await verifyTotp(key, await totpAt(key, s + 2), now, null)).toBeNull();
    expect(await verifyTotp(key, await totpAt(key, s - 2), now, null)).toBeNull();
  });
  it("refuses the same or an older step (replay)", async () => {
    const now = 1_700_000_000_000, s = stepAt(now);
    expect(await verifyTotp(key, await totpAt(key, s), now, s)).toBeNull();
    expect(await verifyTotp(key, await totpAt(key, s - 1), now, s)).toBeNull();
    expect(await verifyTotp(key, await totpAt(key, s + 1), now, s)).toBe(s + 1);
  });
  it("refuses non six-digit input", async () => expect(await verifyTotp(key, "12345", Date.now(), null)).toBeNull());
});

describe("secret encryption and recovery hashes", () => {
  it("round trips and binds to the user", async () => {
    useKey();
    const s = crypto.getRandomValues(new Uint8Array(20));
    const stored = await encryptSecret(s, "u1");
    expect(stored.startsWith("v1$")).toBe(true);
    expect([...(await decryptSecret(stored, "u1"))]).toEqual([...s]);
    await expect(decryptSecret(stored, "u2")).rejects.toThrow();
  });
  it("fails closed when the key is not set or too short", async () => {
    await expect(encryptSecret(new Uint8Array(20), "u1")).rejects.toThrow("MFA_NOT_CONFIGURED");
    setEnv("MFA_SECRET_KEY", "short");
    await expect(encryptSecret(new Uint8Array(20), "u1")).rejects.toThrow("MFA_NOT_CONFIGURED");
  });
  it("salts recovery hashes and ignores case and dashes", async () => {
    const a = await hashRecovery("ABCDE-FGHJK"), b = await hashRecovery("ABCDE-FGHJK");
    expect(a).not.toBe(b);
    expect(await matchesRecovery("abcde fghjk", a)).toBe(true);
    expect(await matchesRecovery("ABCDE-FGHJL", a)).toBe(false);
  });
});

describe("routes fail closed without MFA_SECRET_KEY", () => {
  it("enroll, verify and recover return MFA_NOT_CONFIGURED", async () => {
    await signInUnverified("admin");
    for (const h of [enroll, verify, recover]) {
      const r = await post(h, { code: "123456" });
      expect(r.status).toBe(503);
      expect((await r.json()).error).toBe("MFA_NOT_CONFIGURED");
    }
    expect(await count("SELECT COUNT(*) AS n FROM user_mfa")).toBe(0);
  });
});

describe("staff session without MFA", () => {
  const admin = [
    () => contentGet(call("GET", "/api/admin/content?id=x") as never),
    () => contentPut(call("PUT", "/api/admin/content", { id: "x", title: "t", body: "b", revision: 0 }) as never),
    () => importGet(),
    () => importPost(call("POST", "/api/admin/import", {}) as never),
    () => reviewGet(call("GET", "/api/admin/review?id=x") as never),
    () => reviewPost(call("POST", "/api/admin/review", {}) as never),
    () => queueGet(),
    () => usersGet(call("GET", "/api/admin/users") as never),
    () => usersPut(call("PUT", "/api/admin/users", { id: "x", role: "admin" }) as never),
    () => usersDel(call("DELETE", "/api/admin/users", { id: "x" }) as never),
    () => corrGet(),
  ];
  for (const role of ["admin", "reviewer"] as const) {
    it(`${role}: 403 on every admin route until verified, 200 after`, async () => {
      const u = await signInUnverified(role);
      for (const h of admin) expect((await h()).status).toBe(403);
      await verifySessions(u.id);
      expect((await corrGet()).status).toBe(200);
      expect((await queueGet()).status).toBe(200);
    });
  }
  it("a user in REVIEWER_IDS is staff too", async () => {
    const u = await signInUnverified("learner");
    setEnv("REVIEWER_IDS", u.id);
    expect((await corrGet()).status).toBe(403);
    expect((await meGet()).status).toBe(401);
    await verifySessions(u.id);
    expect((await corrGet()).status).toBe(200);
  });
  it("is treated as signed out elsewhere, but the session probe says MFA is required", async () => {
    await signInUnverified("reviewer");
    expect((await meGet()).status).toBe(401);
    const j = await (await sessionGet(call("GET", "/api/auth/session") as never, authCtx("session"))).json();
    expect(j.user).toMatchObject({ reviewer: false, mfa: "required" });
  });
  it("a learner is not affected", async () => {
    await signIn("learner");
    expect((await meGet()).status).toBe(200);
    const j = await (await sessionGet(call("GET", "/api/auth/session") as never, authCtx("session"))).json();
    expect(j.user.mfa).toBeUndefined();
    useKey();
    expect((await post(enroll, undefined)).status).toBe(403);
  });
  it("login of staff answers mfa:required with an unverified session; a learner login does not", async () => {
    const s = await seedUser("reviewer"), l = await seedUser("learner");
    const a = await authPost(call("POST", "/api/auth/login", { email: s.email, password: PASSWORD }) as never, authCtx("login"));
    expect((await a.json()).mfa).toBe("required");
    const b = await authPost(call("POST", "/api/auth/login", { email: l.email, password: PASSWORD }) as never, authCtx("login"));
    expect((await b.json()).mfa).toBeUndefined();
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE mfa_verified_at IS NOT NULL")).toBe(0);
  });
});

describe("enrol, verify, recover", () => {
  it("enrols: secret stored encrypted, 10 recovery codes shown once, session verified, audit written", async () => {
    useKey();
    const u = await signInUnverified("admin");
    const e = await (await post(enroll, undefined)).json();
    expect(e.otpauth).toMatch(/^otpauth:\/\/totp\//);
    expect(e.otpauth).toContain(`secret=${e.secret}`);
    expect((await db().prepare("SELECT secret_enc FROM user_mfa WHERE user_id=?").bind(u.id).first<{ secret_enc: string }>())!.secret_enc).not.toContain(e.secret);
    expect((await usersGet(call("GET", "/api/admin/users") as never)).status).toBe(403);
    const v = await (await post(verify, { code: await codeFor(e.secret) })).json();
    expect(v.recoveryCodes).toHaveLength(10);
    expect((await usersGet(call("GET", "/api/admin/users") as never)).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM mfa_recovery_codes WHERE user_id=?", u.id)).toBe(10);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='MFA_ENROLLED' AND actor_id=?", u.id)).toBe(1);
  });
  it("refuses a cross-site enrol and a second enrolment", async () => {
    useKey();
    await signInUnverified("reviewer");
    expect((await post(enroll, undefined, EVIL)).status).toBe(403);
    await enrolNow();
    expect((await post(enroll, undefined)).status).toBe(409);
  });
  it("a new login verifies with a later step; the same step again is a replay", async () => {
    useKey();
    const u = await signInUnverified("reviewer");
    const { secret } = await enrolNow();
    await freshSession(u.id);
    expect((await corrGet()).status).toBe(403);
    const later = await codeFor(secret, 1);
    expect((await post(verify, { code: later })).status).toBe(200);
    expect((await corrGet()).status).toBe(200);
    await freshSession(u.id);
    expect((await post(verify, { code: later })).status).toBe(401);
    expect((await corrGet()).status).toBe(403);
  });
  it("wrong codes of every kind give the same error and write MFA_FAILED", async () => {
    useKey();
    const u = await signInUnverified("admin");
    const { secret } = await enrolNow();
    await freshSession(u.id);
    const bodies = [{ code: "000000" }, { code: "abc" }, {}, { code: await codeFor(secret, 5) }];
    const seen = new Set<string>();
    for (const b of bodies) { const r = await post(verify, b); expect(r.status).toBe(401); seen.add(JSON.stringify(await r.json())); }
    expect(seen.size).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='MFA_FAILED'")).toBe(4);
  });
  it("a recovery code works once", async () => {
    useKey();
    const u = await signInUnverified("admin");
    const { recoveryCodes } = await enrolNow();
    await freshSession(u.id);
    expect((await corrGet()).status).toBe(403);
    expect((await post(recover, { code: recoveryCodes[0].toLowerCase() })).status).toBe(200);
    expect((await corrGet()).status).toBe(200);
    await freshSession(u.id);
    const again = await post(recover, { code: recoveryCodes[0] });
    expect(again.status).toBe(401);
    expect((await again.json()).error).toBe("MFA_INVALID_CODE");
    expect((await post(recover, { code: recoveryCodes[1] })).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='MFA_RECOVERY_USED'")).toBe(2);
  });
  it("recovery does not work for someone who never enrolled", async () => {
    useKey();
    await signInUnverified("admin");
    expect((await post(recover, { code: "AAAAA-BBBBB" })).status).toBe(401);
  });
  it("rate limits after 5 tries, even when the sixth code is right", async () => {
    useKey();
    const u = await signInUnverified("admin");
    const { secret } = await enrolNow(); // 1 try used
    await freshSession(u.id);
    for (let i = 0; i < 4; i++) expect((await post(verify, { code: "000000" })).status).toBe(401);
    const r = await post(verify, { code: await codeFor(secret, 1) });
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe("RATE_LIMITED");
    expect((await corrGet()).status).toBe(403);
  });
  it("audit rows hold no secret, code or hash", async () => {
    useKey();
    const u = await signInUnverified("admin");
    const { secret, recoveryCodes } = await enrolNow();
    await freshSession(u.id);
    await post(verify, { code: "111111" });
    await post(recover, { code: recoveryCodes[3] });
    const rows = (await db().prepare("SELECT action,detail_json FROM audit_events WHERE action LIKE 'MFA_%'").all<{ action: string; detail_json: string }>()).results;
    expect(new Set(rows.map((r) => r.action))).toEqual(new Set(["MFA_ENROLLED", "MFA_FAILED", "MFA_RECOVERY_USED"]));
    const text = JSON.stringify(rows);
    expect(text).not.toContain(secret);
    expect(text).not.toContain("111111");
    for (const c of recoveryCodes) expect(text).not.toContain(c);
    const hashes = (await db().prepare("SELECT code_hash FROM mfa_recovery_codes").all<{ code_hash: string }>()).results.map((r) => r.code_hash.split("$")[1]);
    for (const h of hashes) expect(text).not.toContain(h);
  });
});

describe("admin reset of another user's MFA", () => {
  it("works for a verified admin, clears MFA and sessions, writes MFA_RESET", async () => {
    useKey();
    const t = await seedUser("reviewer");
    await freshSession(t.id);
    await enrolNow();
    const admin = await signIn("admin");
    const r = await usersPut(call("PUT", "/api/admin/users", { id: t.id, resetMfa: true }) as never);
    expect(r.status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM user_mfa WHERE user_id=?", t.id)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM mfa_recovery_codes WHERE user_id=?", t.id)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM sessions WHERE user_id=?", t.id)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='MFA_RESET' AND actor_id=? AND target_id=?", admin.id, t.id)).toBe(1);
  });
  it("is refused for the admin's own account, an unverified admin, a cross-site request; 404 for a missing user", async () => {
    const a = await signIn("admin");
    const put = (id: string, o = {}) => usersPut(call("PUT", "/api/admin/users", { id, resetMfa: true }, o) as never);
    const self = await put(a.id);
    expect(self.status).toBe(403);
    expect((await self.json()).error).toBe("SELF_RESET_REFUSED");
    expect((await put("nobody")).status).toBe(404);
    expect((await put("nobody", EVIL)).status).toBe(403);
    const b = await seedUser("admin");
    await freshSession(b.id);
    expect((await put(a.id)).status).toBe(403);
  });
});
