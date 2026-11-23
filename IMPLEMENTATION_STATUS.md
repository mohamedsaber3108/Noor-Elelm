# NOOR AL-ILM — implementation register (2026-10-23)

This register separates shipped behavior from unverified content and external prerequisites. The current deployment is owner-private. No claim from the 45-file source archive is publicly approved.

| Requirement | State | Evidence / limit |
|---|---|---|
| Brand identity, Arabic typographic wordmark, emerald/ivory/gold/red palette | Implemented | Responsive light/dark UI, single-line wordmark, CSS design tokens; font licensing and self-hosting remain to be completed. |
| Source archive inspection and provenance | Implemented as research register | 45 files, 16 domain categories plus a root reference category; 3,337 paragraph/row candidates with stable IDs, file paths and locations. `Untitled` and numeric files included. Misclassification of substantive `Untitled` material was corrected. |
| 16 learning worlds and 48 chapter routes | Functional navigation | Each world/chapter opens, searches and filters its archive candidates. Chapter-specific approved lessons and scholarly content remain unavailable. |
| Search and linked research detail | Implemented | Paginated API, category/type/text filters, per-record URL and provenance. Original draft text is restricted to configured reviewers. |
| Quran and tafsir | Partial | 114 internal surah routes with external reading/tafsir links. Full Arabic text, approved tafsir and translations are not imported pending access, rights and verification. |
| Mosque explorer | Partial | Six internal mosque files and linked archive candidates, including 92 reclassified mosque claims. Dates, architecture and map facts await source review. |
| Infographic library | Functional draft system | The original 199 selected candidates remain; an optional view opens all 2,236 claim candidates as draft visual templates, filtered by world and numbered consistently. Each has a unique ID, red badge, wordmark, watermark, QR and verification page. The reviewer-only `/admin/infographics` queues 200 specific candidates and shows their latest review decisions. No 200 approved designs or export pipeline yet. |
| Game and Coins | Functional internal trial | 16 source-linked navigational questions in four interaction types and three levels, server-side signed-in attempts, expiring single-use question token, hourly cap, unique one-coin ledger. No scholarly-approved question bank. |
| User dashboard | Functional signed-in data | Coin balance, unique correct questions, day/week/month challenge progress, saved and read research records in D1. No family accounts or child profiles. |
| CMS and audit | Partial functional | Reviewer-gated import of 3,337 drafts into D1 in idempotent batches, text edits, version restore, review decisions, audit events. Publication remains disabled; no dual scholarly release or translator/designer role workflow. |
| Ten languages | Architecture only | Locale selector persists and translation table exists. Non-Arabic content remains unavailable until human translation and scholarly review; no machine translation of scripture. |
| Rewards, coupons and partners | Schema and disabled UI | Partner/reward/redemption entities exist. No partner consent, coupon issuance, redemptions or external value enabled. |
| Free, premium, institutional plans | Proposal UI | Basic content intended free; 90-day trial and EGP 79/699 are only proposals. Billing is not active. |
| PostgreSQL/AWS, Docker, backups | Not implemented | Current runtime is Sites Workers with D1. `DEPLOY_AWS.md` is a migration plan, not a deployed production stack or tested restore. |
| Accessibility, mobile, performance, security | Partially checked | TypeScript/build and desktop browser navigation/light/dark pass. Mobile device, assistive technology, load, penetration and hosted authenticated E2E tests remain. |

## Publication gate

For any religious or historical claim: locate primary source, confirm wording and context, record rights, complete scholarly review, translation review where applicable, and release a versioned artifact with correction policy. A reviewer decision in this pilot does not publish content. No institutional endorsement is asserted.
