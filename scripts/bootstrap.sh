#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR="${PI_RUNTIME_DIR:-$HOME/.pi/agent}"
CONFIG_DIR="${PI_CONFIG_DIR:-$HOME/Development/pi-agent-config}"
ASSETS=(skills extensions agents prompts themes)
GLOBAL_CONTEXT_LINKS=("context/global/AGENTS.md:AGENTS.md")

mkdir -p "$RUNTIME_DIR"

link_path() {
  local src="$1"
  local dest="$2"

  if [[ -L "$dest" ]] && [[ "$(readlink "$dest")" == "$src" ]]; then
    echo "ok: $dest -> $src"
    return
  fi

  if [[ -e "$dest" ]] && [[ ! -L "$dest" ]]; then
    local backup
    backup="${dest}.backup.$(date +%Y%m%d%H%M%S)"
    mv "$dest" "$backup"
    echo "backup: $dest -> $backup"
  elif [[ -L "$dest" ]]; then
    unlink "$dest"
  fi

  ln -s "$src" "$dest"
  echo "link: $dest -> $src"
}

for asset in "${ASSETS[@]}"; do
  src="$CONFIG_DIR/$asset"
  dest="$RUNTIME_DIR/$asset"
  mkdir -p "$src"
  link_path "$src" "$dest"
done

for mapping in "${GLOBAL_CONTEXT_LINKS[@]}"; do
  src_rel="${mapping%%:*}"
  dest_rel="${mapping##*:}"
  src="$CONFIG_DIR/$src_rel"
  dest="$RUNTIME_DIR/$dest_rel"

  if [[ ! -f "$src" ]]; then
    echo "skip: missing $src"
    continue
  fi

  link_path "$src" "$dest"
done

echo "done"
