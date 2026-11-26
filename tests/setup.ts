import { beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { D1Stub, newDb } from "./d1";
import { clearCookies } from "./mocks/next-headers";

// Fresh migrated database and no cookies before every test.
beforeEach(() => {
  env.DB = new D1Stub(newDb());
  delete env.REVIEWER_IDS;
  clearCookies();
});
