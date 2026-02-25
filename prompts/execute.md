---
description: Execute requested work with focused scope and verification
---
Task:
$@

Protocol:
1. Restate objective and assumptions in 3 lines max.
2. List behavior checklist before edits (happy path, edge cases, regressions).
3. If delegating to subagents, define success criteria + stop criteria up front and set explicit budgets (`maxTurns`, `maxRuntimeSeconds`).
4. For security changes, explicitly check compatibility + observability tradeoffs.
5. Implement smallest safe patch.
6. Run focused verification first, then broader checks as needed.
7. Report changed files, test results, and residual risk.
