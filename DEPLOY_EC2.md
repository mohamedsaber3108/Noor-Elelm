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

## Staff two-step sign-in (MFA)

Reviewers, admins and ids in `REVIEWER_IDS` must pass a 6-digit authenticator code (or a recovery code) after the password. Learners are not affected.

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
- **Verifier.** An admin with a verified MFA session can open `GET /api/admin/audit/verify`. It returns `{ ok, brokenAt, checked, skipped }`. `skipped` counts old rows without `seq`. It changes nothing. There is no page yet.
- **What the verifier proves.** Rows written after 0007 were not edited, removed from the middle or reordered, unless the person also recomputed every later hash.
- **What it does not prove.** Someone with the database file can remove the triggers and rewrite the whole chain from any point, and the verifier will pass. Only a copy kept off the server detects that. **The daily off-box copy is NOT built**: it waits for the owner's storage answer (QUESTIONS Q6 and Q8). Rows removed from the very end, and rows added without `seq`, are not detected either. Old rows (before 0007) are not covered at all.
- Failed and denied attempts (for example a 403 on an admin route) are not logged yet. The viewer page is also not built (N-14b).

## Limits of this setup

- One server means one point of failure. Use EBS snapshots plus the SQLite backups. To scale out, deploy the same build to Cloudflare Workers + D1 (`DEPLOY_CLOUDFLARE.md`).
- Wrangler's local runtime is meant for single-node hosting. It is the same `workerd` engine Cloudflare runs, but without edge caching or global replication.
