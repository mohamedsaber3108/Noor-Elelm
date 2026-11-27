import { describe, expect, it } from "vitest";
import { POST as exportPost, EXPORT_COLUMNS } from "@/app/api/admin/users/export/route";
import { csvCell, csvRow } from "@/lib/csv";
import { EVIL, STEP_UP, call, count, db, seedUser, signIn } from "../helpers";

const run = (body: unknown = STEP_UP, o = {}) => exportPost(call("POST", "/api/admin/users/export", body, o) as never);
/** Splits the CSV body into rows of raw cells (cells here hold no commas or newlines). */
const parse = (text: string) => text.replace(/^\uFEFF/, "").trim().split("\r\n").map((l) => l.split(",").map((c) => c.slice(1, -1).replace(/""/g, '"')));

describe("csvCell / csvRow", () => {
  it("quotes every cell and doubles quotes", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(12)).toBe('"12"');
    expect(csvRow(["a", "b"])).toBe('"a","b"');
  });
  it("prefixes formula starters with an apostrophe", () => {
    for (const s of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "\rx"]) expect(csvCell(s).startsWith(`"'`)).toBe(true);
    expect(csvCell("safe=1")).toBe('"safe=1"');
  });
});

describe("POST /api/admin/users/export (N-18b)", () => {
  it("no session, learner and reviewer get 403", async () => {
    expect((await run()).status).toBe(403);
    await signIn("learner");
    expect((await run()).status).toBe(403);
    await signIn("reviewer");
    expect((await run()).status).toBe(403);
  });
  it("cross-origin gets 403 BAD_ORIGIN and writes no USER_EXPORT row", async () => {
    await signIn("admin");
    const r = await run(STEP_UP, EVIL);
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("BAD_ORIGIN");
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='USER_EXPORT'")).toBe(0);
  });
  it("needs step-up: no password 400, wrong password 403, short reason 400; no file, no audit row", async () => {
    await signIn("admin");
    expect((await run({ reason: STEP_UP.reason })).status).toBe(400);
    expect((await run({ password: "wrong-password", reason: STEP_UP.reason })).status).toBe(403);
    expect((await run({ password: STEP_UP.password, reason: "short" })).status).toBe(400);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='USER_EXPORT'")).toBe(0);
  });
  it("returns a CSV attachment with the fixed columns, one row per user, no-store", async () => {
    const a = await signIn("admin");
    const l = await seedUser("learner", "ali@example.test");
    const r = await run();
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(r.headers.get("Content-Disposition")).toMatch(/^attachment; filename="noor-users-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const bytes = new Uint8Array(await r.clone().arrayBuffer());
    const text = await r.text();
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM (text() drops it when decoding)
    const rows = parse(text);
    expect(rows[0]).toEqual([...EXPORT_COLUMNS]);
    expect(rows).toHaveLength(3);
    const ids = rows.slice(1).map((c) => c[0]);
    expect(ids.sort()).toEqual([a.id, l.id].sort());
    const ali = rows.find((c) => c[1] === "ali@example.test")!;
    expect(ali[3]).toBe("learner");
    expect(ali[4]).toBe("active");
    expect(ali[5]).toBe("no");
  });
  it("marks suspended users and never includes the password hash or the staff note", async () => {
    await signIn("admin");
    const t = await seedUser("learner", "sus@example.test");
    await db().prepare("UPDATE users SET suspended_at=?, staff_note=? WHERE id=?").bind(Date.now(), "private staff text", t.id).run();
    const text = await (await run()).text();
    expect(parse(text).find((c) => c[1] === "sus@example.test")![4]).toBe("suspended");
    expect(text).not.toContain("private staff text");
    expect(text).not.toContain("pbkdf2$");
  });
  it("makes a formula-like name harmless", async () => {
    await signIn("admin");
    const t = await seedUser("learner", "f@example.test");
    await db().prepare("UPDATE users SET display_name=? WHERE id=?").bind('=HYPERLINK("http://x")', t.id).run();
    const text = await (await run()).text();
    expect(text).toContain(`"'=HYPERLINK(""http://x"")"`);
  });
  it("writes one USER_EXPORT audit row with the row count and reason, and no personal data", async () => {
    const a = await signIn("admin");
    await seedUser("learner", "private@example.test");
    expect((await run()).status).toBe(200);
    const row = await db().prepare("SELECT actor_id,target_id,detail_json,reason FROM audit_events WHERE action='USER_EXPORT'").first<{ actor_id: string; target_id: string; detail_json: string; reason: string }>();
    expect(row).toMatchObject({ actor_id: a.id, target_id: "users", reason: STEP_UP.reason });
    expect(JSON.parse(row!.detail_json)).toEqual({ rows: 2, truncated: false });
    expect(row!.detail_json).not.toContain("private@example.test");
  });
});
