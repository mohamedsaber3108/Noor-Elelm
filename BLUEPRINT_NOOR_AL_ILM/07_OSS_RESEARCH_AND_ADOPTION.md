# OSS Research, License, and Adoption Plan

**Purpose:** choose only tools relevant to the target platform. **Status:** official/GitHub evidence checked 2026-10-27; reverify before dependency upgrades.

| OSS | Verified source | License | Fit / decision | Integration and risk |
|---|---|---|---|---|
| React | https://github.com/facebook/react | MIT | **Adopt/current** for interface | already used; pin lockfile and monitor advisories |
| Drizzle ORM | https://github.com/drizzle-team/drizzle-orm | Apache-2.0 | **Adopt/current/target** for typed schema/migrations | current D1 use; evaluate PostgreSQL adapter migration |
| Playwright | https://github.com/microsoft/playwright | Apache-2.0 | **Pilot P0** E2E and accessibility regression | Node 20+ requirement; browser binaries add CI weight |
| Zod | https://github.com/colinhacks/zod | MIT, reverify | **Consider** request schema validation | adopt after license/version verification in release PR |
| OpenTelemetry JS | https://github.com/open-telemetry/opentelemetry-js | Apache-2.0, reverify | **Consider P0** tracing | configure PII redaction and sampling before export |

## Explicit exclusions

- No self-hosted LLM/RAG engine in MVP: religious answers create high grounding, cost, and review risk. Use authored, reviewed learning paths instead.
- No heavyweight headless CMS replacement before content workflow requirements are validated; the existing editorial model should be made correct first.
- No AGPL/SSPL/unknown-license dependency without legal review. npm libraries must be lockfile-pinned and scanned; standalone services need ownership, backups, updates, and memory budget.

## Adoption gate

For every new dependency: canonical URL + LICENSE checked, compatible Node/runtime confirmed, purpose mapped to REQ/TASK, vulnerability scan recorded, notice obligation captured, rollback/removal path documented.
