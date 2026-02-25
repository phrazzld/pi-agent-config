#!/usr/bin/env bash
set -euo pipefail

LABEL="com.phaedrus.pi.sysadmin-watchdog"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"

launchctl bootout "gui/$UID" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl disable "gui/$UID/${LABEL}" >/dev/null 2>&1 || true

if [[ -f "$PLIST_PATH" ]]; then
  mv "$PLIST_PATH" "$PLIST_PATH.disabled.$(date +%s)"
fi

echo "Stopped ${LABEL}."
