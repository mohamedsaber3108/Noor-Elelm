#!/usr/bin/env bash
# Create (or promote and reset the password of) an administrator account.
# Usage: sudo noor-create-admin <email> [display name]
# The password is read from the terminal; leave it blank to generate a strong one.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
EMAIL="${1:?usage: noor-create-admin <email> [name]}"
NAME="${2:-Admin}"
CUR=/opt/noor-al-ilm/current
DATA=/var/lib/noor-al-ilm
[[ -d "$CUR" ]] || { echo "Deploy the application first (sudo noor-deploy)." >&2; exit 1; }

PW="${ADMIN_PASSWORD:-}"
if [[ -z "$PW" && -t 0 ]]; then read -rsp "Password (min 10 chars, blank = generate): " PW; echo; fi
GENERATED=""
if [[ -z "$PW" ]]; then PW="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)"; GENERATED=1; fi
[[ ${#PW} -ge 10 ]] || { echo "Password must be at least 10 characters." >&2; exit 1; }

sql="$(sudo -u noor mktemp)"
trap 'rm -f "$sql"' EXIT
sudo -u noor env ADMIN_PASSWORD="$PW" node "$CUR/scripts/create-admin.mjs" "$EMAIL" - "$NAME" > "$sql"
systemctl stop noor-al-ilm
sudo -u noor -H env HOME="$DATA/home" CI=1 bash -c "cd '$CUR' && node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to '$DATA/state' --file '$sql'" >/dev/null
systemctl start noor-al-ilm
echo "Administrator ready: $EMAIL"
[[ -n "$GENERATED" ]] && echo "Generated password (change it at /account): $PW"
exit 0
