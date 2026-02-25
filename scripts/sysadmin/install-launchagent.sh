#!/usr/bin/env bash
set -euo pipefail

LABEL="com.phaedrus.pi.sysadmin-watchdog"
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/watchdog.sh"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"

mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${SCRIPT_PATH}</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PI_SYSADMIN_ENABLE_STDOUT</key>
    <string>false</string>
    <key>PI_SYSADMIN_LOG_MAX_BYTES</key>
    <string>10485760</string>
    <key>PI_SYSADMIN_LOG_MAX_BACKUPS</key>
    <string>5</string>
    <key>PI_SYSADMIN_LOG_ROTATE_CHECK_SECONDS</key>
    <string>60</string>
  </dict>

  <key>StandardOutPath</key>
  <string>$HOME/.pi/agent/logs/sysadmin-watchdog.launchd.out.log</string>

  <key>StandardErrorPath</key>
  <string>$HOME/.pi/agent/logs/sysadmin-watchdog.launchd.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$UID" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$PLIST_PATH"
launchctl enable "gui/$UID/${LABEL}"
launchctl kickstart -k "gui/$UID/${LABEL}"

echo "Installed and started: ${LABEL}"
echo "Plist: $PLIST_PATH"
echo "Script: $SCRIPT_PATH"
