# AWS Deployment, Security, and Operations

**Purpose:** define the target public-launch architecture. **Status:** proposed; current deployment is private Sites Workers/D1.

## Target topology

`DNS -> ALB/Nginx with TLS -> React SSR/static service + Node API -> RDS PostgreSQL`; S3 holds versioned visual assets; Secrets Manager holds service secrets; CloudWatch receives redacted logs/alarms; optional Redis/worker is added only for measured jobs/caching. Use separate staging/production accounts or least-privilege environments.

## P0 operational runbook

1. Provision non-root runtime identity, security groups limited to HTTPS and administration via controlled path, database private subnet, encrypted backups.
2. Build immutable release artifact from locked dependencies; run unit/API/E2E/security checks.
3. Apply backward-compatible migration in staging, restore a synthetic backup, smoke test key routes.
4. Deploy with health check; monitor errors/latency; preserve last healthy artifact for rollback.
5. Roll back application first; roll back data only from rehearsed migration plan.

## Security requirements

- HTTPS redirect, HSTS after domain validation, secure cookies, CSP suited to actual assets, CORS allowlist, request-size limits, validation, safe errors.
- Secret names in source only; values never committed. Rotate identity, database and webhook secrets on compromise/offboarding.
- Daily encrypted backups, defined RPO/RTO approved by owner, quarterly restore drill evidence.
- Audit privileged actions and release events; redact access tokens, emails where unnecessary, and source draft prose from logs.

## No-go launch blockers

No approved content workflow; no backup restore proof; unresolved authorization bypass; missing child safety controls while child accounts are enabled; payment enabled without reconciliation; no monitored error/incident path; no legal/rights owner.
