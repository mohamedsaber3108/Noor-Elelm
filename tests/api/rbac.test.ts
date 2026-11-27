import { describe, expect, it } from "vitest";
import { CATALOGUE, ROLES, ROLE_BUNDLES, STAFF_ROLES, can, isStaffRole } from "@/lib/rbac";
import { GET as reviewGet, POST as reviewPost } from "@/app/api/admin/review/route";
import { GET as usersGet, PUT as usersPut } from "@/app/api/admin/users/route";
import { GET as corrGet } from "@/app/api/corrections/route";
import summaries from "@/data/archive-summaries.json";
import { STEP_UP, call, count, db, seedUser, setEnv, signIn, verifySessions } from "../helpers";

const ID = (summaries as { id: string }[])[0].id;
const EDITORIAL = ["researcher", "fact_checker", "language_editor", "scholar", "publisher", "reviewer"] as const;
const good = { contentId: ID, decision: "REQUEST_CHANGES", note: "Source page does not match." };

describe("permission catalogue", () => {
  it("every role has a bundle and every bundle entry is in the catalogue", () => {
    expect(Object.keys(ROLE_BUNDLES).sort()).toEqual([...ROLES].sort());
    for (const r of ROLES) for (const p of ROLE_BUNDLES[r]) expect(CATALOGUE[p]).toBeDefined();
  });
  it("each entry names its resource, action and scope", () => {
    for (const [k, v] of Object.entries(CATALOGUE)) {
      expect(k).toBe(`${v.resource}.${v.action}`);
      expect(v.scope).toBe("all");
    }
  });
  it("learner holds nothing, admin holds everything, editorial roles never manage users, settings or audit", () => {
    expect(ROLE_BUNDLES.learner).toHaveLength(0);
    expect([...ROLE_BUNDLES.admin].sort()).toEqual(Object.keys(CATALOGUE).sort());
    for (const r of EDITORIAL) for (const p of ["users.manage", "settings.manage", "audit.read"] as const) expect(can(r, p)).toBe(false);
  });
  it("staff is every role except learner; unknown or wrong-case roles are not staff", () => {
    expect([...STAFF_ROLES].sort()).toEqual([...EDITORIAL, "admin"].sort());
    expect(isStaffRole("learner")).toBe(false);
    expect(isStaffRole("editor")).toBe(false);
    expect(isStaffRole("ADMIN")).toBe(false);
    expect(can("editor", "review.record")).toBe(false);
  });
});

describe("editorial roles on the real routes", () => {
  it.each(EDITORIAL)("%s records a review and reviews.role stores that role", async (role) => {
    await signIn(role);
    const res = await reviewPost(call("POST", "/api/admin/review", good) as never);
    expect(res.status).toBe(200);
    expect((await db().prepare("SELECT role FROM reviews").first<{ role: string }>())?.role).toBe(role);
    expect((await (await reviewGet(call("GET", "/api/admin/review") as never)).json()).role).toBe(role);
  });
  it.each(EDITORIAL)("%s cannot open /api/admin/users", async (role) => {
    await signIn(role);
    expect((await usersGet(call("GET", "/api/admin/users") as never)).status).toBe(403);
  });
  it("a user row with an unknown role is not staff", async () => {
    const u = await signIn("learner");
    await db().prepare("UPDATE users SET role='editor' WHERE id=?").bind(u.id).run();
    await verifySessions(u.id);
    expect((await corrGet()).status).toBe(403);
  });
});

describe("REVIEWER_IDS is gone", () => {
  it("an id listed in REVIEWER_IDS gets 403 and a denied audit row", async () => {
    const u = await signIn("learner");
    setEnv("REVIEWER_IDS", u.id);
    await verifySessions(u.id);
    expect((await reviewGet(call("GET", "/api/admin/review") as never)).status).toBe(403);
    expect(await count("SELECT COUNT(*) AS n FROM audit_events WHERE actor_id=? AND result='denied'", u.id)).toBe(1);
  });
});

describe("role change uses the catalogue", () => {
  it.each(EDITORIAL)("an admin can set a user to %s", async (role) => {
    await signIn("admin");
    const t = await seedUser("learner");
    expect((await usersPut(call("PUT", "/api/admin/users", { id: t.id, role, ...STEP_UP }))).status).toBe(200);
    expect((await db().prepare("SELECT role FROM users WHERE id=?").bind(t.id).first<{ role: string }>())?.role).toBe(role);
  });
  it("a role outside the catalogue is refused with 400", async () => {
    await signIn("admin");
    const t = await seedUser("learner");
    expect((await usersPut(call("PUT", "/api/admin/users", { id: t.id, role: "editor" }))).status).toBe(400);
  });
});
