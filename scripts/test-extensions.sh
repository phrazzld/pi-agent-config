#!/usr/bin/env bash
set -euo pipefail

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun is required to run extension tests." >&2
  echo "install: https://bun.sh" >&2
  exit 1
fi

TEST_FILES=()
while IFS= read -r test_file; do
  TEST_FILES+=("$test_file")
done < <(find extensions -type f -path '*/__tests__/*.test.ts' | sort)

if [[ ${#TEST_FILES[@]} -eq 0 ]]; then
  echo "No extension tests found under extensions/**/__tests__/*.test.ts"
  exit 0
fi

echo "Running ${#TEST_FILES[@]} extension test file(s)..."
bun test "${TEST_FILES[@]}"
