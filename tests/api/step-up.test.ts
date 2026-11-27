import { describe, expect, it } from "vitest";
import { PUT } from "@/app/api/admin/users/route";
import { MAX_FAILS } from "@/lib/step-up";
import { PASSWORD, STEP_UP, call, count, db, seedUser, signIn } from "../helpers";

const put = (body: unknown) => PUT(call("PUT", "/api/admin/users", body));
const roleOf = async (id: string) => (await db().prepare("SELECT role FROM users WHERE id=?").bind(id).first<{ role: string }>())?.role;

describe("step-up on role change (N-15b)", () => {
  it("no password: 400 STEP_UP_REQUIRED and nothing changes", async () => {
    await signIn("admin");
    const t = await seedUser("learner");
    const res = await put({ id: t.id, role: "reviewer", reason: STEP_UP.reason });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("STEP_UP_REQUIRED");
    expect(await roleOf(t.id)).toBe("learner");
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='ROLE_CHANGED'")).toBe(0);
  });
  it("making someone an admin needs step-up too", async () => {
    await signIn("admin");
    const t = await seedUser("learner");
    expect((await put({ id: t.id, role: "admin" })).status).toBe(400);
    expect(await roleOf(t.id)).toBe("learner");
    expect((await put({ id: t.id, role: "admin", ...STEP_UP })).status).toBe(200);
    expect(await roleOf(t.id)).toBe("admin");
  });
  it("missing, short or long reason: 400 REASON_REQUIRED", async () => {
    await signIn("admin");
    const t = await seedUser("learner");
    for (const reason of [undefined, "too short", "   padded   ", "x".repeat(301)]) {
      const res = await put({ id: t.id, role: "reviewer", password: PASSWORD, reason });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("REASON_REQUIRED");
    }
    expect(await roleOf(t.id)).toBe("learner");
  });
  it("wrong password: 403 STEP_UP_FAILED, one failed audit row, nothing changes", async () => {
    const admin = await signIn("admin");
    const t = await seedUser("learner");
    const res = await put({ id: t.id, role: "reviewer", password: "wrong-password", reason: STEP_UP.reason });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("STEP_UP_FAILED");
    expect(await roleOf(t.id)).toBe("learner");
    const a = await db().prepare("SELECT actor_id,target_id,result,detail_json FROM audit_events WHERE action='STEP_UP_FAILED'").first<{ actor_id: string; target_id: string; result: string; detail_json: string }>();
    expect(a).toMatchObject({ actor_id: admin.id, target_id: "PUT /api/admin/users", result: "failed" });
    expect(a!.detail_json).not.toContain("wrong-password");
  });
  it(`after ${MAX_FAILS} wrong passwords even the right one gets 429 RATE_LIMITED`, async () => {
    await signIn("admin");
    const t = await seedUser("learner");
    for (let i = 0; i < MAX_FAILS; i++) {
      expect((await put({ id: t.id, role: "reviewer", password: "nope", reason: STEP_UP.reason })).status).toBe(403);
    }
    const res = await put({ id: t.id, role: "reviewer", ...STEP_UP });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("RATE_LIMITED");
    expect(await roleOf(t.id)).toBe("learner");
  });
  it("successful step-ups do not count as failures", async () => {
    await signIn("admin");
    const t = await seedUser("learner");
    for (let i = 0; i <= MAX_FAILS; i++) {
      expect((await put({ id: t.id, role: i % 2 ? "reviewer" : "scholar", ...STEP_UP })).status).toBe(200);
    }
  });
  it("success stores the trimmed reason on the ROLE_CHANGED row, never the password", async () => {
    await signIn("admin");
    const t = await seedUser("learner");
    expect((await put({ id: t.id, role: "scholar", password: PASSWORD, reason: "  Approved by the board.  " })).status).toBe(200);
    const a = await db().prepare("SELECT reason,detail_json FROM audit_events WHERE action='ROLE_CHANGED'").first<{ reason: string; detail_json: string }>();
    expect(a?.reason).toBe("Approved by the board.");
    expect(a!.detail_json).not.toContain(PASSWORD);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='STEP_UP_FAILED'")).toBe(0);
  });
});
