import { beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { D1Stub, newDb } from "./d1";
import { clearCookies } from "./mocks/next-headers";
import { setTestOutbox } from "@/lib/mail";

// Fresh migrated database and no cookies before every test.
beforeEach(() => {
  env.DB = new D1Stub(newDb()) as unknown as D1Database;
  delete (env as unknown as Record<string, unknown>).REVIEWER_IDS;
  delete (env as unknown as Record<string, unknown>).REGISTRATION_MODE;
  delete (env as unknown as Record<string, unknown>).REGISTRATION_ALLOWLIST;
  delete (env as unknown as Record<string, unknown>).MFA_SECRET_KEY;
  delete (env as unknown as Record<string, unknown>).STAFF_IDLE_MINUTES;
  delete (env as unknown as Record<string, unknown>).STAFF_ABSOLUTE_HOURS;
  for (const k of ["MAIL_PROVIDER", "MAIL_FROM", "MAIL_LINK_BASE"]) delete (env as unknown as Record<string, unknown>)[k];
  setTestOutbox(null);
  clearCookies();
});
