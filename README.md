# نور العلم — NOOR AL-ILM

Private, working Islamic education and research platform. Its goal is a source-led visual encyclopedia. **The 45-file archive has not received scholarly approval.** Drafts are private to configured reviewers; general visitors see titles and provenance, not raw source prose.

## Open the experience

- `/` editorial home and typographic brand; `/explore` 16 worlds; `/worlds/:slug/chapters/:1-3` 48 browsable chapters.
- `/search` global research search, `/archive/:id` provenance/detail and saved/read actions.
- `/quran` complete 114-surah navigation; `/quran/:number` internal surah page linking to Quran.com for original reading and tafsir. Quran text is not imported.
- `/mosques` six files and `/mosques/:slug` detail linked to archive research.
- `/library` 199 draft infographic candidates; `/infographic/:id` live HTML text design with QR; `/verify/:id` status/source record.
- The library also has an optional all-points view for 2,236 archived claim candidates, with world filtering and stable red sequence numbers. These are visual production drafts, not approved infographics or verified religious lessons.
- `/admin/infographics` is a reviewer-only first-200 production queue: 199 archive headings explicitly marked as infographics plus one sira topic. It filters by world and last recorded review decision, and opens each draft in the existing editor and visual preview. Decisions never publish an infographic.
- `/tracks` beginner, family and researcher journeys; `/tracks/:slug` their stations.
- `/game` four trial interaction types, three levels, one-coin-per-distinct-correct-question ledger; `/dashboard` saved/read lists and challenge progress.
- `/admin` reviewer-gated batch import, versioned text edits/restore and review decisions. `/methodology`, `/institutions`, `/pricing`, `/rewards` state governance and unavailable external services.
- `/corrections/:id` accepts a signed-in reader's source-backed correction report, saved to the audit log with a daily limit; `/admin/corrections` shows recent reports only to configured reviewers. Reports do not publish or alter religious content.

## Stack

Sites Workers, Vinext/React/TypeScript, Cloudflare D1 with Drizzle (16 tables), CSS tokens, local light/dark preference. Sites supplies authenticated visitor identity; review privileges use an explicit hosting allowlist. This hosted runtime is D1, **not PostgreSQL**. An AWS/PostgreSQL migration is documented in `DEPLOY_AWS.md` and is not yet delivered. See `RUN_LOCAL.md` for the local build and migration commands.

## Source data

`research/ORIGINAL_SOURCE_ARCHIVE.zip` preserves the original package. `research/SOURCE_INVENTORY.csv`, `CLAIM_AUDIT.csv` and `CONTENT_COVERAGE_MATRIX.csv` track all 3,337 extracted paragraphs/rows, source paths and locations. `scripts/build-source-register.py` rebuilds the register from an extracted source folder. `data/archive-records.json` and `data/archive-summaries.json` serve the private research index; the admin import copies drafts to D1 without publishing them.

## Publishing and rights

No automatic publication, AI translation of scripture, fabricated institutional approval, partner agreement or cash redemption. Quran reading links go to the source pending licensed, carefully checked text/tafsir import. Visual cards are labeled draft. A review decision is logged but cannot release a page. See `EDITORIAL_POLICY.md`, `CITATIONS_AND_LICENSES.md`, `IMPLEMENTATION_STATUS.md` and `QA_REPORT.md` for the exact gates and remaining work.
