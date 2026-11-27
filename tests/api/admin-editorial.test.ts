import { describe, expect, it } from "vitest";
import { GET as contentGet, PUT as contentPut } from "@/app/api/admin/content/route";
import { GET as importGet, POST as importPost } from "@/app/api/admin/import/route";
import { GET as reviewGet, POST as reviewPost } from "@/app/api/admin/review/route";
import { GET as queueGet } from "@/app/api/admin/visual-queue/route";
import summaries from "@/data/archive-summaries.json";
import { setEnv, call, count, db, signIn, verifySessions, EVIL } from "../helpers";

const ID = (summaries as { id: string }[])[0].id;
const req = (m: string, p: string, b?: unknown, o = {}) => call(m, p, b, o);

// Every handler under /api/admin/{content,import,review,visual-queue}, called with a minimal valid request.
const handlers: [string, () => Promise<Response>][] = [
  ["GET content", () => contentGet(req("GET", `/api/admin/content?id=${ID}`) as never)],
  ["PUT content", () => contentPut(req("PUT", "/api/admin/content", { id: ID, title: "t", body: "b", revision: 1 }) as never)],
  ["GET import", () => importGet()],
  ["POST import", () => importPost(req("POST", "/api/admin/import", { offset: 0, limit: 1 }) as never)],
  ["GET review", () => reviewGet(req("GET", "/api/admin/review") as never)],
  ["POST review", () => reviewPost(req("POST", "/api/admin/review", { contentId: ID, decision: "APPROVE", note: "long enough note" }) as never)],
  ["GET visual-queue", () => queueGet()],
];

describe("admin editorial routes: access control", () => {
  it.each(handlers)("%s returns 403 REVIEWER_ACCESS_REQUIRED with no session", async (_n, run) => {
    const res = await run();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("REVIEWER_ACCESS_REQUIRED");
  });
  it.each(handlers)("%s returns 403 for a learner", async (_n, run) => {
    await signIn("learner");
    expect((await run()).status).toBe(403);
  });
  it.each(handlers)("%s is allowed for a reviewer (status is not 403)", async (_n, run) => {
    await signIn("reviewer");
    expect((await run()).status).not.toBe(403);
  });
  it.each(handlers)("%s is allowed for an admin (status is not 403)", async (_n, run) => {
    await signIn("admin");
    expect((await run()).status).not.toBe(403);
  });
  it("a learner listed in REVIEWER_IDS passes the reviewer check (known gap, see N-15)", async () => {
    const u = await signIn("learner");
    setEnv("REVIEWER_IDS", u.id);
    await verifySessions(u.id);
    expect((await importGet()).status).toBe(200);
  });
});

describe("/api/admin/import", () => {
  it("GET reports stored and available counts", async () => {
    await signIn("reviewer");
    const j = await (await importGet()).json();
    expect(j).toMatchObject({ stored: 0, publication: "NONE" });
    expect(j.available).toBeGreaterThan(3000);
  });
  it("POST imports a batch as NEEDS_SOURCE drafts and is idempotent", async () => {
    await signIn("reviewer");
    const r1 = await (await importPost(req("POST", "/api/admin/import", { offset: 0, limit: 5 }) as never)).json();
    expect(r1).toMatchObject({ insertedThrough: 5, stored: 5 });
    const r2 = await (await importPost(req("POST", "/api/admin/import", { offset: 0, limit: 5 }) as never)).json();
    expect(r2.stored).toBe(5);
    expect(await count("SELECT COUNT(*) AS n FROM content_items WHERE status='NEEDS_SOURCE' AND revision=1")).toBe(5);
  });
  it("POST returns 400 INVALID_BATCH for bad offset or limit, and BAD_JSON for broken JSON", async () => {
    await signIn("reviewer");
    for (const bad of [{}, { offset: -1, limit: 5 }, { offset: 0, limit: 0 }, { offset: 0, limit: 41 }, { offset: 1.5, limit: 5 }, { offset: 999999, limit: 5 }]) {
      expect((await importPost(req("POST", "/api/admin/import", bad) as never)).status).toBe(400);
    }
    expect((await importPost(req("POST", "/api/admin/import", "{bad") as never)).status).toBe(400);
  });
  it("refuses a cross-origin POST with 403 BAD_ORIGIN", async () => {
    await signIn("reviewer");
    const res = await importPost(req("POST", "/api/admin/import", { offset: 0, limit: 1 }, EVIL) as never);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("BAD_ORIGIN");
    expect(await count("SELECT COUNT(*) AS n FROM content_items")).toBe(0);
  });
});

describe("/api/admin/content", () => {
  const seed = async () => {
    await signIn("reviewer");
    await importPost(req("POST", "/api/admin/import", { offset: 0, limit: 1 }) as never);
    return (await db().prepare("SELECT id FROM content_items").first<{ id: string }>())!.id;
  };
  it("GET requires id (400), returns 404 NOT_IMPORTED, then the item with revisions", async () => {
    const id = await seed();
    expect((await contentGet(req("GET", "/api/admin/content") as never)).status).toBe(400);
    expect((await contentGet(req("GET", "/api/admin/content?id=NOPE") as never)).status).toBe(404);
    const j = await (await contentGet(req("GET", `/api/admin/content?id=${id}`) as never)).json();
    expect(j.item.id).toBe(id);
    expect(j.revisions).toEqual([]);
  });
  it("PUT edits, bumps the revision, keeps the old one, and writes a CONTENT_EDIT audit row", async () => {
    const id = await seed();
    const res = await contentPut(req("PUT", "/api/admin/content", { id, title: "New title", body: "New body", revision: 1 }) as never);
    expect(await res.json()).toMatchObject({ revision: 2, status: "NEEDS_SOURCE", publication: "NONE" });
    expect(await count("SELECT COUNT(*) AS n FROM content_revisions WHERE content_id=? AND revision=1", id)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='CONTENT_EDIT' AND target_id=?", id)).toBe(1);
  });
  it("PUT restores an older revision", async () => {
    const id = await seed();
    const before = (await db().prepare("SELECT title FROM content_items WHERE id=?").bind(id).first<{ title: string }>())!.title;
    await contentPut(req("PUT", "/api/admin/content", { id, title: "Edited", body: "Edited body", revision: 1 }) as never);
    const res = await contentPut(req("PUT", "/api/admin/content", { id, revision: 2, restoreRevision: 1 }) as never);
    expect(res.status).toBe(200);
    expect((await db().prepare("SELECT title FROM content_items WHERE id=?").bind(id).first<{ title: string }>())!.title).toBe(before);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='CONTENT_RESTORE'")).toBe(1);
  });
  it("PUT returns 409 REVISION_CONFLICT for a stale revision and changes nothing", async () => {
    const id = await seed();
    const res = await contentPut(req("PUT", "/api/admin/content", { id, title: "x", body: "y", revision: 7 }) as never);
    expect(res.status).toBe(409);
    expect((await res.json()).current).toBe(1);
  });
  it("PUT returns 400 for bad input, 404 for an unknown id or revision", async () => {
    const id = await seed();
    const put = (b: unknown) => contentPut(req("PUT", "/api/admin/content", b) as never);
    expect((await put({})).status).toBe(400);
    expect((await put({ id, title: "x", body: "y", revision: "1" })).status).toBe(400);
    expect((await put({ id, title: "", body: "y", revision: 1 })).status).toBe(400);
    expect((await put({ id, title: "x".repeat(301), body: "y", revision: 1 })).status).toBe(400);
    expect((await put({ id, title: "x", body: "y".repeat(20001), revision: 1 })).status).toBe(400);
    expect((await put({ id: "NOPE", title: "x", body: "y", revision: 1 })).status).toBe(404);
    expect((await put({ id, revision: 1, restoreRevision: 99 })).status).toBe(404);
    expect((await contentPut(req("PUT", "/api/admin/content", "{bad") as never)).status).toBe(400);
  });
  it("refuses a cross-origin PUT with 403 BAD_ORIGIN", async () => {
    const id = await seed();
    const res = await contentPut(req("PUT", "/api/admin/content", { id, title: "x", body: "y", revision: 1 }, EVIL) as never);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("BAD_ORIGIN");
    expect(await count("SELECT COUNT(*) AS n FROM content_revisions")).toBe(0);
  });
});

describe("/api/admin/review", () => {
  const good = { contentId: ID, decision: "APPROVE", note: "Checked against the source." };
  it("POST records the review and writes a CONTENT_REVIEW audit row; GET lists it", async () => {
    const u = await signIn("reviewer");
    const res = await reviewPost(req("POST", "/api/admin/review", good) as never);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("RECORDED_PENDING_EDITORIAL_RELEASE");
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE action='CONTENT_REVIEW' AND actor_id=?", u.id)).toBe(1);
    const j = await (await reviewGet(req("GET", `/api/admin/review?contentId=${ID}`) as never)).json();
    expect(j.reviews).toHaveLength(1);
    expect(j.publication).toBe("DISABLED_PENDING_SEPARATE_EDITORIAL_RELEASE");
  });
  it("POST returns 400 for bad decision, short or long note, unknown content, or broken JSON", async () => {
    await signIn("reviewer");
    const post = (b: unknown) => reviewPost(req("POST", "/api/admin/review", b) as never);
    expect((await post({ ...good, decision: "PUBLISH" })).status).toBe(400);
    expect((await post({ ...good, note: "short" })).status).toBe(400);
    expect((await post({ ...good, note: "x".repeat(4001) })).status).toBe(400);
    expect((await post({ ...good, contentId: "NOPE" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await reviewPost(req("POST", "/api/admin/review", "{bad") as never)).status).toBe(400);
    expect(await count("SELECT COUNT(*) AS n FROM reviews")).toBe(0);
  });
  it("GET returns 404 UNKNOWN_CONTENT for an unknown contentId", async () => {
    await signIn("reviewer");
    expect((await reviewGet(req("GET", "/api/admin/review?contentId=NOPE") as never)).status).toBe(404);
  });
  it.fails("BUG: reviews.role is always the literal REVIEWER, even for an admin", async () => {
    await signIn("admin");
    await reviewPost(req("POST", "/api/admin/review", good) as never);
    expect((await db().prepare("SELECT role FROM reviews").first<{ role: string }>())?.role).toBe("admin");
  });
  it("refuses a cross-origin POST with 403 BAD_ORIGIN", async () => {
    await signIn("reviewer");
    const res = await reviewPost(req("POST", "/api/admin/review", good, EVIL) as never);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("BAD_ORIGIN");
    expect(await count("SELECT COUNT(*) AS n FROM reviews")).toBe(0);
  });
});

describe("GET /api/admin/visual-queue", () => {
  it("returns the 200 queued infographic candidates with the latest review", async () => {
    await signIn("reviewer");
    const first = (await (await queueGet()).json()).rows[0].id;
    await db().prepare("INSERT INTO reviews(id,content_id,reviewer_id,role,decision,note) VALUES('r1',?,'u','REVIEWER','REJECT','needs a better source')").bind(first).run();
    const j = await (await queueGet()).json();
    expect(j.total).toBe(200);
    expect(j.rows[0].review.decision).toBe("REJECT");
    expect(j.publication).toBe("DISABLED_PENDING_SEPARATE_EDITORIAL_RELEASE");
  });
});
