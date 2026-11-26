import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { GET as health } from "@/app/api/health/route";
import { GET as me } from "@/app/api/me/route";
import { db, signIn } from "../helpers";

describe("GET /api/health", () => {
  it("returns ok when the database answers", async () => {
    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "ok" });
  });
  it("returns 503 when the database is not bound", async () => {
    env.DB = undefined;
    const res = await health();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "degraded", db: "unbound" });
  });
  it("returns 503 when the database query fails", async () => {
    env.DB = { prepare: () => { throw new Error("boom"); } };
    const res = await health();
    expect(res.status).toBe(503);
    expect((await res.json()).db).toBe("error");
  });
});

describe("GET /api/me", () => {
  it("returns 401 without a session", async () => {
    expect((await me()).status).toBe(401);
  });
  it("returns 503 when the database is not bound", async () => {
    env.DB = undefined;
    expect((await me()).status).toBe(503);
  });
  it("returns name, coins and the three challenges for a signed-in user", async () => {
    const u = await signIn("learner");
    await db().prepare("INSERT INTO point_ledger(id,user_id,question_id,kind,delta,attempt_id) VALUES('l1',?,'t01','FIRST_CORRECT',1,'a1')").bind(u.id).run();
    await db().prepare("INSERT INTO quiz_attempts(id,user_id,question_id,answer_key,correct) VALUES('a1',?,'t01','a',1)").bind(u.id).run();
    const res = await me();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.coins).toBe(1);
    expect(j.correct).toBe(1);
    expect(j.challenges.map((c: { key: string }) => c.key)).toEqual(["daily", "weekly", "monthly"]);
  });
  it("works for every role (no role restriction)", async () => {
    await signIn("admin");
    expect((await me()).status).toBe(200);
  });
});
