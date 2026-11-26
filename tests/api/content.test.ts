import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { GET as archive } from "@/app/api/archive/route";
import { GET as ucGet, POST as ucPost } from "@/app/api/user-content/route";
import { GET as corrGet, POST as corrPost } from "@/app/api/corrections/route";
import summaries from "@/data/archive-summaries.json";
import { setEnv, call, count, signIn, verifySessions, EVIL } from "../helpers";

const ID = (summaries as { id: string }[])[0].id;

describe("GET /api/archive", () => {
  it("lists records without sign-in, 24 per page, without the draft text", async () => {
    const j = await (await archive(call("GET", "/api/archive"))).json();
    expect(j.results).toHaveLength(24);
    expect(j.total).toBeGreaterThan(3000);
    expect(JSON.stringify(j.results[0])).not.toContain('"text"');
  });
  it("filters by search text, type and world, and clamps a bad page to 1", async () => {
    const all = await (await archive(call("GET", "/api/archive"))).json();
    const bad = await (await archive(call("GET", "/api/archive?page=abc"))).json();
    expect(bad.page).toBe(1);
    const none = await (await archive(call("GET", "/api/archive?q=" + encodeURIComponent("zzzz-no-such-title")))).json();
    expect(none.total).toBe(0);
    const typed = await (await archive(call("GET", "/api/archive?type=citation_candidate"))).json();
    expect(typed.total).toBeLessThan(all.total);
    expect(typed.results.every((r: { type: string }) => r.type === "citation_candidate")).toBe(true);
  });
  it("returns 404 for an unknown id", async () => {
    expect((await archive(call("GET", "/api/archive?id=NOPE"))).status).toBe(404);
  });
  it("hides the draft text from anonymous visitors and learners", async () => {
    const anon = await (await archive(call("GET", `/api/archive?id=${ID}`))).json();
    expect(anon).toMatchObject({ text: null, restricted: true });
    await signIn("learner");
    const learner = await (await archive(call("GET", `/api/archive?id=${ID}`))).json();
    expect(learner).toMatchObject({ text: null, restricted: true });
  });
  it("shows the draft text to a reviewer and to an admin", async () => {
    await signIn("reviewer");
    const j = await (await archive(call("GET", `/api/archive?id=${ID}`))).json();
    expect(j.restricted).toBe(false);
    expect(typeof j.text).toBe("string");
    await signIn("admin");
    expect((await (await archive(call("GET", `/api/archive?id=${ID}`))).json()).restricted).toBe(false);
  });
  it("lets a user listed in REVIEWER_IDS read the text (known gap: env path, see N-15)", async () => {
    const u = await signIn("learner");
    setEnv("REVIEWER_IDS", `x, ${u.id}`);
    await verifySessions(u.id);
    expect((await (await archive(call("GET", `/api/archive?id=${ID}`))).json()).restricted).toBe(false);
  });
});

describe("/api/user-content", () => {
  it("GET returns 401 without a session", async () => {
    expect((await ucGet()).status).toBe(401);
  });
  it("POST returns 401 without a session", async () => {
    expect((await ucPost(call("POST", "/api/user-content", { id: ID, action: "bookmark" }))).status).toBe(401);
  });
  it("bookmarks, marks as read, lists, and unbookmarks", async () => {
    await signIn("learner");
    expect((await ucPost(call("POST", "/api/user-content", { id: ID, action: "bookmark" }))).status).toBe(200);
    expect((await ucPost(call("POST", "/api/user-content", { id: ID, action: "bookmark" }))).status).toBe(200); // idempotent
    expect((await ucPost(call("POST", "/api/user-content", { id: ID, action: "read" }))).status).toBe(200);
    const j = await (await ucGet()).json();
    expect(j.bookmarks).toEqual([ID]);
    expect(j.read).toEqual([ID]);
    expect(j.bookmarkItems[0].id).toBe(ID);
    await ucPost(call("POST", "/api/user-content", { id: ID, action: "unbookmark" }));
    expect((await (await ucGet()).json()).bookmarks).toEqual([]);
  });
  it("keeps each user's bookmarks private", async () => {
    await signIn("learner");
    await ucPost(call("POST", "/api/user-content", { id: ID, action: "bookmark" }));
    await signIn("learner");
    expect((await (await ucGet()).json()).bookmarks).toEqual([]);
  });
  it("returns 400 for unknown ids, unknown actions, and broken JSON", async () => {
    await signIn("learner");
    expect((await ucPost(call("POST", "/api/user-content", { id: "NOPE", action: "bookmark" }))).status).toBe(400);
    expect((await ucPost(call("POST", "/api/user-content", { id: ID, action: "delete" }))).status).toBe(400);
    expect((await ucPost(call("POST", "/api/user-content", "{bad"))).status).toBe(400);
  });
  it("returns 401 when the database is not bound (the session lookup fails first)", async () => {
    env.DB = undefined;
    expect((await ucGet()).status).toBe(401);
  });
  it.fails("BUG: a cross-origin POST should be refused with 403 BAD_ORIGIN (route has no sameOrigin check)", async () => {
    await signIn("learner");
    expect((await ucPost(call("POST", "/api/user-content", { id: ID, action: "bookmark" }, EVIL))).status).toBe(403);
  });
});

describe("/api/corrections", () => {
  const good = { contentId: ID, message: "The text of this record has a mistake in the date." };
  it("POST returns 401 without a session", async () => {
    expect((await corrPost(call("POST", "/api/corrections", good))).status).toBe(401);
  });
  it("POST stores a report as an audit row for a learner", async () => {
    const u = await signIn("learner");
    const res = await corrPost(call("POST", "/api/corrections", { ...good, sourceUrl: "https://example.test/a" }));
    expect(res.status).toBe(201);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='CORRECTION_REPORT' AND actor_id=?", u.id)).toBe(1);
  });
  it("POST returns 400 for bad input", async () => {
    await signIn("learner");
    for (const bad of [
      { ...good, contentId: "NOPE" },
      { ...good, message: "too short" },
      { ...good, message: "x".repeat(2001) },
      { ...good, sourceUrl: "x".repeat(501) },
    ]) expect((await corrPost(call("POST", "/api/corrections", bad))).status).toBe(400);
    expect((await corrPost(call("POST", "/api/corrections", { ...good, sourceUrl: "ftp://example.test/a" }))).status).toBe(400);
    expect((await corrPost(call("POST", "/api/corrections", { ...good, sourceUrl: "not a url" }))).status).toBe(400);
    expect((await corrPost(call("POST", "/api/corrections", "{bad"))).status).toBe(400);
  });
  it("POST returns 429 DAILY_LIMIT after 5 reports in a day", async () => {
    await signIn("learner");
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await corrPost(call("POST", "/api/corrections", good))).status);
    expect(codes).toEqual([201, 201, 201, 201, 201, 429]);
  });
  it("GET returns 403 without a session and for a learner", async () => {
    expect((await corrGet()).status).toBe(403);
    await signIn("learner");
    expect((await corrGet()).status).toBe(403);
  });
  it("GET lists reports for a reviewer and for an admin", async () => {
    await signIn("learner");
    await corrPost(call("POST", "/api/corrections", good));
    await signIn("reviewer");
    expect((await (await corrGet()).json()).reports).toHaveLength(1);
    await signIn("admin");
    expect((await corrGet()).status).toBe(200);
  });
  it.fails("BUG: a cross-origin POST should be refused with 403 BAD_ORIGIN (route has no sameOrigin check)", async () => {
    await signIn("learner");
    expect((await corrPost(call("POST", "/api/corrections", good, EVIL))).status).toBe(403);
  });
});
