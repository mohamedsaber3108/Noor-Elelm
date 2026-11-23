# AWS production path (planned)

The current hosted pilot uses D1 on Sites Workers. It is **not** a PostgreSQL/AWS deployment artifact. A production move to AWS requires: a Node-compatible API layer replacing `cloudflare:workers`, PostgreSQL migrations for the 14 core tables and additional editorial entities, RDS private networking and backup restore drills, object storage with versioning, authenticated OIDC/session support and admin MFA, WAF/rate limiting, CI/CD, observability, export jobs, Quran/translation licensing, and an approved content corpus. Avoid copying the trial bank into public production.

Proposed topology: CloudFront → Next.js app/API on ECS or EC2 → RDS PostgreSQL, ElastiCache Redis, S3 assets. Secrets in Secrets Manager. Preserve point-ledger unique constraints and use transaction isolation/idempotency. Introduce separate permissions for researcher, fact-checker, scholar, publisher and auditor. Verify disaster recovery with a restored database before launch.
