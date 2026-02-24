#!/usr/bin/env bash
set -euo pipefail

if command -v qmd >/dev/null 2>&1; then
  echo "qmd already installed: $(qmd --version)"
  exit 0
fi

if command -v npm >/dev/null 2>&1; then
  echo "Installing QMD via npm..."
  npm install -g @tobilu/qmd
elif command -v bun >/dev/null 2>&1; then
  echo "Installing QMD via bun..."
  bun install -g @tobilu/qmd
else
  echo "error: neither npm nor bun is available to install qmd" >&2
  exit 1
fi

echo "installed: $(qmd --version)"
