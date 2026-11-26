import { worlds } from "@/lib/worlds";
import summaries from "@/data/archive-summaries.json";

// Keep in sync with `places` and `tracks` in components/places-tracks.tsx.
const mosqueSlugs = new Set(["masjid-al-haram", "prophets-mosque", "al-aqsa", "al-azhar", "kairouan", "cordoba"]);
const trackSlugs = new Set(["beginner", "family", "researcher"]);
const archiveIds = new Set((summaries as { id: string }[]).map((r) => r.id));
const worldBySlug = new Map(worlds.map((w) => [w.slug, w]));

const staticRoutes = new Set([
  "/", "/explore", "/search", "/quran", "/tafsir", "/library", "/mosques", "/start", "/tracks", "/game", "/challenges",
  "/dashboard", "/methodology", "/sources", "/kids", "/family", "/pricing", "/rewards", "/support", "/privacy", "/terms",
  "/accessibility", "/institutions", "/login", "/register", "/mfa", "/admin", "/admin/infographics", "/admin/corrections", "/admin/users", "/account",
]);

/** True when the path is a page the app can render. Used to return a real HTTP 404 for everything else. */
export function isKnownRoute(segments: string[]): boolean {
  const parts = segments.map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  const path = "/" + parts.join("/");
  if (staticRoutes.has(path)) return true;
  const [a, b, c, d] = parts;
  if (a === "worlds") {
    const w = worldBySlug.get(b ?? "");
    if (!w) return false;
    if (parts.length === 2) return true;
    return parts.length === 4 && c === "chapters" && /^\d+$/.test(d) && Number(d) >= 1 && Number(d) <= w.topics.length;
  }
  if (parts.length !== 2) return false;
  if (a === "quran" || a === "tafsir") return /^\d+$/.test(b) && Number(b) >= 1 && Number(b) <= 114;
  if (a === "mosques") return mosqueSlugs.has(b);
  if (a === "tracks") return trackSlugs.has(b);
  if (a === "archive" || a === "corrections") return archiveIds.has(b);
  if (a === "infographic" || a === "verify") return archiveIds.has(b);
  return false;
}
