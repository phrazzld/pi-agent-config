---
description: Execute requested work with focused scope and verification
---
Task:
$@

Protocol:
1. Restate objective and assumptions in 3 lines max.
2. List behavior checklist before edits (happy path, edge cases, regressions).
3. For browser QA/UAT tasks, prefer repo-native smoke commands first (e.g. `pnpm qa:*`), then fallback to direct `agent-browser` flows.
4. If delegating to subagents, define success criteria + stop criteria up front. Prefer opinionated defaults over introducing extra runtime knobs unless absolutely required.
5. For security changes, explicitly check compatibility + observability tradeoffs.
6. Implement smallest safe patch.
7. Run focused verification first, then broader checks as needed.
8. Report changed files, test results, and residual risk.
