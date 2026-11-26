import { describe, expect, it } from "vitest";
import { SESSION_COOKIE, isHttps, sameOrigin } from "@/app/auth";

type H = Record<string, string>;
const req = (headers: H, url = "http://localhost:3000/api/x") => new Request(url, { method: "POST", headers });
const COOKIE = { cookie: `a=b; ${SESSION_COOKIE}=tok` };

describe("isHttps (shared by sameOrigin and the cookie Secure flag)", () => {
  const u = "http://127.0.0.1:3000/api/x";
  it("reads the URL and the first x-forwarded-proto value", () => {
    expect(isHttps(req({}, "https://site.test/api/x"))).toBe(true);
    expect(isHttps(req({}, u))).toBe(false);
    expect(isHttps(req({ "x-forwarded-proto": "https" }, u))).toBe(true);
    expect(isHttps(req({ "x-forwarded-proto": "http" }, u))).toBe(false);
  });
  it("tolerates a comma list: 'https, http' is https, 'http, https' is not", () => {
    expect(isHttps(req({ "x-forwarded-proto": "https, http" }, u))).toBe(true);
    expect(isHttps(req({ "x-forwarded-proto": "http, https" }, u))).toBe(false);
    expect(sameOrigin(req({ host: "site.test", "x-forwarded-proto": "https, http", origin: "https://site.test" }, u))).toBe(true);
  });
});

describe("sameOrigin: Origin present", () => {
  it("accepts the same scheme and host", () => {
    expect(sameOrigin(req({ origin: "http://localhost:3000" }))).toBe(true);
    expect(sameOrigin(req({ origin: "https://site.test" }, "https://site.test/api/x"))).toBe(true);
  });
  it("refuses another host and Origin: null", () => {
    expect(sameOrigin(req({ origin: "https://evil.example" }))).toBe(false);
    expect(sameOrigin(req({ origin: "null" }))).toBe(false);
  });
  it("refuses http Origin for an https request", () => {
    expect(sameOrigin(req({ origin: "http://site.test" }, "https://site.test/api/x"))).toBe(false);
  });
  it("behind the proxy the scheme comes from x-forwarded-proto", () => {
    const h = { host: "site.test", "x-forwarded-proto": "https" };
    expect(sameOrigin(req({ ...h, origin: "https://site.test" }, "http://127.0.0.1:3000/api/x"))).toBe(true);
    expect(sameOrigin(req({ ...h, origin: "http://site.test" }, "http://127.0.0.1:3000/api/x"))).toBe(false);
  });
  it("ignores Sec-Fetch-Site and the cookie when Origin matches", () => {
    expect(sameOrigin(req({ origin: "http://localhost:3000", "sec-fetch-site": "same-origin", ...COOKIE }))).toBe(true);
  });
});

describe("sameOrigin: Origin missing", () => {
  const cases: [string | undefined, boolean, boolean][] = [
    // [Sec-Fetch-Site, cookie, allowed]
    ["same-origin", false, true],
    ["same-origin", true, true],
    ["none", false, true],
    ["none", true, true],
    ["cross-site", false, false],
    ["cross-site", true, false],
    ["same-site", false, false],
    ["same-site", true, false],
    [undefined, false, true],
    [undefined, true, false],
  ];
  it.each(cases)("Sec-Fetch-Site=%s cookie=%s -> %s", (site, cookie, allowed) => {
    const h: H = { ...(site ? { "sec-fetch-site": site } : {}), ...(cookie ? COOKIE : {}) };
    expect(sameOrigin(req(h))).toBe(allowed);
  });
  it("another cookie name does not count as a session", () => {
    expect(sameOrigin(req({ cookie: `x${SESSION_COOKIE}=1; theme=dark` }))).toBe(true);
  });
});
