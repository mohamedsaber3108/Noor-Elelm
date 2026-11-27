import { describe, expect, it, vi } from "vitest";
import { GET as adminGet, PUT as adminPut } from "@/app/api/admin/settings/route";
import { GET as publicGet } from "@/app/api/settings/route";
import { GET as quizNext } from "@/app/api/quiz/next/route";
import { POST as quizAnswer } from "@/app/api/quiz/answer/route";
import { POST as corrPost } from "@/app/api/corrections/route";
import summaries from "@/data/archive-summaries.json";
import { PRICING_NOTE_AR, PRICING_NOTE_EN, REGISTRATION_NOTE_AR, SETTINGS, SETTING_KEYS, featureOn, getSetting } from "@/lib/settings";
import { EVIL, call, count, db, signIn, signInUnverified } from "../helpers";
import { env } from "cloudflare:workers";

const REASON = "testing the settings page";
const put = (body: unknown, o = {}) => adminPut(call("PUT", "/api/admin/settings", body, o));
const get = () => adminGet();
const set = (key: string, value: unknown) => put({ key, value, reason: REASON });
const stored = async (key: string) => (await db().prepare("SELECT value FROM settings WHERE key=?").bind(key).first<{ value: string }>())?.value;
const DB = () => env.DB as unknown as D1Database;

describe("defaults and tolerant reads", () => {
  it("returns every default when nothing is stored, with today's wording", async () => {
    await signIn("admin");
    const j = await (await get()).json();
    expect(j.settings.map((s: { key: string }) => s.key)).toEqual(SETTING_KEYS);
    for (const s of j.settings) { expect(s.value).toEqual(s.default); expect(s.updatedBy).toBeNull(); }
    expect(await getSetting(DB(), "site.pricing_note_ar")).toBe(PRICING_NOTE_AR);
    expect(await getSetting(DB(), "site.pricing_note_en")).toBe(PRICING_NOTE_EN);
    expect(await getSetting(DB(), "site.registration_note_ar")).toBe(REGISTRATION_NOTE_AR);
    expect(await getSetting(DB(), "feature.game_enabled")).toBe(true);
  });
  it("a corrupt or wrong-type stored value falls back to the default", async () => {
    await db().prepare("INSERT INTO settings(key,value) VALUES('feature.game_enabled','{not json')").run();
    await db().prepare("INSERT INTO settings(key,value) VALUES('site.pricing_note_en','42')").run();
    expect(await getSetting(DB(), "feature.game_enabled")).toBe(true);
    expect(await getSetting(DB(), "site.pricing_note_en")).toBe(SETTINGS["site.pricing_note_en"].default);
  });
  it("a missing settings table gives the defaults instead of an error", async () => {
    await db().prepare("DROP TABLE settings").run();
    expect(await getSetting(DB(), "feature.game_enabled")).toBe(true);
  });
});

describe("flags fail closed on a database error", () => {
  const level = encodeURIComponent("سهل");
  const report = { contentId: (summaries as { id: string }[])[0].id, message: "This record has a wrong date in the second line." };
  // Make every read of the settings table fail with an error that is NOT "no such table"; other queries work.
  const breakSettingsReads = () => {
    const d = env.DB as unknown as { prepare: (sql: string) => unknown };
    const orig = d.prepare.bind(d);
    return vi.spyOn(d, "prepare").mockImplementation((sql: string) => {
      if (/FROM settings/i.test(sql)) throw new Error("D1_ERROR: disk I/O error");
      return orig(sql);
    });
  };
  it("a read error other than a missing table turns the flags off: quiz next, quiz answer and corrections answer 503", async () => {
    await signIn("learner");
    const spy = breakSettingsReads();
    try {
      expect(await featureOn(DB(), "feature.game_enabled")).toBe(false);
      expect(await featureOn(DB(), "feature.corrections_enabled")).toBe(false);
      const results = [
        await quizNext(call("GET", "/api/quiz/next?level=" + level)),
        await quizAnswer(call("POST", "/api/quiz/answer", { questionId: "x", answerKey: "a", token: "t" })),
        await corrPost(call("POST", "/api/corrections", report)),
      ];
      for (const res of results) {
        expect(res.status).toBe(503);
        expect((await res.json()).error).toBe("FEATURE_OFF");
      }
      // Text notes still fall back to their defaults.
      expect(await getSetting(DB(), "site.pricing_note_en")).toBe(PRICING_NOTE_EN);
    } finally {
      spy.mockRestore();
    }
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='CORRECTION_REPORT'")).toBe(0);
  });
  it("a missing settings table keeps today's behaviour: flags on, routes work", async () => {
    await signIn("learner");
    await db().prepare("DROP TABLE settings").run();
    expect(await featureOn(DB(), "feature.game_enabled")).toBe(true);
    expect((await quizNext(call("GET", "/api/quiz/next?level=" + level))).status).toBe(200);
    expect((await corrPost(call("POST", "/api/corrections", report))).status).toBe(201);
  });
  it("a corrupt stored flag still gives the default (on)", async () => {
    await db().prepare("INSERT INTO settings(key,value) VALUES('feature.corrections_enabled','{not json')").run();
    expect(await featureOn(DB(), "feature.corrections_enabled")).toBe(true);
  });
});

describe("access control", () => {
  it("learner and reviewer get 403 on GET and PUT and nothing changes", async () => {
    for (const role of ["learner", "reviewer"] as const) {
      await signIn(role);
      expect((await get()).status).toBe(403);
      expect((await set("feature.game_enabled", false)).status).toBe(403);
    }
    expect(await count("SELECT COUNT(*) AS n FROM settings")).toBe(0);
  });
  it("no session gives 403", async () => {
    expect((await get()).status).toBe(403);
  });
  it("an admin whose MFA is not verified is refused", async () => {
    await signInUnverified("admin");
    expect([401, 403]).toContain((await get()).status);
    expect([401, 403]).toContain((await set("feature.game_enabled", false)).status);
    expect(await count("SELECT COUNT(*) AS n FROM settings")).toBe(0);
  });
  it("PUT cross-origin gives 403 BAD_ORIGIN and changes nothing", async () => {
    await signIn("admin");
    const res = await put({ key: "feature.game_enabled", value: false, reason: REASON }, EVIL);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("BAD_ORIGIN");
    expect(await stored("feature.game_enabled")).toBeUndefined();
  });
});

describe("PUT /api/admin/settings", () => {
  it("writes the value and a SETTING_CHANGED audit row in the same batch", async () => {
    const admin = await signIn("admin");
    expect((await set("feature.game_enabled", false)).status).toBe(200);
    expect(await stored("feature.game_enabled")).toBe("false");
    const a = await db().prepare("SELECT actor_id,target_id,detail_json,reason FROM audit_events WHERE action='SETTING_CHANGED'").first<{ actor_id: string; target_id: string; detail_json: string; reason: string }>();
    expect(a).toMatchObject({ actor_id: admin.id, target_id: "feature.game_enabled", reason: REASON });
    expect(JSON.parse(a!.detail_json)).toEqual({ setting: "feature.game_enabled", before: "true", after: "false" });
    const row = (await (await get()).json()).settings.find((s: { key: string }) => s.key === "feature.game_enabled");
    expect(row).toMatchObject({ value: false, updatedBy: admin.id });
    expect(row.updatedAt).toBeGreaterThan(0);
  });
  it("audit detail is cut to 500 characters", async () => {
    await signIn("admin");
    await set("site.pricing_note_en", "x".repeat(500));
    const a = await db().prepare("SELECT detail_json FROM audit_events WHERE action='SETTING_CHANGED'").first<{ detail_json: string }>();
    expect(JSON.parse(a!.detail_json).after.length).toBeLessThanOrEqual(500);
  });
  it("a failed audit write leaves the setting unchanged and answers 503", async () => {
    await signIn("admin");
    await db().prepare("CREATE TRIGGER test_audit_down BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'AUDIT_DOWN'); END").run();
    const res = await set("feature.game_enabled", false);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("AUDIT_UNAVAILABLE");
    expect(await stored("feature.game_enabled")).toBeUndefined();
  });
  it("refuses an unknown key (400) and writes nothing", async () => {
    await signIn("admin");
    for (const k of ["feature.nope", "__proto__", "toString", ""]) expect((await set(k, true)).status).toBe(400);
    expect(await count("SELECT COUNT(*) AS n FROM settings")).toBe(0);
  });
  it("requires a reason of 10 to 300 characters", async () => {
    await signIn("admin");
    for (const reason of [undefined, "", "short", "x".repeat(301)]) expect((await put({ key: "feature.game_enabled", value: false, reason })).status).toBe(400);
    expect((await put({ key: "feature.game_enabled", value: false, reason: "x".repeat(300) })).status).toBe(200);
  });
  it("validates values: wrong type, empty, too long, tags, control characters and bidi control marks are refused", async () => {
    await signIn("admin");
    const bad: [string, unknown][] = [
      ["feature.game_enabled", "false"], ["feature.game_enabled", 1], ["site.pricing_note_en", true], ["site.pricing_note_en", ""], ["site.pricing_note_en", "   "],
      ["site.pricing_note_en", "x".repeat(501)], ["site.pricing_note_en", "<script>alert(1)</script>"], ["site.pricing_note_ar", "a<b"], ["site.pricing_note_en", "a\u0000b"],
      ["site.pricing_note_en", "abc\u202Edef"], ["site.pricing_note_ar", "\u200Fنص"], ["site.registration_note_en", "a\u2066b\u2069"],
    ];
    for (const [k, v] of bad) expect((await set(k, v)).status).toBe(400);
    expect(await count("SELECT COUNT(*) AS n FROM settings")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='SETTING_CHANGED'")).toBe(0);
  });
  it("keeps plain text as it is (Arabic and punctuation), as a string, never changed", async () => {
    await signIn("admin");
    const t = "الخطط غير متاحة بعد & ‘free’ now";
    expect((await set("site.pricing_note_ar", t)).status).toBe(200);
    expect(await getSetting(DB(), "site.pricing_note_ar")).toBe(t);
  });
  it("answers 400 for a bad JSON body", async () => {
    await signIn("admin");
    expect((await adminPut(call("PUT", "/api/admin/settings", "{bad"))).status).toBe(400);
  });
});

describe("module registry", () => {
  it("lists the six modules with roles and state, and hides a module whose backend is broken", async () => {
    await signIn("admin");
    const ids = (await (await get()).json()).modules.map((m: { id: string }) => m.id);
    expect(ids).toEqual(["users", "editorial", "infographics", "corrections", "audit", "settings"]);
    await db().prepare("DROP TABLE content_items").run();
    const after = (await (await get()).json()).modules.map((m: { id: string }) => m.id);
    expect(after).not.toContain("editorial");
    expect(after).toContain("users");
  });
  it("the corrections module shows off when its flag is off", async () => {
    await signIn("admin");
    await set("feature.corrections_enabled", false);
    const m = (await (await get()).json()).modules.find((x: { id: string }) => x.id === "corrections");
    expect(m.state).toBe("off");
    expect(m.roles).toEqual(["reviewer", "admin"]);
  });
});

describe("GET /api/settings (public)", () => {
  it("needs no session and returns only site.* and feature.* keys", async () => {
    const j = await (await publicGet()).json();
    expect(Object.keys(j.settings).sort()).toEqual([...SETTING_KEYS].sort());
    for (const k of Object.keys(j.settings)) expect(/^(site|feature)\./.test(k)).toBe(true);
    expect(JSON.stringify(j)).not.toMatch(/updatedBy|updated_by|reason/);
  });
  it("does not leak a stray row that is not in the registry", async () => {
    await db().prepare("INSERT INTO settings(key,value) VALUES('internal.secret_thing','\"x\"')").run();
    const j = await (await publicGet()).json();
    expect(j.settings["internal.secret_thing"]).toBeUndefined();
  });
  it("shows a changed value and sets a short cache", async () => {
    await signIn("admin");
    await set("site.pricing_note_en", "Free while we build.");
    const res = await publicGet();
    expect((await res.json()).settings["site.pricing_note_en"]).toBe("Free while we build.");
    expect(res.headers.get("cache-control")).toMatch(/max-age=\d+/);
  });
});

describe("flags are enforced", () => {
  const level = encodeURIComponent("سهل");
  const report = { contentId: (summaries as { id: string }[])[0].id, message: "This record has a wrong date in the second line." };
  it("game flag off: quiz next and answer answer 503 FEATURE_OFF; on: old behaviour", async () => {
    const admin = await signIn("admin");
    expect((await quizNext(call("GET", "/api/quiz/next?level=" + level))).status).toBe(200);
    await set("feature.game_enabled", false);
    for (const res of [await quizNext(call("GET", "/api/quiz/next?level=" + level)), await quizAnswer(call("POST", "/api/quiz/answer", { questionId: "x", answerKey: "a", token: "t" }))]) {
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("FEATURE_OFF");
    }
    expect(await count("SELECT COUNT(*) AS n FROM quiz_served WHERE user_id=?", admin.id)).toBe(1);
    await set("feature.game_enabled", true);
    expect((await quizNext(call("GET", "/api/quiz/next?level=" + level))).status).toBe(200);
  });
  it("corrections flag off: POST answers 503 FEATURE_OFF and stores nothing; on: 201", async () => {
    await signIn("learner");
    expect((await corrPost(call("POST", "/api/corrections", report))).status).toBe(201);
    await db().prepare("INSERT INTO settings(key,value) VALUES('feature.corrections_enabled','false')").run();
    const res = await corrPost(call("POST", "/api/corrections", report));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("FEATURE_OFF");
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='CORRECTION_REPORT'")).toBe(1);
    await db().prepare("UPDATE settings SET value='true' WHERE key='feature.corrections_enabled'").run();
    expect((await corrPost(call("POST", "/api/corrections", report))).status).toBe(201);
  });
});
