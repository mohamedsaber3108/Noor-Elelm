# Requirements and Traceability Matrix

**Purpose:** link user requirements to a real delivery route. **Status:** current and target scope. **Sources:** user brief, Master Prompt, project source.

| REQ | Feature | Page/API/Data | Priority | Status | Acceptance test |
|---|---|---|---|---|---|
| REQ-001 | Source-led encyclopedia | PAGE-EXPLORE, API-ARCHIVE, DATA-CONTENT | P0 | Partial | source, locator and state visible for each published item |
| REQ-002 | Scholarly publication gate | PAGE-ADMIN, API-RELEASE, DATA-REVIEW | P0 | Missing | no actor can publish without documented required approvals |
| REQ-003 | Visual infographic production | PAGE-LIBRARY, PAGE-VERIFY | P0 | Partial | unique ID, source, version, QR and status render correctly |
| REQ-004 | Quran/tafsir experience | PAGE-QURAN | P0 | Partial | licensed canonical text/translation attribution is verified |
| REQ-005 | Source-linked questions/coins | PAGE-GAME, API-QUIZ | P0 | Partial | single correct qualified answer earns at most one coin |
| REQ-006 | Correction management | PAGE-CORRECTION, API-CORRECTION | P0 | Partial | reporter can submit; reviewer can resolve with immutable audit event |
| REQ-007 | Global search | PAGE-SEARCH, ENG-SEARCH | P0 | Partial | search respects authorization and filters |
| REQ-008 | Family/child learning | PAGE-KIDS | P1 | Missing | guardian consent, age controls and no public chat verified |
| REQ-009 | Ten-language workflow | DATA-TRANSLATION | P1 | Partial | human translator/reviewer/source state required before locale release |
| REQ-010 | Subscriptions | PAGE-PRICING, ENG-BILLING | P1 | Disabled | sandbox payment/webhook/reconciliation passes |
| REQ-011 | Rewards marketplace | PAGE-REWARDS, DATA-REDEMPTION | P2 | Disabled | consented partner, inventory, fraud checks and refund flow exist |
| REQ-012 | Institutional use | PAGE-INSTITUTIONS, ENG-ORG | P2 | Information only | tenant isolation and export controls pass |
| REQ-013 | Privacy/terms/accessibility | PAGE-PRIVACY/TERMS/ACCESSIBILITY | P0 | Implemented as pilot pages | page routes work and launch checklist identifies legal gaps |
| REQ-014 | Support | PAGE-SUPPORT | P0 | Implemented as guidance | named support channel/SLA exists before public launch |
| REQ-015 | AWS/Node/PostgreSQL | ENG-INFRA | P0 | Missing | staging deploy, backup restore, rollback evidence |
| REQ-016 | Security/role control | ENG-IAM | P0 | Partial | negative permission tests cover every privileged API |
| REQ-017 | Accessibility/mobile | ENG-UX | P0 | Partial | keyboard, screen reader, contrast and mobile suite pass |
| REQ-018 | Audit/observability | ENG-OPS | P0 | Partial | production logs, alerts, trace/request IDs and runbook tested |

**Definition of done:** a row changes to Implemented only when the code, persistence, server-side authorization, operational configuration and listed acceptance test have evidence.
