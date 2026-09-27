#!/bin/bash
# ============================================
# OnlyFunds — everything needed to rebuild this server
#   bash /opt/onlyfunds/deploy/backup.sh
#
# Run nightly by cron (installed by setup.sh) and before every deploy.
# Keeps the last 14 sets. A NAS or anything else can pull the folder;
# see deploy/nas-setup.sh.
# ============================================

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/onlyfunds}"
DB_FILE="$PROJECT_DIR/backend/onlyfunds.db"
UPLOAD_DIR="$PROJECT_DIR/uploads"
ENV_FILE="$PROJECT_DIR/backend/.env"
BACKUP_DIR="$PROJECT_DIR/backups"
KEEP="${KEEP:-14}"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$DB_FILE" ]; then
  echo "[backup] No database at $DB_FILE — nothing to do."
  exit 0
fi

STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/onlyfunds-$STAMP.db"

# .backup is safe on a live database — unlike copying the file.
sqlite3 "$DB_FILE" ".backup '$OUT'"
gzip -f "$OUT"
echo "[backup] Wrote $OUT.gz"

# The EA repository stores its files on disk with only their paths in the
# database, so a database-only backup restores rows pointing at nothing.
if [ -d "$UPLOAD_DIR" ] && [ -n "$(ls -A "$UPLOAD_DIR" 2>/dev/null)" ]; then
  FILES_OUT="$BACKUP_DIR/uploads-$STAMP.tar.gz"
  tar -czf "$FILES_OUT" -C "$PROJECT_DIR" uploads
  echo "[backup] Wrote $FILES_OUT"
fi

# The settings file, which is the part nobody thinks about until a
# restore. ENCRYPTION_KEY lives in here: without the same one, every
# Telegram token and AI key in the restored database is unreadable
# ciphertext, and the database alone is not a backup of anything.
#
# It is also the one file here worth stealing, so it goes out at 600 and
# the folder is only readable by the backup account.
if [ -f "$ENV_FILE" ]; then
  ENV_OUT="$BACKUP_DIR/env-$STAMP.txt"
  cp "$ENV_FILE" "$ENV_OUT"
  chmod 600 "$ENV_OUT"
  # 600 alone means the puller cannot read it, and the one file a restore
  # cannot do without is the one that never leaves the machine. The folder's
  # default ACL does not save it either: chmod resets the mask to the group
  # bits, so the inherited entry comes out "#effective:---". Name the backup
  # account explicitly and set the mask with it.
  BACKUP_USER="${BACKUP_USER:-ofbackup}"
  if id "$BACKUP_USER" >/dev/null 2>&1 && command -v setfacl >/dev/null 2>&1; then
    setfacl -m "u:$BACKUP_USER:r,g::---,m::r" "$ENV_OUT" 2>/dev/null \
      && echo "[backup] $BACKUP_USER may read $ENV_OUT" \
      || echo "[backup] WARNING: could not grant $BACKUP_USER read on $ENV_OUT"
  fi
  echo "[backup] Wrote $ENV_OUT"
fi

# What the newest set is called, so a puller does not have to guess or
# sort filenames, and a person can see at a glance whether last night
# actually ran.
{
  echo "stamp=$STAMP"
  echo "written=$(date -Is)"
  echo "host=$(hostname)"
  echo "db=onlyfunds-$STAMP.db.gz"
  [ -f "$BACKUP_DIR/uploads-$STAMP.tar.gz" ] && echo "uploads=uploads-$STAMP.tar.gz"
  [ -f "$BACKUP_DIR/env-$STAMP.txt" ] && echo "env=env-$STAMP.txt"
  echo "size=$(du -sh "$BACKUP_DIR" | cut -f1)"
} > "$BACKUP_DIR/latest.txt"

# Keep only the newest $KEEP of each.
# Same trap as before: with fewer than $KEEP the pipeline yields nothing
# and would abort the script on its last line, so cron would log a
# failure nightly.
for pattern in 'onlyfunds-*.db.gz' 'uploads-*.tar.gz' 'env-*.txt'; do
  # shellcheck disable=SC2086
  ls -1t "$BACKUP_DIR"/$pattern 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f || true
done
