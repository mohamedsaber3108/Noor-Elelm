#!/usr/bin/env bash
# Online-safe backup of the SQLite files behind the local D1 database.
# Usage: sudo noor-backup [label]      Keeps KEEP_DAYS (default 14) days of backups in /var/backups/noor-al-ilm.
# Restore: stop the service, gunzip the "-d1" file over the matching *.sqlite in the state dir,
#          delete the -wal/-shm files next to it, chown noor:noor, start the service.
set -euo pipefail
STATE=/var/lib/noor-al-ilm/state/v3/d1/miniflare-D1DatabaseObject
OUT=/var/backups/noor-al-ilm
LABEL="${1:-manual}"
KEEP_DAYS="${KEEP_DAYS:-14}"

shopt -s nullglob
dbs=("$STATE"/*.sqlite)
[[ ${#dbs[@]} -gt 0 ]] || { echo "No database yet, nothing to back up."; exit 0; }
ts="$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "$OUT"
for db in "${dbs[@]}"; do
  base="$(basename "$db" .sqlite)"
  kind=d1; [[ "$base" == metadata ]] && kind=metadata
  dest="$OUT/${ts}-${LABEL}-${kind}-${base:0:12}.sqlite"
  sqlite3 "$db" ".backup '$dest'"
  gzip -f "$dest"
done
find "$OUT" -name '*.sqlite.gz' -mtime +"$KEEP_DAYS" -delete
echo "Backup written: $OUT/${ts}-${LABEL}-*"
