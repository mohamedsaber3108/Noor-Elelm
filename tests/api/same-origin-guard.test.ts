import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(process.cwd(), "app", "api");
const routes = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? routes(join(dir, e.name)) : e.name === "route.ts" ? [join(dir, e.name)] : [],
  );
const writes = /export\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/g;

describe("same-origin guard", () => {
  it("every API route that exports a write method calls sameOrigin (health excepted)", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of routes(root)) {
      if (/[\\/]health[\\/]route\.ts$/.test(file)) continue;
      const src = readFileSync(file, "utf8");
      const methods = [...src.matchAll(writes)].map((m) => m[1]);
      if (!methods.length) continue;
      checked++;
      // one call per exported write handler
      const calls = (src.match(/\bsameOrigin\(/g) ?? []).length;
      if (calls < methods.length) missing.push(`${file.slice(root.length)} (${methods.join(",")}: ${calls} call(s))`);
    }
    expect(checked).toBeGreaterThan(5);
    expect(missing).toEqual([]);
  });
});
