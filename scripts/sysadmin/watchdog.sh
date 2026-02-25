#!/usr/bin/env bash
set -euo pipefail

INTERVAL_SECONDS="${PI_SYSADMIN_INTERVAL_SECONDS:-15}"
WARN_NODE_COUNT="${PI_SYSADMIN_WARN_NODE_COUNT:-120}"
CRITICAL_NODE_COUNT="${PI_SYSADMIN_CRITICAL_NODE_COUNT:-260}"
WARN_NODE_RSS_MB="${PI_SYSADMIN_WARN_NODE_RSS_MB:-16384}"
CRITICAL_NODE_RSS_MB="${PI_SYSADMIN_CRITICAL_NODE_RSS_MB:-32768}"
ALERT_COOLDOWN_SECONDS="${PI_SYSADMIN_ALERT_COOLDOWN_SECONDS:-60}"
LOG_PATH="${PI_SYSADMIN_LOG_PATH:-$HOME/.pi/agent/logs/sysadmin-watchdog.ndjson}"
ENABLE_NOTIFICATIONS="${PI_SYSADMIN_ENABLE_NOTIFICATIONS:-true}"
ENABLE_STDOUT="${PI_SYSADMIN_ENABLE_STDOUT:-false}"

LOG_MAX_BYTES="${PI_SYSADMIN_LOG_MAX_BYTES:-10485760}"     # 10MB
LOG_MAX_BACKUPS="${PI_SYSADMIN_LOG_MAX_BACKUPS:-5}"
LOG_ROTATE_CHECK_SECONDS="${PI_SYSADMIN_LOG_ROTATE_CHECK_SECONDS:-60}"
EXTRA_LOG_PATHS="${PI_SYSADMIN_EXTRA_LOG_PATHS:-$HOME/.pi/agent/logs/sysadmin-watchdog.launchd.out.log:$HOME/.pi/agent/logs/sysadmin-watchdog.launchd.err.log}"

mkdir -p "$(dirname "$LOG_PATH")"

last_alert_epoch=0
last_rotate_check_epoch=0

node_snapshot() {
  ps -axo rss=,comm= | awk '
    $2 ~ /(^|\/)node$/ { count += 1; rss_kb += $1 }
    END { printf "%d %.0f\n", count, rss_kb / 1024 }
  '
}

top_nodes() {
  ps -axo pid=,rss=,comm= | awk '$3 ~ /(^|\/)node$/ { printf "%s:%dMB ", $1, int($2/1024) }' | sed 's/[[:space:]]*$//'
}

file_size_bytes() {
  local file_path="$1"
  stat -f%z "$file_path" 2>/dev/null || echo 0
}

rotate_log_if_needed() {
  local file_path="$1"
  local max_bytes="$2"
  local max_backups="$3"

  [[ -f "$file_path" ]] || return 0

  local size
  size="$(file_size_bytes "$file_path")"
  [[ "$size" =~ ^[0-9]+$ ]] || size=0

  if (( size < max_bytes )); then
    return 0
  fi

  local i
  for (( i=max_backups; i>=1; i-- )); do
    local source
    local destination

    if (( i == 1 )); then
      source="$file_path"
    else
      source="$file_path.$((i-1))"
    fi
    destination="$file_path.$i"

    if (( i == max_backups )) && [[ -f "$destination" ]]; then
      /usr/bin/unlink "$destination" >/dev/null 2>&1 || true
    fi

    if [[ -f "$source" ]]; then
      mv "$source" "$destination"
    fi
  done
}

rotate_logs_if_needed() {
  local now_epoch="$1"
  if (( now_epoch - last_rotate_check_epoch < LOG_ROTATE_CHECK_SECONDS )); then
    return 0
  fi
  last_rotate_check_epoch="$now_epoch"

  rotate_log_if_needed "$LOG_PATH" "$LOG_MAX_BYTES" "$LOG_MAX_BACKUPS"

  local old_ifs="$IFS"
  IFS=':'
  for extra_path in $EXTRA_LOG_PATHS; do
    [[ -n "$extra_path" ]] || continue
    rotate_log_if_needed "$extra_path" "$LOG_MAX_BYTES" "$LOG_MAX_BACKUPS"
  done
  IFS="$old_ifs"
}

while true; do
  now_epoch="$(date +%s)"
  now_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  rotate_logs_if_needed "$now_epoch"

  read -r node_count node_rss_mb < <(node_snapshot)
  top_node_summary="$(top_nodes)"

  severity="ok"
  reasons=()

  if (( node_count >= CRITICAL_NODE_COUNT )); then
    severity="critical"
    reasons+=("node_count>=${CRITICAL_NODE_COUNT}")
  elif (( node_count >= WARN_NODE_COUNT )); then
    severity="warn"
    reasons+=("node_count>=${WARN_NODE_COUNT}")
  fi

  if (( node_rss_mb >= CRITICAL_NODE_RSS_MB )); then
    severity="critical"
    reasons+=("node_rss_mb>=${CRITICAL_NODE_RSS_MB}")
  elif (( node_rss_mb >= WARN_NODE_RSS_MB )) && [[ "$severity" != "critical" ]]; then
    severity="warn"
    reasons+=("node_rss_mb>=${WARN_NODE_RSS_MB}")
  fi

  reason_text="${reasons[*]:-none}"

  printf '{"ts":"%s","severity":"%s","nodeCount":%d,"nodeRssMb":%d,"reasons":"%s","topNodes":"%s"}\n' \
    "$now_iso" "$severity" "$node_count" "$node_rss_mb" "$reason_text" "$top_node_summary" \
    >> "$LOG_PATH"

  if [[ "$severity" != "ok" ]]; then
    if (( now_epoch - last_alert_epoch >= ALERT_COOLDOWN_SECONDS )); then
      last_alert_epoch="$now_epoch"
      if [[ "$ENABLE_STDOUT" == "true" || -t 1 ]]; then
        echo "[$now_iso] sysadmin-watchdog $severity nodeCount=$node_count nodeRssMb=$node_rss_mb reasons=$reason_text"
      fi

      if [[ "$ENABLE_NOTIFICATIONS" == "true" ]]; then
        message="node=$node_count rss=${node_rss_mb}MB $reason_text"
        osascript -e "display notification \"$message\" with title \"Pi Sysadmin Watchdog\"" >/dev/null 2>&1 || true
      fi
    fi
  fi

  sleep "$INTERVAL_SECONDS"
done
