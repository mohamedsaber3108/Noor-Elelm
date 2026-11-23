#!/usr/bin/env bash
# One-time preparation of an Ubuntu 24.04+ host (x86_64 or arm64) for NOOR AL-ILM.
# Run from this directory as a sudo-capable user (e.g. `ubuntu`). Safe to re-run.
set -euo pipefail

NODE_MAJOR="${NODE_MAJOR:-22}"
PNPM_VERSION="${PNPM_VERSION:-11.25.0}"
APP_USER=noor
APP_ROOT=/opt/noor-al-ilm
DATA_DIR=/var/lib/noor-al-ilm
BACKUP_DIR=/var/backups/noor-al-ilm
GIT_DIR=/srv/git/noor-al-ilm.git
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> System packages"
sudo apt-get update -y -q
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q ca-certificates curl git nginx sqlite3 xz-utils openssl certbot python3-certbot-nginx

echo "==> Swap (builds need headroom on small instances)"
if ! swapon --show | grep -q .; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "==> Node.js ${NODE_MAJOR}.x (official build, checksum verified)"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" != "$NODE_MAJOR" ]]; then
  case "$(uname -m)" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; *) echo "Unsupported CPU $(uname -m)" >&2; exit 1 ;; esac
  base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  tmp="$(mktemp -d)"
  curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  file="$(grep -oE "node-v[0-9.]+-linux-${arch}\.tar\.xz" "$tmp/SHASUMS256.txt" | head -1)"
  curl -fsSL "$base/$file" -o "$tmp/$file"
  (cd "$tmp" && grep " ${file}\$" SHASUMS256.txt | sha256sum -c --quiet -)
  sudo tar -xJf "$tmp/$file" -C /usr/local --strip-components=1 --exclude CHANGELOG.md --exclude LICENSE --exclude README.md
  rm -rf "$tmp"
fi
echo "node $(node -v)"

echo "==> pnpm ${PNPM_VERSION}"
[[ "$(pnpm -v 2>/dev/null || true)" == "$PNPM_VERSION" ]] || sudo npm install -g "pnpm@${PNPM_VERSION}" --no-audit --no-fund --loglevel=error
echo "pnpm $(pnpm -v)"

echo "==> Service user, directories, deploy repository"
id -u "$APP_USER" >/dev/null 2>&1 || sudo useradd --system --home-dir "$APP_ROOT" --shell /usr/sbin/nologin "$APP_USER"
sudo install -d -o "$APP_USER" -g "$APP_USER" -m 755 "$APP_ROOT" "$APP_ROOT/releases" "$APP_ROOT/pnpm-store"
sudo install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$DATA_DIR" "$DATA_DIR/state" "$DATA_DIR/home"
sudo install -d -o root -g root -m 700 "$BACKUP_DIR"
sudo install -d -o "$USER" -g "$USER" -m 755 "$(dirname "$GIT_DIR")"
[[ -d "$GIT_DIR" ]] || git init --bare -q --initial-branch=main "$GIT_DIR"

echo "==> Scripts, systemd unit, nginx site, backup schedule"
sudo install -m 755 "$HERE/deploy.sh" /usr/local/sbin/noor-deploy
sudo install -m 755 "$HERE/backup.sh" /usr/local/sbin/noor-backup
sudo install -m 755 "$HERE/create-admin.sh" /usr/local/sbin/noor-create-admin
sudo install -m 644 "$HERE/noor-al-ilm.service" /etc/systemd/system/noor-al-ilm.service
if [[ ! -f /etc/nginx/sites-available/noor-al-ilm ]] || ! grep -q 'managed by certbot' /etc/nginx/sites-available/noor-al-ilm; then
  # Do not overwrite a site that certbot has already extended with HTTPS.
  sudo install -m 644 "$HERE/nginx-noor-al-ilm.conf" /etc/nginx/sites-available/noor-al-ilm
fi
sudo ln -sfn /etc/nginx/sites-available/noor-al-ilm /etc/nginx/sites-enabled/noor-al-ilm
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t -q && sudo systemctl reload nginx
echo "15 3 * * * root /usr/local/sbin/noor-backup daily >>/var/log/noor-backup.log 2>&1" | sudo tee /etc/cron.d/noor-al-ilm-backup >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable -q noor-al-ilm

echo
echo "Server ready. Next: push code to ${USER}@<host>:${GIT_DIR} and run: sudo noor-deploy main"
