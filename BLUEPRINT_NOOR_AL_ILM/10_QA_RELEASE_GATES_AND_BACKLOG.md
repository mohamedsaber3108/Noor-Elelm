# QA, Release Gates, and Dependency-Aware Backlog

**Purpose:** define work sequencing and evidence. **Status:** proposed release plan; only local build/type checks are currently evidenced.

| Phase | Tasks | Dependencies | Exit evidence |
|---|---|---|---|
| P0-A Audit foundations | TASK-001 source/rights inventory; TASK-002 content state model; TASK-003 route/link inventory | existing archive | approved data classification and 404/403 checks |
| P0-B Governance | TASK-004 dual release gate; TASK-005 citations/rights; TASK-006 correction resolution | P0-A | negative role tests + audit evidence |
| P0-C Learner core | TASK-007 approved lesson renderer; TASK-008 approved question bank; TASK-009 progress/ledger contract | P0-B | E2E learner journey and replay test |
| P0-D Trust/ops | TASK-010 data export/delete; TASK-011 support workflow; TASK-012 monitoring/error handling | P0-A | support/incident drill |
| P0-E Infrastructure | TASK-013 Node/Postgres migration; TASK-014 CI; TASK-015 backup/rollback | P0-D | staging deploy + restore proof |
| P0-F Hardening | TASK-016 a11y/mobile; TASK-017 OWASP/role tests; TASK-018 load/resilience | all P0 | release scorecard signed |
| P1 Families/locales | TASK-019 guardian model; TASK-020 reviewed translations; TASK-021 family experience | P0 release | consent and locale quality tests |
| P1 Billing | TASK-022 provider evaluation; TASK-023 entitlement/webhook; TASK-024 finance flow | legal/finance | sandbox reconciliation |
| P2 Institutional/rewards | TASK-025 tenant model; TASK-026 partner workflow; TASK-027 export/reporting | P1 | tenant boundary and fraud tests |

## Quality gates

| Gate | PASS condition |
|---|---|
| Content | published item has exact citation, rights, required reviews, version and correction path |
| Authorization | every privileged API has allow and deny tests |
| Data | migration, backup restore, export/delete path tested |
| UX | critical flows pass mobile/keyboard/screen-reader manual checks |
| Security | dependency scan and relevant OWASP tests have no unresolved high severity issue |
| Operations | alerts, owner, runbook and rollback drill exist |
| Commercial | no payment/reward claims before provider/contract/reconciliation proof |

Current assessment: **PARTIAL**. The private pilot build passed TypeScript/Vinext checks in prior work; the gates above have not been collectively passed in staging/production.
