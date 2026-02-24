#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE_ROOT="${1:-$ROOT_DIR/docs/examples/context-cascade}"
GLOBAL_DIR="$FIXTURE_ROOT/global"
REPO_DIR="$FIXTURE_ROOT/repo"

load_context_file_from_dir() {
  local dir="$1"
  if [[ -f "$dir/AGENTS.md" ]]; then
    printf '%s\n' "$dir/AGENTS.md"
    return 0
  fi
  if [[ -f "$dir/CLAUDE.md" ]]; then
    printf '%s\n' "$dir/CLAUDE.md"
    return 0
  fi
  return 1
}

normalize_path() {
  local target="$1"
  if [[ "$target" == "$FIXTURE_ROOT"* ]]; then
    printf '%s\n' "${target#"$FIXTURE_ROOT"/}"
  else
    printf '%s\n' "$target"
  fi
}

already_listed() {
  local needle="$1"
  local haystack="$2"
  if [[ -z "$haystack" ]]; then
    return 1
  fi
  printf '%s' "$haystack" | grep -F -x -q -- "$needle"
}

discover_context_files() {
  local cwd="$1"
  local ordered=""
  local ancestor_ordered=""

  local global_file=""
  if global_file="$(load_context_file_from_dir "$GLOBAL_DIR")"; then
    ordered="$global_file"$'\n'
  fi

  local current="$cwd"
  while true; do
    local context_file=""
    if context_file="$(load_context_file_from_dir "$current")"; then
      if ! already_listed "$context_file" "$ordered$ancestor_ordered"; then
        ancestor_ordered="$context_file"$'\n'$ancestor_ordered
      fi
    fi

    # Fixture validation intentionally stops at fixture repo root for deterministic output.
    if [[ "$current" == "$REPO_DIR" ]]; then
      break
    fi

    local parent
    parent="$(cd "$current/.." && pwd)"
    if [[ "$parent" == "$current" ]]; then
      break
    fi
    current="$parent"
  done

  printf '%s' "$ordered$ancestor_ordered"
}

if [[ ! -d "$FIXTURE_ROOT" ]]; then
  echo "fixture root not found: $FIXTURE_ROOT" >&2
  exit 1
fi

if [[ ! -d "$REPO_DIR" ]]; then
  echo "fixture repo not found: $REPO_DIR" >&2
  exit 1
fi

print_scenario() {
  local name="$1"
  local cwd="$2"

  echo "=== Scenario: $name ==="
  echo "cwd: $(normalize_path "$cwd")"

  local output
  output="$(discover_context_files "$cwd")"

  local index=0
  while IFS= read -r file; do
    if [[ -z "$file" ]]; then
      continue
    fi
    index=$((index + 1))
    echo "$index. $(normalize_path "$file")"
  done <<< "$output"

  if [[ "$index" -eq 0 ]]; then
    echo "(no context files found)"
  fi

  echo
}

print_scenario "repo root" "$REPO_DIR"
print_scenario "lib subtree" "$REPO_DIR/lib"
print_scenario "components subtree" "$REPO_DIR/lib/components"
