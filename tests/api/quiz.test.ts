import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { GET as next } from "@/app/api/quiz/next/route";
import { POST as answer } from "@/app/api/quiz/answer/route";
import { trialQuestions } from "@/lib/quiz-bank";
import { EVIL, call, count, db, signIn } from "../helpers";

const q = trialQuestions.find((x) => x.id === "t01")!; // choice, correct "a"
const wrongKey = q.options.find((o) => o.key !== q.correct)!.key;

async function serve(userId: string, questionId = q.id) {
  const token = crypto.randomUUID();
  await db().prepare("INSERT INTO quiz_served(token,user_id,question_id,expires_at) VALUES(?,?,?,datetime('now','+15 minutes'))").bind(token, userId, questionId).run();
  return token;
}
const post = (body: unknown) => answer(call("POST", "/api/quiz/answer", body));

describe("GET /api/quiz/next", () => {
  it("returns 401 without a session", async () => {
    expect((await next(call("GET", "/api/quiz/next"))).status).toBe(401);
  });
  it("returns 503 when the database is not bound", async () => {
    env.DB = undefined;
    expect((await next(call("GET", "/api/quiz/next"))).status).toBe(503);
  });
  it("serves a question of the level without the answer, and stores a token", async () => {
    const u = await signIn("learner");
    const res = await next(call("GET", "/api/quiz/next?level=" + encodeURIComponent("سهل")));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.question.level).toBe("سهل");
    expect(j.question).not.toHaveProperty("correct");
    expect(JSON.stringify(j)).not.toContain("explanation");
    expect(await count("SELECT COUNT(*) AS n FROM quiz_served WHERE token=? AND user_id=?", j.token, u.id)).toBe(1);
  });
  it("returns 404 NO_QUESTIONS for an unknown level", async () => {
    await signIn("learner");
    expect((await next(call("GET", "/api/quiz/next?level=nope"))).status).toBe(404);
  });
  it("returns 429 after 120 questions in an hour", async () => {
    const u = await signIn("learner");
    for (let i = 0; i < 120; i++) await serve(u.id);
    expect((await next(call("GET", "/api/quiz/next"))).status).toBe(429);
  });
  it("works for reviewer and admin too (no role restriction)", async () => {
    await signIn("admin");
    expect((await next(call("GET", "/api/quiz/next"))).status).toBe(200);
  });
});

describe("POST /api/quiz/answer", () => {
  it("returns 401 without a session", async () => {
    expect((await post({ questionId: q.id, answerKey: "a", token: crypto.randomUUID() })).status).toBe(401);
  });
  it("refuses a cross-origin POST with 403 BAD_ORIGIN and records nothing", async () => {
    const u = await signIn("learner");
    const res = await answer(call("POST", "/api/quiz/answer", { questionId: q.id, answerKey: q.correct, token: await serve(u.id) }, EVIL));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("BAD_ORIGIN");
    expect(await count("SELECT COUNT(*) AS n FROM quiz_attempts")).toBe(0);
  });
  it("accepts a same-origin POST (Origin equals the request host)", async () => {
    const u = await signIn("learner");
    const res = await answer(call("POST", "/api/quiz/answer", { questionId: q.id, answerKey: q.correct, token: await serve(u.id) }, { origin: new URL(call("GET", "/").url).origin }));
    expect(res.status).toBe(200);
  });
  it("accepts a correct answer, adds 1 coin, and returns the balance", async () => {
    const u = await signIn("learner");
    const res = await post({ questionId: q.id, answerKey: q.correct, token: await serve(u.id) });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ correct: true, balance: 1 });
  });
  it("a wrong answer is recorded and adds no coin", async () => {
    const u = await signIn("learner");
    const j = await (await post({ questionId: q.id, answerKey: wrongKey, token: await serve(u.id) })).json();
    expect(j).toMatchObject({ correct: false, balance: 0 });
    expect(await count("SELECT COUNT(*) AS n FROM quiz_attempts WHERE user_id=?", u.id)).toBe(1);
  });
  it("accepts a correct ordering answer", async () => {
    const o = trialQuestions.find((x) => x.type === "ordering")!;
    const u = await signIn("learner");
    const j = await (await post({ questionId: o.id, answerKey: o.correct, token: await serve(u.id, o.id) })).json();
    expect(j.correct).toBe(true);
  });
  it("returns 400 INVALID_ANSWER for bad input", async () => {
    const u = await signIn("learner");
    const token = await serve(u.id);
    for (const bad of [
      {},
      { questionId: "nope", answerKey: "a", token },
      { questionId: q.id, answerKey: "zzz", token },
      { questionId: q.id, answerKey: "a", token: "not-a-token" },
      { questionId: q.id, answerKey: "a" },
    ]) expect((await post(bad)).status).toBe(400);
    const o = trialQuestions.find((x) => x.type === "ordering")!;
    expect((await post({ questionId: o.id, answerKey: "a,a,b,c", token })).status).toBe(400); // duplicate keys
    expect((await answer(call("POST", "/api/quiz/answer", "{bad"))).status).toBe(400);
  });
  it("returns 409 for a token that was never served, belongs to another user, or is expired", async () => {
    const u = await signIn("learner");
    expect((await post({ questionId: q.id, answerKey: "a", token: crypto.randomUUID() })).status).toBe(409);
    const other = await signIn("learner");
    void other;
    const foreign = await serve(u.id);
    expect((await post({ questionId: q.id, answerKey: "a", token: foreign })).status).toBe(409);
    const expired = crypto.randomUUID();
    await db().prepare("INSERT INTO quiz_served(token,user_id,question_id,expires_at) VALUES(?,?,?,datetime('now','-1 minutes'))").bind(expired, other.id, q.id).run();
    expect((await post({ questionId: q.id, answerKey: "a", token: expired })).status).toBe(409);
  });
  it("returns 429 after 120 attempts in an hour", async () => {
    const u = await signIn("learner");
    const stmts = Array.from({ length: 120 }, (_, i) =>
      db().prepare("INSERT INTO quiz_attempts(id,user_id,question_id,answer_key,correct) VALUES(?,?,?,?,0)").bind(`a${i}`, u.id, q.id, "b"));
    await db().batch(stmts);
    expect((await post({ questionId: q.id, answerKey: "a", token: await serve(u.id) })).status).toBe(429);
  });
});

describe("one coin per question", () => {
  it("12 parallel answers with one token: exactly 1 accepted, 11 rejected", async () => {
    const u = await signIn("learner");
    const token = await serve(u.id);
    const results = await Promise.all(Array.from({ length: 12 }, () => post({ questionId: q.id, answerKey: q.correct, token })));
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(11);
    expect(await count("SELECT COUNT(*) AS n FROM quiz_attempts WHERE user_id=?", u.id)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM point_ledger WHERE user_id=?", u.id)).toBe(1);
  });
  it("replaying the same correct question with a new token adds 0 coins", async () => {
    const u = await signIn("learner");
    const first = await (await post({ questionId: q.id, answerKey: q.correct, token: await serve(u.id) })).json();
    const again = await (await post({ questionId: q.id, answerKey: q.correct, token: await serve(u.id) })).json();
    expect(first.balance).toBe(1);
    expect(again).toMatchObject({ correct: true, balance: 1 });
    expect(await count("SELECT COUNT(*) AS n FROM quiz_attempts WHERE user_id=?", u.id)).toBe(2);
    expect(await count("SELECT COUNT(*) AS n FROM point_ledger WHERE user_id=?", u.id)).toBe(1);
  });
  it("the unique index coin_once_per_question exists", async () => {
    const row = await db().prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='coin_once_per_question'").first();
    expect(row).not.toBeNull();
  });
  it("balance equals the ledger sum after several different questions", async () => {
    const u = await signIn("learner");
    const ids = ["t01", "t02", "t03", "t04"];
    let last = 0;
    for (const id of ids) {
      const qq = trialQuestions.find((x) => x.id === id)!;
      last = (await (await post({ questionId: id, answerKey: qq.correct, token: await serve(u.id, id) })).json()).balance;
    }
    const sum = await count("SELECT COALESCE(SUM(delta),0) AS n FROM point_ledger WHERE user_id=?", u.id);
    expect(last).toBe(4);
    expect(sum).toBe(last);
    const meCoins = (await import("@/app/api/me/route")).GET;
    expect((await (await meCoins()).json()).coins).toBe(sum);
  });
});
