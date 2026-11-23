# NOOR AL-ILM: production readiness report

Status: **Deployed and verified on AWS EC2 over HTTP** (`http://13.53.135.68`, eu-north-1, Ubuntu 26.04, release `cca8854`). HTTPS and a domain are still pending: they need a DNS record (see `DEPLOY_EC2.md`).

## 1. Architecture

```
Browser ──> Cloudflare Worker (worker/index.ts: body cap, security headers)
              └─ Vinext (Next 16 App Router)
                   ├─ app/[...slug]/page.tsx  -> route validation (lib/routes.ts) -> 404 or <Experience/>
                   ├─ components/*            -> client UI (Arabic, RTL)
                   └─ app/api/**              -> route handlers
                          ├─ app/auth.ts      -> sessions, PBKDF2, roles, rate limit
                          ├─ D1 (SQLite)      -> users, sessions, quiz, ledger, bookmarks, CMS, audit
                          └─ data/*.json      -> 3,337-record research archive (read-only)
```

Roles: `learner` (default) < `reviewer` (editorial APIs) < `admin` (reviewer rights + user management/stats).

## 2. Pages (110 routes verified in a browser at 1366px and 390px)

Public: `/`, `/explore`, `/search`, `/worlds/:slug` (16), `/worlds/:slug/chapters/1-3` (48), `/archive/:id`, `/quran`, `/quran/1-114`, `/tafsir`, `/tafsir/:n`, `/library`, `/infographic/:id`, `/verify/:id`, `/mosques`, `/mosques/:slug` (6), `/start`, `/tracks`, `/tracks/:slug` (3), `/methodology`, `/sources`, `/kids`, `/family`, `/pricing`, `/rewards`, `/support`, `/privacy`, `/terms`, `/accessibility`, `/institutions`, `/login`, `/register`.
Signed-in: `/dashboard`, `/game`, `/challenges`, `/account`, `/corrections/:id` (public pages never require login).
Reviewer: `/admin`, `/admin/infographics`, `/admin/corrections`. Admin: `/admin/users`.
Unknown paths return HTTP 404 with the in-app not-found view.

## 3. APIs

| Route | Access | Purpose |
|---|---|---|
| `POST /api/auth/register\|login\|logout`, `GET /api/auth/session` | public | accounts and sessions |
| `GET/PATCH/POST/DELETE /api/account` | signed in | profile, rename, change password (revokes other sessions), delete account + personal data |
| `GET /api/me`, `GET/POST /api/user-content` | signed in | coins, challenges, bookmarks, read history |
| `GET /api/quiz/next`, `POST /api/quiz/answer` | signed in | single-use tokens, one coin per question |
| `POST /api/corrections` / `GET` | signed in / reviewer | correction reports |
| `GET /api/archive` | public (draft text reviewer-only) | search and record detail |
| `/api/admin/import\|content\|review\|visual-queue` | reviewer | editorial workflow |
| `GET/PUT/DELETE /api/admin/users` | admin | user list, search, stats, role change, session revoke |
| `GET /api/health` | public | DB liveness |

## 4. Database (D1 migrations `drizzle/0000`–`0004`)

Original 16 tables plus `users`, `sessions`, `rate_limits` (0003) and indexes on `quiz_attempts(user_id,created_at)`, `audit_events(action,created_at)`, `audit_events(actor_id,action)` (0004). Multi-row changes (password change, account delete, role change) run in a single D1 batch, which is a transaction.

## 5. Security changes

- Replaced host-injected identity headers (spoofable off the original host) with first-party accounts.
- PBKDF2-SHA256 passwords, constant-time compare, equal-cost path for unknown emails.
- Session tokens 256-bit random, stored as SHA-256, `HttpOnly`/`SameSite=Lax`/`Secure` cookie.
- Same-origin check on all state-changing auth/account/admin calls; cross-origin write test returns 403.
- Rate limits: login (per IP+email and per IP), registration, password change, account delete.
- Removed the email-based reviewer allowlist (emails are unverified).
- Last-admin protection for demotion and self-delete. Every role change, session revoke, password change and account deletion goes to `audit_events`.
- 1 MB request body cap (413). HSTS, nosniff, frame, referrer and permissions headers.
- Search input is bound as parameters, and `LIKE` wildcards are escaped.

## 6. Performance (local Miniflare, single machine)

| Test | Result |
|---|---|
| `GET /` 300 req, 25 concurrent | all 200, p50 272 ms, p95 1.86 s |
| `GET /api/archive` search 300 req, 25 concurrent | all 200, p50 183 ms, p95 954 ms |
| 12 parallel submits of one quiz token | 1 accepted, 11 rejected (409), no double coin |

Local numbers are a floor. Workers run at the edge with far more capacity. The archive JSON (1.2 MB) is bundled into the Worker and searched in memory. Move it to D1 full-text search if the archive grows a lot.

## 7. Tests run (scripts kept outside the repo; reproduce with Playwright + Edge)

- Browser crawl: 220 page loads, no page errors, no layout overflow on mobile.
- Journeys: register → dashboard, search → archive → bookmark → shows on dashboard, correction submit, quiz (choice, boolean, ordering, matching), logout, wrong password error, login with `return_to`, mobile menu.
- Admin API (27 checks): anon, learner and reviewer isolation, list, search, injection-style query, promote, invalid role, last-admin, session revoke, cross-origin block, rename, password change (old sessions revoked), account delete (data removed, login fails).
- Admin UI: stats, user table, search, role change, links, rename.
- `npx tsc --noEmit` clean. `pnpm lint` 0 errors (32 unused-import warnings). `pnpm build` passes.

## 8. Bugs fixed

- Login only worked on the original private host. Now independent.
- Unknown URLs returned 200 (soft 404). Now 404.
- A hardcoded `*.chatgpt.site` domain was in infographic verification URLs.
- Login page fell back to `/` and hydrated differently from the server.
- Requests rejected before their body was read crashed the local worker. Bodies are now buffered and capped.
- 14 lint errors and dead `Game`/`Dashboard` components removed.
- Support page still described ChatGPT sign-in.

## 9. Not implemented (needs external services or decisions)

| Item | Why | What is needed |
|---|---|---|
| Password reset, email verification | no email provider | provider API key (e.g. Resend) and a token table |
| Payments, subscriptions, transactions, coupons | no payment provider or approved prices; the pricing page says plans are proposals | provider account (Paymob/Stripe), tax and legal terms |
| Reward redemption, partners | no partner agreements | partner contracts |
| Family/child accounts | needs a guardian-consent design and legal review | policy decision |
| Approved religious content | governance rule: nothing publishes without scholarly review | review board |
| Legal pages | drafts | lawyer review |
| Error tracking | no Sentry or similar configured | Workers Logs are on (`observability.enabled`); add Sentry if wanted |

## 10. Live deployment (EC2) verification

Run from outside the server against `http://13.53.135.68`:
- Browser crawl of 110 routes on desktop and mobile (220 loads): all render. The only flags are the expected 401 behind `/account` when signed out.
- API through nginx: health, 404, login-required/admin-only enforcement, register → session → quiz → bookmark, cross-site write blocked (403), admin login and statistics. The temporary account was deleted afterwards.
- Security headers present, `/_next/static` served `immutable`, rate-limit keys use the real client IP (X-Real-IP from nginx).
- `noor-deploy` run three times: build, pre-deploy backup, tracked migrations (`No migrations to apply` on re-run), health-checked switch, prune to 3 releases.
- `noor-al-ilm` and `nginx` enabled at boot. Daily backup cron installed.

## 11. Deployment

See `DEPLOY_CLOUDFLARE.md`. Create the first admin with `node scripts/create-admin.mjs you@domain.com '<password>' 'Name' > admin.sql`, then run `npx wrangler d1 execute noor-al-ilm-prod --remote --file admin.sql`.
