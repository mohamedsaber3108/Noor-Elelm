import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/admin/editorial/route";
import { visualQueue, archiveRows } from "@/lib/visual-queue";
import { call, db, signIn, signInUnverified } from "../helpers";

const get = () => GET(call("GET", "/api/admin/editorial"));
const item = (id: string, status: string) =>
  db().prepare("INSERT INTO content_items(id,world,slug,title,body,status) VALUES(?,?,?,?,?,?)").bind(id, "w", id.toLowerCase(), "t", "b", status).run();
const review = (contentId: string, decision: string, created = "") =>
  created
    ? db().prepare("INSERT INTO reviews(id,content_id,reviewer_id,role,decision,note,created_at) VALUES(?,?,?,?,?,?,?)").bind(crypto.randomUUID(), contentId, "r1", "REVIEWER", decision, "a note of ten chars", created).run()
    : db().prepare("INSERT INTO reviews(id,content_id,reviewer_id,role,decision,note) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(), contentId, "r1", "REVIEWER", decision, "a note of ten chars").run();
const report = (created = "") =>
  created
    ? db().prepare("INSERT INTO audit_events(id,actor_id,action,target_id,created_at) VALUES(?,?,?,?,?)").bind(crypto.randomUUID(), "u1", "CORRECTION_REPORT", "x", created).run()
    : db().prepare("INSERT INTO audit_events(id,actor_id,action,target_id) VALUES(?,?,?,?)").bind(crypto.randomUUID(), "u1", "CORRECTION_REPORT", "x").run();
const decision = (j: { reviews: { byDecision: { decision: string; total: number; last7Days: number; last30Days: number }[] } }, d: string) =>
  j.reviews.byDecision.find((x) => x.decision === d)!;

describe("GET /api/admin/editorial access", () => {
  it("is refused with no session, for a learner and for staff without verified MFA", async () => {
    expect((await get()).status).toBe(403);
    await signIn("learner");
    expect((await get()).status).toBe(403);
    await signInUnverified("reviewer");
    expect([401, 403]).toContain((await get()).status);
    await signInUnverified("admin");
    expect([401, 403]).toContain((await get()).status);
  });
  it("answers a reviewer and an admin, with no-store", async () => {
    for (const role of ["reviewer", "admin"] as const) {
      await signIn(role);
      const res = await get();
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    }
  });
});

describe("counts", () => {
  it("an empty database gives zeros, and publication is off", async () => {
    await signIn("reviewer");
    const j = await (await get()).json();
    expect(j.content).toEqual({ byStatus: [], imported: 0, available: archiveRows.length });
    for (const d of j.reviews.byDecision) expect(d).toMatchObject({ total: 0, last7Days: 0, last30Days: 0 });
    expect(j.reviews.reviewedItems).toBe(0);
    expect(j.corrections).toEqual({ total: 0, last7Days: 0, oldestAgeDays: null, statusField: false });
    expect(j.infographics).toEqual({ queue: visualQueue.length, withDecision: 0 });
    expect(j.publication).toEqual({ enabled: false, released: 0 });
  });
  it("counts equal the seeded rows, by status and by decision", async () => {
    await signIn("admin");
    await item("C1", "NEEDS_SOURCE");
    await item("C2", "NEEDS_SOURCE");
    await item("C3", "IMPORTED");
    await review("C1", "APPROVE");
    await review("C1", "REQUEST_CHANGES");
    await review("C2", "REJECT", "2020-01-01 00:00:00");
    const j = await (await get()).json();
    expect(j.content.byStatus).toEqual([{ status: "IMPORTED", count: 1 }, { status: "NEEDS_SOURCE", count: 2 }]);
    expect(j.content.imported).toBe(3);
    expect(decision(j, "APPROVE")).toEqual({ decision: "APPROVE", total: 1, last7Days: 1, last30Days: 1 });
    expect(decision(j, "REQUEST_CHANGES")).toMatchObject({ total: 1, last7Days: 1 });
    expect(decision(j, "REJECT")).toEqual({ decision: "REJECT", total: 1, last7Days: 0, last30Days: 0 });
    expect(j.reviews.reviewedItems).toBe(2);
  });
  it("one more review changes the counts by exactly one", async () => {
    await signIn("reviewer");
    await item("C1", "NEEDS_SOURCE");
    const before = await (await get()).json();
    await review("C1", "APPROVE");
    const after = await (await get()).json();
    expect(decision(after, "APPROVE").total - decision(before, "APPROVE").total).toBe(1);
    expect(decision(after, "APPROVE").last7Days - decision(before, "APPROVE").last7Days).toBe(1);
    expect(after.reviews.reviewedItems - before.reviews.reviewedItems).toBe(1);
    expect(decision(after, "REJECT").total).toBe(decision(before, "REJECT").total);
  });
  it("correction reports: total, last 7 days and the age of the oldest one", async () => {
    await signIn("reviewer");
    await report();
    await report("2020-01-01 00:00:00");
    const j = await (await get()).json();
    expect(j.corrections.total).toBe(2);
    expect(j.corrections.last7Days).toBe(1);
    expect(j.corrections.oldestAgeDays).toBeGreaterThan(365);
  });
  it("infographics: only reviews of queued items count, each item once", async () => {
    await signIn("reviewer");
    const [a, b] = visualQueue;
    await review(a.id, "APPROVE");
    await review(a.id, "REJECT");
    await review(b.id, "REQUEST_CHANGES");
    await review("NOT-IN-QUEUE", "APPROVE");
    const j = await (await get()).json();
    expect(j.infographics.withDecision).toBe(2);
    expect(j.reviews.reviewedItems).toBe(3);
  });
  it("other audit actions are not counted as correction reports", async () => {
    await signIn("reviewer");
    await db().prepare("INSERT INTO audit_events(id,actor_id,action,target_id) VALUES(?,?,?,?)").bind("x1", "u", "ROLE_CHANGED", "t").run();
    expect((await (await get()).json()).corrections.total).toBe(0);
  });
});
