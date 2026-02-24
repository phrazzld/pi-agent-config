#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR="${PI_RUNTIME_DIR:-$HOME/.pi/agent}"
CONFIG_DIR="${PI_CONFIG_DIR:-$HOME/Development/pi-agent-config}"
ASSETS=(skills extensions prompts themes)

mkdir -p "$RUNTIME_DIR"

for asset in "${ASSETS[@]}"; do
  src="$CONFIG_DIR/$asset"
  dest="$RUNTIME_DIR/$asset"
  mkdir -p "$src"

  if [[ -L "$dest" ]] && [[ "$(readlink "$dest")" == "$src" ]]; then
    echo "ok: $dest -> $src"
    continue
  fi

  if [[ -e "$dest" ]] && [[ ! -L "$dest" ]]; then
    backup="${dest}.backup.$(date +%Y%m%d%H%M%S)"
    mv "$dest" "$backup"
    echo "backup: $dest -> $backup"
  elif [[ -L "$dest" ]]; then
    rm "$dest"
  fi

  ln -s "$src" "$dest"
  echo "link: $dest -> $src"
done

echo "done"
