import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(process.cwd(), "app", "api");
const routes = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? routes(join(dir, e.name)) : e.name === "route.ts" ? [join(dir, e.name)] : [],
  );
// `export function POST`, `export async function POST` and `export const POST =`
const writes = /export\s+(?:async\s+function|function|const)\s+(POST|PUT|PATCH|DELETE)\b/g;
// `export { POST }` has no body to read here, so it is reported instead of passed.
const reexport = /export\s*\{[^}]*\b(?:POST|PUT|PATCH|DELETE)\b/;
// Work that must come after the origin check: reading the body or writing to the database.
// shortcut: `env.DB` is not listed, older routes read it for a 503 check before sameOrigin (no write); upgrade to a call-the-handler test if that changes.
const afterCheck = /\.json\(\)|\.prepare\(|\.batch\(/;

describe("same-origin guard", () => {
  it("every API write handler calls sameOrigin before it reads the body or touches the database (health excepted)", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of routes(root)) {
      if (/[\\/]health[\\/]route\.ts$/.test(file)) continue;
      const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
      const name = file.slice(root.length);
      if (reexport.test(src)) missing.push(`${name} (export { ... } is not supported by this check)`);
      const found = [...src.matchAll(writes)];
      for (const [i, m] of found.entries()) {
        checked++;
        const body = src.slice(m.index, found[i + 1]?.index ?? src.length);
        const guard = body.search(/\bsameOrigin\(/);
        const first = body.search(afterCheck);
        if (guard < 0 || (first >= 0 && guard > first)) missing.push(`${name} (${m[1]}: sameOrigin missing or too late)`);
      }
    }
    expect(checked).toBeGreaterThan(10);
    expect(missing).toEqual([]);
  });
});
