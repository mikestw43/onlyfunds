#!/bin/bash
# ============================================
# OnlyFunds — let a NAS pull the backups
#   bash /opt/onlyfunds/deploy/nas-setup.sh
#
# Makes an account on this server whose only ability is to read the
# backup folder, and installs the NAS's public key for it. The NAS
# pulls; this server never holds a key to the NAS.
#
# That direction matters. If this server pushed, anything that took it
# over could reach the NAS and delete the copies — which is the exact
# situation backups exist for.
# ============================================

set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/onlyfunds}"
BACKUP_DIR="$PROJECT_DIR/backups"
USER_NAME="${BACKUP_USER:-ofbackup}"

if [ "$(id -u)" != "0" ]; then
  echo "Run this as root:  sudo bash $0"
  exit 1
fi

echo "=============================="
echo "  A backup account for the NAS"
echo "=============================="
echo ""
echo "  On the NAS, in DSM:"
echo "    Control Panel → Terminal & SNMP → tick Enable SSH service"
echo "    then open a session and run:  ssh-keygen -t ed25519"
echo "    and show the result with:     cat ~/.ssh/id_ed25519.pub"
echo ""
echo "  Paste that line here (it starts with ssh-ed25519 and is one line)."
echo ""
read -rp "  Public key: " PUBKEY

case "$PUBKEY" in
  ssh-ed25519\ *|ssh-rsa\ *|ecdsa-*) ;;
  *) echo "  That does not look like a public key. Nothing was changed."; exit 1 ;;
esac

# The account: no password, no shell to log in with beyond rsync, and
# nothing on this machine it can reach except the backups.
if ! id "$USER_NAME" >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/sh "$USER_NAME"
  echo "  Created the account $USER_NAME"
else
  echo "  The account $USER_NAME is already here"
fi
passwd -l "$USER_NAME" >/dev/null 2>&1 || true

HOME_DIR=$(getent passwd "$USER_NAME" | cut -d: -f6)
install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "$HOME_DIR/.ssh"

# rrsync, where rsync ships it, confines the key to reading one folder:
# with it, that key cannot run anything else on this server, ever.
RRSYNC=""
for candidate in /usr/bin/rrsync /usr/share/rsync/scripts/rrsync /usr/local/bin/rrsync; do
  [ -x "$candidate" ] && RRSYNC="$candidate" && break
done
if [ -z "$RRSYNC" ] && [ -f /usr/share/doc/rsync/scripts/rrsync.gz ]; then
  gunzip -c /usr/share/doc/rsync/scripts/rrsync.gz > /usr/local/bin/rrsync
  chmod +x /usr/local/bin/rrsync
  RRSYNC=/usr/local/bin/rrsync
fi

OPTIONS='no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding'
if [ -n "$RRSYNC" ]; then
  LINE="command=\"$RRSYNC -ro $BACKUP_DIR\",$OPTIONS $PUBKEY"
  echo "  Using rrsync: that key can only read $BACKUP_DIR"
else
  LINE="$OPTIONS $PUBKEY"
  echo "  rrsync is not installed, so the key is restricted but not confined to one folder."
  echo "  Install it for the tighter setup:  apt install -y rsync"
fi

touch "$HOME_DIR/.ssh/authorized_keys"
grep -qF "$PUBKEY" "$HOME_DIR/.ssh/authorized_keys" || echo "$LINE" >> "$HOME_DIR/.ssh/authorized_keys"
chmod 600 "$HOME_DIR/.ssh/authorized_keys"
chown -R "$USER_NAME:$USER_NAME" "$HOME_DIR/.ssh"

# Let that account read the backups — including ones written later.
mkdir -p "$BACKUP_DIR"
if command -v setfacl >/dev/null 2>&1 || apt-get install -y acl >/dev/null 2>&1; then
  setfacl -m "u:$USER_NAME:rx" "$PROJECT_DIR" "$BACKUP_DIR"
  setfacl -m "u:$USER_NAME:r" "$BACKUP_DIR"/* 2>/dev/null || true
  setfacl -d -m "u:$USER_NAME:r" "$BACKUP_DIR"
  echo "  $USER_NAME can read the backup folder, and anything written into it later"
else
  chmod 755 "$PROJECT_DIR" "$BACKUP_DIR"
  echo "  acl is not available; the backup folder was made readable instead"
fi

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo ""
echo "=============================="
echo "  Done. On the NAS, the pull is:"
echo "=============================="
echo ""
if [ -n "$RRSYNC" ]; then
  echo "  rsync -az --delete -e ssh $USER_NAME@$IP:/ /volume1/backup/onlyfunds/"
else
  echo "  rsync -az --delete -e ssh $USER_NAME@$IP:$BACKUP_DIR/ /volume1/backup/onlyfunds/"
fi
echo ""
echo "  Run it once by hand on the NAS to accept the fingerprint, then put"
echo "  it in DSM → Control Panel → Task Scheduler as a daily user-defined"
echo "  script. deploy/README.md has the steps with the screens named."
echo ""
