# Existing Code Audit and Safe Change Plan

**Purpose:** distinguish built behavior from UI-only or planned work. **Status:** verified by source inspection; browser and hosted authenticated verification remain partial.

## Existing implementation

| Area | Status | Evidence | Safe next action |
|---|---|---|---|
| Arabic React interface, light/dark theme, navigation | Existing & works locally | `components/experience.tsx`, `app/globals.css` | retain |
| 16 worlds/48 chapters and archive search | Partial | archive JSON + learning components | add approved lessons only through CMS workflow |
| Research archive provenance | Existing | `research/*`, archive API | keep raw source restricted to reviewers |
| Reviewer decisions and audit trail | Partial | `/api/admin/review`, D1 `reviews/audit_events` | add separation-of-duties and release approval |
| Visual library/QR/verify page | Functional draft system | `visual-library.tsx` | no public approval label until complete review |
| Quiz/coins | Functional pilot | quiz APIs, unique ledger index | replace trial questions with approved bank |
| Corrections | Functional signed-in report intake | `/api/corrections` | add status, assignee, resolution notice |
| Ten languages | Architecture only | locale selector + translations table | add human reviewed content per locale |
| Payments/rewards | Disabled/pending | schema and status pages | do not enable before contracts/provider verification |
| Child/family accounts | Missing | no consent/guardian entities | P1, block public child feature launch |
| AWS/PostgreSQL | Missing | `DEPLOY_AWS.md` is plan | P0 infrastructure work |

## Safe-change constraints

1. Preserve emerald/ivory/gold/red identity, typography-based wordmark, current routes and Arabic-first hierarchy.
2. Do not replace working native links with router assumptions that break deep links.
3. Never expose raw unreviewed archive prose to unauthorised readers.
4. Do not convert reviewer decision into automatic publication.
5. Any migration must be additive, reversible where feasible, and rehearsed against a synthetic backup.

## P0 gap plan

- Add real approved-content lifecycle, citation/rights records, and dual release approval.
- Replace D1 runtime with the target PostgreSQL architecture only through a migration/rollback rehearsal.
- Add account lifecycle, data export/deletion workflow, support owner, error monitoring, and incident runbooks.
- Add legal review for privacy/terms, payment/tax, and child protection before public availability.
