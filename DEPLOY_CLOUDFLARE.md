# Deploying NOOR AL-ILM to Cloudflare Workers + D1

The app is a Vinext (Next-compatible) build that runs on Cloudflare Workers with a D1 (SQLite) database. This is the architecture the code was written for, so it is the supported production path. `DEPLOY_AWS.md` describes an optional future PostgreSQL/AWS migration and is not implemented.

## What is already done in the repo

- Email + password accounts (`/login`, `/register`, `/api/auth/*`). Passwords use PBKDF2-SHA256 (100k iterations, per-user salt). Session tokens are random, stored only as SHA-256 hashes, sent in an `HttpOnly`, `SameSite=Lax`, `Secure` (on HTTPS) cookie, valid 30 days.
- Login and registration are rate limited in D1 (`rate_limits` table). Same-origin check on all auth POSTs.
- Reviewer access: set a user's `role` to a staff role (`researcher`, `fact_checker`, `language_editor`, `scholar`, `publisher`, `reviewer` or `admin`, see `lib/rbac.ts`) in the `users` table. No variable grants a role.
- `GET /api/health` returns 200 when the DB is reachable, 503 otherwise.
- Security headers (HSTS, nosniff, frame, referrer, permissions) are added in `worker/index.ts` for production builds.
- Migrations: `drizzle/0000` to `0003_auth.sql`.

## What you must do (needs your Cloudflare account)

1. Install deps: `pnpm install --frozen-lockfile` (Node >= 22.13).
2. Log in: `npx wrangler login`.
3. Create the database: `npx wrangler d1 create noor-al-ilm-prod`. Copy the `database_id` it prints.
4. Build with your values (PowerShell shown):
   ```powershell
   $env:D1_DATABASE_ID="<id from step 3>"; $env:D1_DATABASE_NAME="noor-al-ilm-prod"; $env:WORKER_NAME="noor-al-ilm"
   pnpm build
   ```
5. Apply migrations to the remote DB:
   `npx wrangler d1 migrations apply noor-al-ilm-prod --remote --config dist/server/wrangler.json`
6. Deploy: `npx wrangler deploy --config dist/server/wrangler.json`
7. Check: `https://<worker>.workers.dev/api/health` returns `{"status":"ok"}`.
8. Create the first admin (either option):
   - `node scripts/create-admin.mjs you@example.com '<strong password>' 'Your Name' > admin.sql` then `npx wrangler d1 execute noor-al-ilm-prod --remote --file admin.sql` (delete `admin.sql` afterwards), or
   - register at `/register`, then `npx wrangler d1 execute noor-al-ilm-prod --remote --command "UPDATE users SET role='admin' WHERE email='you@example.com'"`.
   After that, manage roles at `/admin/users`.
9. Domain: add the domain to Cloudflare (DNS), then Workers & Pages > your worker > Settings > Domains & Routes > Add Custom Domain. HTTPS certificates are issued automatically.

## Moving from REVIEWER_IDS to database roles (once, before deploying the N-15a release)
From this release only `users.role` makes someone staff. `REVIEWER_IDS` grants nothing.
1. Back up first (see Backups below).
2. List the user ids that are in `REVIEWER_IDS` today (Workers & Pages > your worker > Settings > Variables and Secrets; a secret cannot be read back, so use your own record of it).
3. Check each id: `npx wrangler d1 execute noor-al-ilm-prod --remote --command "SELECT id,email,role FROM users WHERE id IN ('<id1>','<id2>')"`.
4. For each person: `npx wrangler d1 execute noor-al-ilm-prod --remote --command "UPDATE users SET role='<role>' WHERE id='<id>'"`. `<role>` is one of `researcher`, `fact_checker`, `language_editor`, `scholar`, `publisher`, `reviewer` (`lib/rbac.ts`). If unsure, use `reviewer`: it keeps the access they have today.
5. Deploy. Then check that an admin can still sign in, pass `/mfa` and open `/admin/users`, and that each moved person can open `/admin`.
6. Remove the `REVIEWER_IDS` variable on the same Settings page.

## Variables

| Name | Where | Purpose |
|---|---|---|
| `D1_DATABASE_ID`, `D1_DATABASE_NAME`, `WORKER_NAME` | build time | Written into `dist/server/wrangler.json` |

No other secrets are required. Never commit `.env*` or `.dev.vars*` (already ignored).

## Backups

D1 Time Travel gives point-in-time restore for 30 days: `npx wrangler d1 time-travel info noor-al-ilm-prod`. For off-platform copies run `npx wrangler d1 export noor-al-ilm-prod --remote --output backup.sql` on a schedule.

## Known limits before a public launch

- No password reset or email verification (no email provider configured). Needs a provider (e.g. Resend/MailChannels) and a token table.
- No approved religious content. Publication is intentionally disabled by the product's governance rules; draft text is visible to reviewers only.
- Payments, rewards redemption, family/child accounts and institutional accounts are not implemented (UI states this).
- Legal pages (privacy/terms) are drafts that need legal review.
- Rate limiting is D1-backed and per-IP/email. For heavy traffic add Cloudflare WAF rate-limiting rules on `/api/auth/*`.
- Only the trial quiz bank (16 questions) exists; it is not scholar-approved.
