#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR="${PI_RUNTIME_DIR:-$HOME/.pi/agent}"
CONFIG_DIR="${PI_CONFIG_DIR:-$HOME/Development/pi-agent-config}"
SRC_RUNTIME="$RUNTIME_DIR/settings.json"
SRC_CONFIG="$CONFIG_DIR/settings.json"

usage() {
  echo "usage: $0 pull|push"
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

mode="$1"

case "$mode" in
  pull)
    cp "$SRC_RUNTIME" "$SRC_CONFIG"
    echo "synced runtime -> repo: $SRC_CONFIG"
    ;;
  push)
    cp "$SRC_CONFIG" "$SRC_RUNTIME"
    echo "synced repo -> runtime: $SRC_RUNTIME"
    ;;
  *)
    usage
    exit 1
    ;;
esac
