import { describe, expect, it } from "vitest";
import { normalizeArabic } from "@/lib/arabic";
import { GET as archive } from "@/app/api/archive/route";
import records from "@/data/archive-records.json";
import { call } from "../helpers";

const all = records as { id: string; title: string; source: string }[];
const search = async (q: string) => (await (await archive(call("GET", `/api/archive?q=${encodeURIComponent(q)}`) as never)).json()) as { results: { id: string }[]; total: number };
/** Adds a fatha after every Arabic letter: the same word, fully voweled. */
const withTashkeel = (w: string) => w.replace(/([\u0621-\u064A])/g, "$1\u064E");

describe("normalizeArabic", () => {
  it("removes tashkeel, tatweel and Quranic marks", () => {
    expect(normalizeArabic("بِسْمِ اللَّهِ")).toBe(normalizeArabic("بسم الله"));
    expect(normalizeArabic("عـــلم")).toBe("علم");
    expect(normalizeArabic("الرَّحْمَٰنِ")).toBe(normalizeArabic("الرحمن"));
  });
  it("folds alef forms, taa marbuta, alef maqsura and hamza seats", () => {
    expect(normalizeArabic("أحمد")).toBe(normalizeArabic("احمد"));
    expect(normalizeArabic("إسلام")).toBe(normalizeArabic("اسلام"));
    expect(normalizeArabic("آية")).toBe(normalizeArabic("ايه"));
    expect(normalizeArabic("ٱلحمد")).toBe(normalizeArabic("الحمد"));
    expect(normalizeArabic("مدرسة")).toBe(normalizeArabic("مدرسه"));
    expect(normalizeArabic("موسى")).toBe(normalizeArabic("موسي"));
    expect(normalizeArabic("مؤمن")).toBe(normalizeArabic("مومن"));
    expect(normalizeArabic("مسائل")).toBe(normalizeArabic("مسايل"));
    expect(normalizeArabic("\u06A9تاب \u06CCوم")).toBe(normalizeArabic("كتاب يوم"));
  });
  it("maps Arabic-Indic digits, drops bidi marks, folds space and Latin case", () => {
    expect(normalizeArabic("سورة ١١٤")).toBe(normalizeArabic("سوره 114"));
    expect(normalizeArabic("a\u200Fb\u061Cc\u2066d\u2069")).toBe("abcd");
    expect(normalizeArabic("  Quran   Tafsir ")).toBe("quran tafsir");
  });
  it("is idempotent", () => {
    const s = "قَالَ أَبُو هُرَيْرَةَ ١٢";
    expect(normalizeArabic(normalizeArabic(s))).toBe(normalizeArabic(s));
  });
});

describe("GET /api/archive search with and without tashkeel", () => {
  // 30 fixed queries: the first Arabic word of 3 or more letters from the first records that have one.
  const queries = all
    .map((r) => r.title.split(/\s+/).find((w) => /^[\u0621-\u064A]{3,}$/.test(w)))
    .filter((w): w is string => Boolean(w))
    .filter((w, i, a) => a.indexOf(w) === i)
    .slice(0, 30);
  it("has 30 queries to test", () => {
    expect(queries).toHaveLength(30);
  });
  it.each(queries)("%s gives the same results bare and fully voweled", async (w) => {
    const bare = await search(w), voweled = await search(withTashkeel(w));
    expect(bare.total).toBeGreaterThan(0);
    expect(voweled.total).toBe(bare.total);
    expect(voweled.results.map((r) => r.id)).toEqual(bare.results.map((r) => r.id));
  });
  it("a hamza-seat variant finds the same records", async () => {
    const w = queries.find((x) => /[أإآ]/.test(x));
    if (!w) return;
    const bare = await search(w.replace(/[أإآ]/g, "ا"));
    expect(bare.total).toBe((await search(w)).total);
  });
  it("caps a very long query and still answers 200", async () => {
    const r = await archive(call("GET", `/api/archive?q=${encodeURIComponent("ا".repeat(5000))}`) as never);
    expect(r.status).toBe(200);
  });
});
