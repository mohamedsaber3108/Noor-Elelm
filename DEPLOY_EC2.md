# Deploying NOOR AL-ILM on a single Ubuntu server (AWS EC2)

The application is built for the Cloudflare Workers runtime. On EC2 it runs in that same runtime (`workerd`, started by Wrangler) behind nginx. The D1 database is a local SQLite file. Production on EC2 therefore uses exactly the code paths that were tested locally.

```
Internet ─▶ nginx :80/:443 ─▶ 127.0.0.1:8787  workerd (systemd: noor-al-ilm)
                                     └─ /var/lib/noor-al-ilm/state  (SQLite, D1)
Backups: /var/backups/noor-al-ilm (daily 03:15 UTC + before every deploy, 14 days)
```

| Path | Contents |
|---|---|
| `/srv/git/noor-al-ilm.git` | bare repo you `git push` to |
| `/opt/noor-al-ilm/releases/<time>-<sha>` | built releases (last 3 kept) |
| `/opt/noor-al-ilm/current` | symlink to the live release |
| `/var/lib/noor-al-ilm/state` | database (never inside a release) |

## First-time setup (done once)

From your computer (PowerShell), with the key at `C:\Users\<you>\.ssh\noorelelm.pem`:

```powershell
$key="$env:USERPROFILE\.ssh\noorelelm.pem"; $srv="ubuntu@13.53.135.68"
scp -i $key -r deploy/ec2 "${srv}:~/noor-setup"
ssh -i $key $srv "bash ~/noor-setup/setup-server.sh"
git remote add server "ssh://${srv}/srv/git/noor-al-ilm.git"
$env:GIT_SSH_COMMAND="ssh -i $key"; git push server main
ssh -i $key $srv "sudo noor-deploy main"
ssh -i $key $srv "sudo noor-create-admin you@example.com 'Your Name'"   # prompts for a password
```

AWS security group (EC2 → Security Groups → inbound rules): allow **TCP 80** and **TCP 443** from `0.0.0.0/0`. Restrict **22** to your own IP when you can.

## Every later release

```powershell
git push origin main                       # GitHub
$env:GIT_SSH_COMMAND="ssh -i $key"; git push server main
ssh -i $key $srv "sudo noor-deploy main"
```

`noor-deploy` builds the new release next to the running one. It then stops the service, backs up the database, applies pending migrations (tracked in `d1_migrations`), switches the symlink and starts the service. It checks `/api/health` and restores the previous release automatically if the check fails. Downtime is the restart only, usually under 15 seconds.

Roll back manually: `sudo noor-deploy --rollback`.

## Domain and HTTPS

1. At your DNS provider, create an `A` record for `example.com` (and `www`) pointing to the server's IP. Allocate an **Elastic IP** in AWS first, so the address does not change when the instance restarts.
2. On the server, edit `/etc/nginx/sites-available/noor-al-ilm` and change `server_name _;` to `server_name example.com www.example.com;`. Then run `sudo nginx -t && sudo systemctl reload nginx`.
3. Run `sudo certbot --nginx -d example.com -d www.example.com --redirect -m you@example.com --agree-tos`. Certificates renew automatically (`systemctl list-timers | grep certbot`).

Session cookies switch to `Secure` automatically once requests arrive over HTTPS.

nginx must pass `X-Forwarded-Proto` (and `Host`). The write-route Origin check compares the scheme too, so a missing `X-Forwarded-Proto` behind HTTPS makes browser writes fail with `403 BAD_ORIGIN`.

## Content Security Policy (`CSP_MODE`)

The app sends a `Content-Security-Policy-Report-Only` header by default. Setting `CSP_MODE` to `enforce` sends `Content-Security-Policy` instead. Any other value stays report-only. There is no report endpoint: violations show only in the browser console.

To set `CSP_MODE` on this host (it is not a secret): add `--var CSP_MODE:enforce` to the `ExecStart` line of the service unit (next to `--var TRUST_PROXY_HEADER:x-real-ip`), run `sudo systemctl daemon-reload`, then `sudo systemctl restart` the service. To roll back, remove the flag and repeat.

Scripts, curl calls and monitors that send the session cookie but no `Origin` and no `Sec-Fetch-Site` header now get `403` on writes (POST, PUT, PATCH, DELETE). Send an `Origin` header that matches the site, for example `Origin: https://your-site`. Browsers already send it.

Rollout:

1. Deploy with `CSP_MODE` unset (report-only) to staging.
2. Open the main pages in Arabic and English with the browser console open. Note every "Content Security Policy" message.
3. Fix or allow each one in `worker/index.ts`. Repeat step 2 until the console is clean.
4. Set `CSP_MODE=enforce` on staging and check again.
5. Set `CSP_MODE=enforce` on production. To roll back, unset `CSP_MODE`.

Fonts and styles still load from Google until the font question (Q22) is answered. `script-src` allows `'unsafe-inline'` because the renderer writes inline bootstrap scripts without a nonce.

## Sign-up switch

Sign-up is **closed unless you open it**. Two settings, added as extra `--var` lines on the `ExecStart` of the systemd unit, next to `--var TRUST_PROXY_HEADER:x-real-ip`:

- `REGISTRATION_MODE`: `closed` (default when unset or unknown), `allowlist` or `open`.
- `REGISTRATION_ALLOWLIST`: comma-separated emails; used only in `allowlist` mode.

Example line: `--var REGISTRATION_MODE:allowlist --var REGISTRATION_ALLOWLIST:<comma list>`. Then `sudo systemctl daemon-reload` and `sudo systemctl restart noor-al-ilm`. Login is never affected.

**Warning about `allowlist`:** it lets a stranger test whether an address is listed (a refused request answers differently from an accepted one), and it does not verify email, so whoever registers a listed address first owns that account. Keep `closed` until email verification exists.

## Operations

| Task | Command |
|---|---|
| Status / logs | `systemctl status noor-al-ilm` · `journalctl -u noor-al-ilm -f` |
| Restart | `sudo systemctl restart noor-al-ilm` |
| Health | `curl -s localhost/api/health` |
| Backup now | `sudo noor-backup manual` |
| Make someone admin | `sudo noor-create-admin email@x.com`, or change the role at `/admin/users` |
| Live release | `cat /opt/noor-al-ilm/current/REVISION` |

**Restore a backup:** `sudo systemctl stop noor-al-ilm`. Then `gunzip -c <backup>-d1-*.sqlite.gz | sudo tee /var/lib/noor-al-ilm/state/v3/d1/miniflare-D1DatabaseObject/<same-hash>.sqlite >/dev/null`, delete the `-wal`/`-shm` files next to it, and run `sudo chown -R noor:noor /var/lib/noor-al-ilm` and `sudo systemctl start noor-al-ilm`. Also copy backups off the server, for example with an S3 sync or EBS snapshots.

## Moving from REVIEWER_IDS to database roles (once, before deploying the N-15a release)
From this release only `users.role` makes someone staff. `REVIEWER_IDS` grants nothing.
1. Take an EBS snapshot and run `sudo noor-backup pre-roles`.
2. List the user ids in `REVIEWER_IDS` where the host sets it (the service environment or `.dev.vars`). Write them down.
3. `sudo systemctl stop noor-al-ilm`, then open the database with `sudo sqlite3 <file>.sqlite` (the file named in "Lost device, step 3" below).
4. Check each id: `SELECT id,email,role FROM users WHERE id IN ('<id1>','<id2>');`
5. For each person: `UPDATE users SET role='<role>' WHERE id='<id>';` `<role>` is one of `researcher`, `fact_checker`, `language_editor`, `scholar`, `publisher`, `reviewer` (`lib/rbac.ts`). If unsure, use `reviewer`: it keeps the access they have today.
6. `sudo chown -R noor:noor /var/lib/noor-al-ilm` and `sudo systemctl start noor-al-ilm`.
7. Deploy the release (`sudo noor-deploy <commit>`). Then check that an admin can still sign in, pass `/mfa` and open `/admin/users`, and that each moved person can open `/admin`.
8. Take `REVIEWER_IDS` out of the host settings and restart the service.

## Staff two-step sign-in (MFA)

Staff (every role in `lib/rbac.ts` except `learner`) must pass a 6-digit authenticator code (or a recovery code) after the password. Learners are not affected.

**Key delivery is NOT decided (QUESTIONS Q27).** How `MFA_SECRET_KEY` reaches the Worker on EC2 is open. Do **not** pass it with `--var`: command-line values are visible in process lists. Merge and deploy of this release wait for the owner's answer. The runbook (outside the repository: `plan/RUNBOOK-OD-04a.md`) lists the options to prove on staging first.

**Setup (owner, once, after Q27 is answered).** Create `MFA_SECRET_KEY` (at least 32 random characters, for example from `openssl rand -base64 48`; a passphrase typed by hand is not acceptable) and deliver it by the method chosen for Q27. Never put the value in chat, in a file in the repository, or in a ticket. Without it, MFA enrolment and verification fail closed with `MFA_NOT_CONFIGURED`, so staff cannot sign in to staff pages. Keep a copy of the key in your password manager. If it is lost or changed, every stored MFA secret is unreadable (`MFA_SECRET_UNREADABLE`) and each staff user is reset by the server-owner sqlite step (step 3 below), because admins cannot pass MFA. Take an EBS snapshot, then apply migration `drizzle/0005_staff_mfa.sql` through your normal release step, then restart the service. Enrol your own admin account first.

**Required setting for this release: `TRUST_PROXY_HEADER=x-real-ip`.** Without it every user shares one rate-limit bucket (`unknown`), so a few staff mistakes can block all staff. Check that it is set before the release goes live.

**After the deploy.** Enrol every admin and reviewer account in one sitting, admin first. Keep sign-up closed until done. Change the password of any staff account that was ever shared. Then check `audit_events` for `MFA_ENROLLED` and confirm each row is yours. After an admin reset, ask the person to enrol at once and change their password. Until a person enrols, whoever knows their password could enrol their own device first. Note: someone with a staff password can also use up the 5 tries per 15 minutes and keep that user out; a different admin can reset it.

**Lost device, step 1: recovery code.** The user signs in, opens `/mfa`, chooses "I lost my device" and types one of the 10 recovery codes they saved. Each code works once.

**Lost device, step 2: reset by another admin.** An admin who has passed MFA opens `/admin/users` (or calls `PUT /api/admin/users` with `{"id":"<user id>","resetMfa":true}`). This clears that user's MFA, recovery codes and sessions. The user enrols again at the next sign-in. An admin cannot reset their own MFA. The action is written to the audit log as `MFA_RESET`.

**Lost device, step 3: the last admin (server owner only).** Use this only when no admin can pass MFA and no recovery code is left. It is not run by the app and not part of a release.

1. Take an EBS snapshot and run `sudo noor-backup manual`.
2. `sudo systemctl stop noor-al-ilm`.
3. Open the D1 sqlite file under `/var/lib/noor-al-ilm/state/v3/d1/miniflare-D1DatabaseObject/` with `sudo sqlite3 <file>.sqlite`.
4. Run, with the admin's real id (find it with `SELECT id,email FROM users WHERE role='admin';`): `DELETE FROM user_mfa WHERE user_id='<id>'; DELETE FROM mfa_recovery_codes WHERE user_id='<id>'; DELETE FROM sessions WHERE user_id='<id>';`
5. `sudo chown -R noor:noor /var/lib/noor-al-ilm` and `sudo systemctl start noor-al-ilm`.
6. The admin signs in and enrols again at `/mfa`. Then write the event in your own log (the app does not record this step).

## Staff sessions

A staff session (any role except `learner`) that has passed MFA ends after **30 minutes without use** (idle) or **8 hours after the MFA step** (absolute), whichever comes first. The person must sign in again and pass MFA again. Learner sessions keep their 30-day life.

- **Settings (names only, both optional):** `STAFF_IDLE_MINUTES` (default 30) and `STAFF_ABSOLUTE_HOURS` (default 8). A value that is not a number, or is outside the range (idle 5 to 240 minutes, absolute 1 to 24 hours), is ignored and the default is used. Set them with the same method as the other settings; never in chat.
- **What users see:** about two minutes before the idle end, a small notice appears in the header (Arabic and English) with a button "Stay signed in". The button counts as use. The notice checks the clock every 30 seconds, not every second. When the 8-hour limit is the one about to end the session, the notice says so and has no button, because nothing can extend it. After the end, the next page or call sends the person to sign in.
- **Use is counted at most once a minute** (`sessions.last_seen_at`), so there is at most one extra database write per minute per staff session. An expired row is deleted by the call that finds it.
- **New session id after MFA.** A successful MFA code or recovery code replaces the session with a new one and deletes the old one. Any session id captured before MFA stops working.
- **Release step:** migration `drizzle/0008_session_limits.sql` adds the nullable column `sessions.last_seen_at`. It is additive. Take an EBS snapshot first, apply it through your normal release step, then restart. **Apply migration 0008 before the new build starts**, or every session read fails. A staff session with no `last_seen_at` counts from its MFA time, so staff who passed MFA more than 30 minutes before the release sign in again once.

## Mail (password reset and email verification)

Names only, no values here: `MAIL_PROVIDER`, `MAIL_FROM`, `MAIL_LINK_BASE`.

- **No mail provider is chosen (QUESTIONS Q7).** Until the owner picks one and delivers its key, reset and verification do nothing visible on the live site: the pages and routes exist, the answer is always "if an account exists, we sent a link", and no mail leaves the server.
- `MAIL_PROVIDER`: unset or `none` sends nothing and logs nothing with tokens. A named provider is **not built yet** and returns the code `MAIL_PROVIDER_NOT_IMPLEMENTED` (logged, no text). `outbox` exists for automated tests only and refuses to work outside them.
- **`TRUST_PROXY_HEADER=x-real-ip` is REQUIRED** (see the required setting above). Without it all clients share one rate-limit bucket, so 5 reset or verify requests from anyone block everyone for an hour.
- `MAIL_FROM`: the sender name only. The sending address belongs to the provider.
- `MAIL_LINK_BASE`: the public site address used in links, for example `https://<your-domain>` with no path. Use `https://`. Plain `http://` is accepted only for `localhost` or `127.0.0.1`; any other value counts as unset. It is never taken from request headers. Without it no token is created and no mail is built.
- The provider key will need a delivery method to the Worker. That is undecided (QUESTIONS Q27). Do **not** pass any key with `--var`: command-line values are visible in process lists.
- Migration `drizzle/0006_email_tokens.sql` adds the table `auth_tokens` and the column `users.email_verified_at`. It is additive. Take an EBS snapshot first and apply it through your normal release step. This release must not be merged or deployed before Q7 and Q27 are answered.
- Tokens: stored only as a SHA-256 hash, single use, 30 minutes (reset) and 24 hours (verify). The link carries the token in the part after `#`, so it is not sent to the server, to referrers or into logs.
- A reset ends every session of that user and signs nobody in. Staff still pass MFA at the next sign-in.
- Policy: an unverified account can use the site as before. Whether unverified accounts may earn coins is an open owner question (QUESTIONS Q29).

## Audit log

Migration `drizzle/0007_audit_chain.sql` is additive: new nullable columns on `audit_events` (`seq`, `prev_hash`, `hash`, `actor_role`, `result`, `source`, `reason`), two unique indexes, and two triggers. Take an EBS snapshot first. It is not applied by this change. The trigger SQL was added to the file by hand, because drizzle-kit snapshots cover tables and columns only.

- **Append-only.** A trigger on UPDATE and one on DELETE stop every change to `audit_events` with the error `AUDIT_APPEND_ONLY`. Old rows stay valid and readable. Nothing is deleted. Retention is the owner's decision (QUESTIONS Q8).
- **Hash chain.** Each new row stores `seq` (1, 2, 3, ...), the previous row's hash and its own SHA-256. The hash covers seq, previous hash, actor, role, action, target, detail, result, source, reason and time.
- **Same transaction.** The audit row is written in the same batch as the action. If the audit write fails (a collision with another writer is retried, up to 5 tries; any other audit failure is not), the action is not applied and the route answers `503 AUDIT_UNAVAILABLE`. MFA enrolment follows this too: `enabled_at`, the session and the recovery codes are in the audited batch, so after a 503 the account is not enrolled. The spent code stays spent (replay guard), so the user retries with the next code. Exception: password-reset and email-verify links, and MFA recovery codes, are spent BEFORE the audit batch. After a 503 the user asks for a new link (or uses another recovery code).
- **`id` is not hashed.** The row `id` is not part of the hash, so an id can change unseen. If a later migration rebuilds `audit_events` (create new table, copy, rename), the two triggers are dropped silently: re-create them in that migration. A test fails when `sqlite_master` lacks them.
- **Verifier.** An admin with a verified MFA session can open `GET /api/admin/audit/verify`. It returns `{ ok, brokenAt, checked, skipped }`. `skipped` counts old rows without `seq`. It changes nothing. The viewer page can also show it (the "check the hash chain" box, or `?verify=1` on the list).
- **What the verifier proves.** Rows written after 0007 were not edited, removed from the middle or reordered, unless the person also recomputed every later hash.
- **What it does not prove.** Someone with the database file can remove the triggers and rewrite the whole chain from any point, and the verifier will pass. Only a copy kept off the server detects that. **The daily off-box copy is NOT built**: it waits for the owner's storage answer (QUESTIONS Q6 and Q8). Rows removed from the very end, and rows added without `seq`, are not detected either. Old rows (before 0007) are not covered at all.
- **Viewer (N-14b).** An admin with a verified MFA session opens `/admin/audit` (API: `GET /api/admin/audit`). It is read only: newest first, 50 rows per page (at most 100), filters for action, actor id, target, result and date range (UTC in the API, your local time in the page). Old rows without `seq` come after the chained rows. Keys that look like secrets are blanked on read, and detail is cut at 500 characters. There is no export: export needs a password re-check (step-up), which is not built. There are no edit or delete controls.
- **Denied and failed rows.** `ADMIN_DENIED` (result `denied`): a signed-in user, including staff without MFA, was refused with 403 on an admin route; the target is the method and route path. `LOGIN_FAILED` (result `failed`): a wrong password for an existing account; actor and target are the account id. A wrong password for an unknown email writes nothing. `MFA_FAILED` is unchanged. Anonymous requests write nothing. At most 5 rows per actor and action per 15 minutes are written, so these rows show that attempts happened, not how many. If the audit write fails, the 403 or 401 is answered as before (no 500). These rows are in the hash chain like the others.
- **Table growth.** Nothing is deleted. Rows grow with use, and denied and failed rows add to it (at most 5 per actor and action per 15 minutes). Retention and any archive are the owner's decision (QUESTIONS Q8).

## Settings

Migration `drizzle/0009_settings.sql` is additive: one new table `settings` (`key`, `value`, `updated_at`, `updated_by`). Take an EBS snapshot first. It is not applied by this change. Until it is applied the site works on the defaults (reads are tolerant), but saving a setting fails.

- **Keys (a fixed list, no free keys).** `feature.game_enabled` and `feature.corrections_enabled` (on/off); `site.pricing_note_ar`, `site.pricing_note_en`, `site.registration_note_ar`, `site.registration_note_en` (plain text, up to 500 characters, no tags).
- **Defaults keep today's behaviour.** Both flags default to on, and the notes default to the wording the site shows today. With an empty table nothing looks different.
- **Flag off.** `/api/quiz/next`, `/api/quiz/answer` and `POST /api/corrections` answer `503 FEATURE_OFF`. The game and correction pages show a bilingual notice.
- **Who and how.** An admin with a verified MFA session uses `/admin/settings` (or `PUT /api/admin/settings` with `key`, `value`, `reason` of 10 to 300 characters). Every change writes a `SETTING_CHANGED` audit row in the same batch. If the audit write fails the setting is not changed. Public `GET /api/settings` returns only `site.*` and `feature.*` keys, cached for 30 seconds, so a change can take that long to show.
- **Not built.** The step-up dialog with a second approver (ADMIN.md s.4) for "disable a feature for everyone". Today the guard is admin + MFA + a written reason + the audit row.

## Limits of this setup

- One server means one point of failure. Use EBS snapshots plus the SQLite backups. To scale out, deploy the same build to Cloudflare Workers + D1 (`DEPLOY_CLOUDFLARE.md`).
- Wrangler's local runtime is meant for single-node hosting. It is the same `workerd` engine Cloudflare runs, but without edge caching or global replication.
