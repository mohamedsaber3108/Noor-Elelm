import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source check (no browser runner here): no button, link, hint or aria-label may join Arabic and English with " / ".
// A screen reader would read the English with the Arabic voice. Use the <B> component (two spans with lang) instead.
const src = readFileSync(new URL("../components/reset-pages.tsx", import.meta.url), "utf8");

describe("reset pages: bilingual labels", () => {
  it("has no slash-joined text in string literals or JSX text", () => {
    const hits = src.split("\n").filter(l => /[\u0600-\u06FF][^<>{}'"`]* \/ [A-Za-z]/.test(l));
    expect(hits).toEqual([]);
  });
  it("has no ' / ' inside any aria-label", () => {
    const labels = [...src.matchAll(/aria-label=(?:"([^"]*)"|\{([^}]*)\})/g)].map(m => m[1] ?? m[2]);
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(l).not.toContain(" / ");
  });
});
