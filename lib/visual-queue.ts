/**
 * The first infographic production batch (shared by /api/admin/visual-queue and /api/admin/editorial).
 * 199 archive headings explicitly marked as infographics plus one selected sira topic, at most 200.
 */
import records from "@/data/archive-records.json";

export type ArchiveRow = { id: string; world: string; title: string; source: string; location: string; type: string };
export const archiveRows = records as ArchiveRow[];

const explicit = archiveRows.filter((r) => r.type === "claim_candidate" && /^\s*(?:ال)?إنفو(?:غرافيك|غراف)/.test(r.title) && r.title.length > 22);
// Complete the first production batch with a specific visual topic from the sira archive.
const supplemental = archiveRows.find((r) => r.id === "NAI-1e1a6ac29175");

export const visualQueue: ArchiveRow[] = [...explicit, ...(supplemental && !explicit.includes(supplemental) ? [supplemental] : [])].slice(0, 200);
export const archivePositions = new Map(archiveRows.map((r, i) => [r.id, i + 1]));
