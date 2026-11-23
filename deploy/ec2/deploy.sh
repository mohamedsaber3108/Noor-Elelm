#!/usr/bin/env bash
# Build a release from the server's deploy repository and activate it with a health check.
# Usage: sudo noor-deploy [git-ref]        (default: main)
#        sudo noor-deploy --rollback       (switch back to the previous release)
set -euo pipefail

APP_USER=noor
APP_ROOT=/opt/noor-al-ilm
DATA_DIR=/var/lib/noor-al-ilm
GIT_DIR="${GIT_DIR:-/srv/git/noor-al-ilm.git}"
SERVICE=noor-al-ilm
HEALTH_URL=http://127.0.0.1:8787/api/health
KEEP_RELEASES=3

[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }

as_app() { # run a command in a release directory as the service user
  local dir="$1"; shift
  sudo -u "$APP_USER" -H env HOME="$DATA_DIR/home" CI=1 SITES_PNPM_SHARED_STORE="$APP_ROOT/pnpm-store" \
    PATH="/usr/local/bin:/usr/bin:/bin" bash -c "cd '$dir' && $*"
}
healthy() {
  for _ in $(seq 1 45); do curl -fsS -m 3 "$HEALTH_URL" >/dev/null 2>&1 && return 0; sleep 2; done
  return 1
}
activate() { ln -sfn "$1" "$APP_ROOT/current.tmp" && mv -Tf "$APP_ROOT/current.tmp" "$APP_ROOT/current"; }

previous="$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)"

if [[ "${1:-}" == "--rollback" ]]; then
  target="$(ls -1dt "$APP_ROOT"/releases/*/ 2>/dev/null | sed 's:/$::' | grep -vx "$previous" | head -1 || true)"
  [[ -n "$target" ]] || { echo "No earlier release to roll back to." >&2; exit 1; }
  echo "==> Rolling back to $target"
  activate "$target"; systemctl restart "$SERVICE"
  healthy && { echo "Rollback healthy."; exit 0; } || { echo "Rollback unhealthy, see: journalctl -u $SERVICE" >&2; exit 1; }
fi

REF="${1:-main}"
git_() { git -c safe.directory="$GIT_DIR" --git-dir="$GIT_DIR" "$@"; }
sha="$(git_ rev-parse --verify "${REF}^{commit}")"
rel="$APP_ROOT/releases/$(date -u +%Y%m%d%H%M%S)-${sha:0:7}"

echo "==> Release ${sha:0:7} ($REF) -> $rel"
install -d -o "$APP_USER" -g "$APP_USER" "$rel"
git_ archive "$sha" | sudo -u "$APP_USER" tar -x -C "$rel"
echo "$sha" | sudo -u "$APP_USER" tee "$rel/REVISION" >/dev/null

echo "==> Install dependencies"
as_app "$rel" "pnpm install --frozen-lockfile --reporter=append-only" | tail -n 3
echo "==> Production build"
as_app "$rel" "pnpm build" | tail -n 2

echo "==> Backup and migrate (service paused)"
systemctl stop "$SERVICE" 2>/dev/null || true
/usr/local/sbin/noor-backup pre-deploy || true
as_app "$rel" "node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 migrations apply DB --local --config dist/server/wrangler.json --persist-to '$DATA_DIR/state'" \
  | grep -E 'No migrations|✅|ERROR|[0-9]{4}_' | tail -n 8 || true

echo "==> Activate"
activate "$rel"
systemctl start "$SERVICE"
if ! healthy; then
  echo "!! New release failed its health check." >&2
  if [[ -n "$previous" && -d "$previous" ]]; then
    echo "!! Restoring $previous" >&2
    activate "$previous"; systemctl restart "$SERVICE"; healthy || true
  fi
  journalctl -u "$SERVICE" -n 40 --no-pager >&2 || true
  exit 1
fi

echo "==> Prune old releases (keep $KEEP_RELEASES)"
current="$(readlink -f "$APP_ROOT/current")"
{ ls -1dt "$APP_ROOT"/releases/*/ | sed 's:/$::' | grep -vx "$current" || true; } | tail -n +"$KEEP_RELEASES" | xargs -r rm -rf

echo "==> Refresh server scripts from this release"
install -m 755 "$rel/deploy/ec2/deploy.sh" /usr/local/sbin/noor-deploy
install -m 755 "$rel/deploy/ec2/backup.sh" /usr/local/sbin/noor-backup
install -m 755 "$rel/deploy/ec2/create-admin.sh" /usr/local/sbin/noor-create-admin

echo "Deployed ${sha:0:7}: $(curl -fsS -m 3 "$HEALTH_URL")"
