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

## Limits of this setup

- One server means one point of failure. Use EBS snapshots plus the SQLite backups. To scale out, deploy the same build to Cloudflare Workers + D1 (`DEPLOY_CLOUDFLARE.md`).
- Wrangler's local runtime is meant for single-node hosting. It is the same `workerd` engine Cloudflare runs, but without edge caching or global replication.
