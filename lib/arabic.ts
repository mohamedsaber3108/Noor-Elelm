import { normalizeDigits } from "@/lib/digits";

/**
 * Arabic search normalisation (N-23a). Used for MATCHING only: the text shown to readers is never changed,
 * and no religious text is rewritten. Both the stored search text and the query go through this function.
 * - removes tashkeel (U+064B-U+065F), superscript alef (U+0670), Quranic annotation marks (U+06D6-U+06ED) and tatweel (U+0640)
 * - alef forms (U+0623, U+0625, U+0622, U+0671) to bare alef (U+0627)
 * - taa marbuta (U+0629) to haa (U+0647); alef maqsura (U+0649) to yaa (U+064A)
 * - hamza on waw (U+0624) to waw; hamza on yaa (U+0626) to yaa; Persian yeh (U+06CC) to yaa, keheh (U+06A9) to kaf
 * - Arabic-Indic and Persian digits to 0-9 (lib/digits.ts)
 * - removes bidi and joiner marks (U+061C, U+200C-U+200F, U+202A-U+202E, U+2066-U+2069)
 * - lower-cases Latin letters and folds runs of white space to one space
 */
export function normalizeArabic(s: string): string {
  return normalizeDigits(s.normalize("NFC"))
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "")
    .replace(/[\u061C\u200C-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/[\u0623\u0625\u0622\u0671]/g, "\u0627")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0624/g, "\u0648")
    .replace(/\u0626/g, "\u064A")
    .replace(/\u06CC/g, "\u064A")
    .replace(/\u06A9/g, "\u0643")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
