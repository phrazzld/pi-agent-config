# Pi Extension Testing (Lightweight Harness)

This repo treats extensions as production code: small programs with real side effects.

## Why this matters

Pi extensions run with full system permissions and can execute arbitrary code, so they need the same robustness standards as application code.

Reference: Pi extensions docs —
- https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md

## Recommended baseline

1. **Pure logic separated from runtime hooks**
   - Keep parsing/classification/decision logic in testable modules.
   - Keep `registerTool` and event handlers thin.

2. **Unit tests per extension**
   - Place tests under `extensions/<name>/__tests__/*.test.ts`.
   - Use focused tests for parser rules, gating policies, and argument handling.

3. **Fast local test entrypoint**
   - Run all extension tests with:

```bash
./scripts/test-extensions.sh
```

4. **Behavioral smoke checks for high-risk tools**
   - Validate dangerous-path handling (block/confirm/fail-safe).
   - Validate subprocess failures and abort behavior.

5. **Document operating constraints in README**
   - Inputs, limits, failure modes, and safety defaults.

## What to test first in this repo

- Merge/readiness policy decisions
- Subagent discovery + scope rules (user/project/both)
- Prompt/argument parsing for workflow commands
- Any regex/policy logic that can silently miss critical findings

## Optional next step (when ready)

Use the Pi SDK to add integration tests that exercise extension behavior in-memory (`createAgentSession`) while keeping the harness lightweight.

Reference:
- https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md
