#!/bin/bash
# ============================================
# OnlyFunds — put a backup back
#   bash /opt/onlyfunds/deploy/restore.sh            (the newest set)
#   bash /opt/onlyfunds/deploy/restore.sh 20260927-030001
#
# A backup nobody has ever restored is not a backup. This is the other
# half, and it is worth running once on purpose while nothing is wrong.
# ============================================

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/onlyfunds}"
BACKUP_DIR="$PROJECT_DIR/backups"
DB_FILE="$PROJECT_DIR/backend/onlyfunds.db"
ENV_FILE="$PROJECT_DIR/backend/.env"

STAMP="${1:-}"
if [ -z "$STAMP" ]; then
  if [ -f "$BACKUP_DIR/latest.txt" ]; then
    STAMP=$(grep '^stamp=' "$BACKUP_DIR/latest.txt" | cut -d= -f2)
  else
    STAMP=$(ls -1t "$BACKUP_DIR"/onlyfunds-*.db.gz 2>/dev/null | head -1 | sed 's/.*onlyfunds-\(.*\)\.db\.gz/\1/')
  fi
fi

DB_BACKUP="$BACKUP_DIR/onlyfunds-$STAMP.db.gz"
if [ ! -f "$DB_BACKUP" ]; then
  echo "No backup called $STAMP. What is here:"
  ls -1t "$BACKUP_DIR"/onlyfunds-*.db.gz 2>/dev/null | sed 's/.*onlyfunds-/  /' | sed 's/\.db\.gz//' | head -20
  exit 1
fi

echo "=============================="
echo "  Restoring $STAMP"
echo "=============================="
echo "  This replaces the database now on this server."
read -rp "  Type yes to go ahead: " answer
[ "$answer" = "yes" ] || { echo "  Nothing changed."; exit 0; }

# Whatever is there now goes somewhere recoverable first. A restore that
# turns out to be the wrong night is a mistake to be able to undo.
if [ -f "$DB_FILE" ]; then
  ASIDE="$BACKUP_DIR/before-restore-$(date +%Y%m%d-%H%M%S).db"
  sqlite3 "$DB_FILE" ".backup '$ASIDE'" && gzip -f "$ASIDE"
  echo "[restore] The current database was saved as $ASIDE.gz"
fi

pm2 stop onlyfunds-api >/dev/null 2>&1 || true

gunzip -c "$DB_BACKUP" > "$DB_FILE"
echo "[restore] Database restored"

UPLOADS="$BACKUP_DIR/uploads-$STAMP.tar.gz"
if [ -f "$UPLOADS" ]; then
  tar -xzf "$UPLOADS" -C "$PROJECT_DIR"
  echo "[restore] Uploaded files restored"
fi

ENV_BACKUP="$BACKUP_DIR/env-$STAMP.txt"
if [ -f "$ENV_BACKUP" ]; then
  if [ -f "$ENV_FILE" ] && ! cmp -s "$ENV_BACKUP" "$ENV_FILE"; then
    cp "$ENV_FILE" "$ENV_FILE.before-restore"
    echo "[restore] The settings file differs; the current one is at .env.before-restore"
  fi
  cp "$ENV_BACKUP" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "[restore] Settings restored — ENCRYPTION_KEY matches this database again"
fi

pm2 start onlyfunds-api >/dev/null 2>&1 || pm2 restart onlyfunds-api >/dev/null 2>&1 || true

echo ""
echo "=============================="
echo "  Done. Open the site and check."
echo "=============================="
