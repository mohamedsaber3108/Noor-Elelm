# NOOR AL-ILM — Product & Technical Blueprint

**Purpose:** implementation-ready blueprint for the existing Noor Al-Ilm Islamic education and research platform.  
**Status:** Current-state audit completed 2026-10-27; roadmap proposed; product is not production-certified.  
**Applies to:** the React/Vinext/D1 pilot currently hosted privately, and the target Node.js/PostgreSQL/AWS launch architecture.

## Scope and evidence

Inputs inspected: current source tree, 45-file archive research register and archive-derived JSON, implementation/status/security/design documents, the Universal Project Blueprint Master Prompt, and its How-to-Use and Input Brief companions. The Master Prompt in the attached ZIP is byte-identical to the supplied standalone MD.

The current site is a **private pilot**. Its 16 learning worlds, source index, 199 infographic candidates, optional 2,236 visual templates, 114-surah navigator, learning-game pilot, points ledger, reviewer tools, correction workflow, and newly added trust pages are real routes. None of those facts proves scholarly approval, public-launch readiness, licensed scripture/tafsir distribution, child safety compliance, billing readiness, or AWS/PostgreSQL deployment.

## Reading order

1. [00_PROJECT_OVERVIEW.md](00_PROJECT_OVERVIEW.md)
2. [01_EXISTING_CODE_AUDIT_AND_GAP_PLAN.md](01_EXISTING_CODE_AUDIT_AND_GAP_PLAN.md)
3. [02_REQUIREMENTS_AND_TRACEABILITY.md](02_REQUIREMENTS_AND_TRACEABILITY.md)
4. [03_PAGE_ROUTE_AND_JOURNEY_SPECS.md](03_PAGE_ROUTE_AND_JOURNEY_SPECS.md)
5. [04_ARCHITECTURE_DATA_AND_API.md](04_ARCHITECTURE_DATA_AND_API.md)
6. [05_ROLES_CONTENT_GOVERNANCE_AND_SAFETY.md](05_ROLES_CONTENT_GOVERNANCE_AND_SAFETY.md)
7. [06_DESIGN_SYSTEM_AND_ACCESSIBILITY.md](06_DESIGN_SYSTEM_AND_ACCESSIBILITY.md)
8. [07_OSS_RESEARCH_AND_ADOPTION.md](07_OSS_RESEARCH_AND_ADOPTION.md)
9. [08_COMMERCIAL_LEGAL_AND_GROWTH.md](08_COMMERCIAL_LEGAL_AND_GROWTH.md)
10. [09_AWS_DEPLOYMENT_SECURITY_AND_OPERATIONS.md](09_AWS_DEPLOYMENT_SECURITY_AND_OPERATIONS.md)
11. [10_QA_RELEASE_GATES_AND_BACKLOG.md](10_QA_RELEASE_GATES_AND_BACKLOG.md)
12. [11_SOURCES_AND_VERIFICATION_LEDGER.md](11_SOURCES_AND_VERIFICATION_LEDGER.md)

## Counted coverage

| Item | Count | Meaning |
|---|---:|---|
| Requirements traced | 18 | P0–P2 implementation records, not a claim that each is built |
| Product routes inventoried | 33 | existing and required future routes |
| Existing API routes audited | 9 | current route handlers |
| Target API contracts | 16 | P0/P1 contracts needed for public launch |
| Roles | 8 | visitor through platform administrator |
| Engines evaluated | 11 | classified required, later, or excluded |
| Verified OSS/official sources | 5 | evidence listed in the ledger |
| Release tasks | 37 | sequenced backlog with acceptance criteria |
| QA gates | 18 | required evidence before public launch |

## Primary decisions

- Preserve the current Arabic-first React interface and private pilot while content is reviewed.
- Use a modular Node.js service and PostgreSQL on AWS for the public platform; do not call the current D1 runtime the final production architecture.
- Keep publication separated from scholarly review; `APPROVE` remains a review event, never a release command.
- Keep free foundational knowledge outside premium entitlements; disable payment and rewards redemption until contracts, provider verification, and finance/legal review exist.
- Do not offer child profiles, family controls, or AI religious guidance before child privacy, moderation, and scholar-review controls are delivered.

## Handoff instructions

A developer should implement P0 in the order stated in [10_QA_RELEASE_GATES_AND_BACKLOG.md](10_QA_RELEASE_GATES_AND_BACKLOG.md), keep the documented identifiers intact, and update the evidence/status column when work is tested. Legal statements, religious approvals, payment-provider availability, and content licenses require a responsible human reviewer; this blueprint does not supply those approvals.
