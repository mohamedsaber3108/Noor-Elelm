import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("vinext/server/fetch-handler", () => ({ default: { fetch: async () => new Response("ok") } }));
vi.mock("../lib/connector-context", () => ({ runWithConnectorBinding: (_b: unknown, fn: () => unknown) => fn() }));

afterEach(() => vi.unstubAllEnvs());

async function run(dev: boolean, env: Record<string, unknown> = {}) {
  vi.stubEnv("DEV", dev);
  const { default: worker } = await import("../worker/index");
  const res = await (worker as unknown as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> })
    .fetch(new Request("https://site.test/"), env, { props: {} });
  return res.headers;
}

describe("worker security headers", () => {
  it("production sets the existing headers and CSP in report-only mode by default", async () => {
    const h = await run(false);
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(h.get("content-security-policy")).toBeNull();
    const csp = h.get("content-security-policy-report-only")!;
    for (const d of ["default-src 'self'", "frame-ancestors 'self'", "base-uri 'self'", "form-action 'self'", "object-src 'none'", "connect-src 'self'", "img-src 'self' data:"]) {
      expect(csp).toContain(d);
    }
    expect(csp).toContain("font-src 'self' https://fonts.gstatic.com");
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
  });
  it("CSP_MODE=enforce switches to the enforcing header", async () => {
    const h = await run(false, { CSP_MODE: "enforce" });
    expect(h.get("content-security-policy")).toContain("default-src 'self'");
    expect(h.get("content-security-policy-report-only")).toBeNull();
  });
  it("any other CSP_MODE value stays report-only", async () => {
    const h = await run(false, { CSP_MODE: "on" });
    expect(h.get("content-security-policy")).toBeNull();
    expect(h.get("content-security-policy-report-only")).not.toBeNull();
  });
  it("development adds no headers", async () => {
    const h = await run(true, { CSP_MODE: "enforce" });
    expect(h.get("content-security-policy")).toBeNull();
    expect(h.get("content-security-policy-report-only")).toBeNull();
    expect(h.get("x-frame-options")).toBeNull();
  });
});
