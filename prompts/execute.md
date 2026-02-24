---
description: Execute requested work with focused scope and verification
---
Task:
$@

Protocol:
1. Restate objective and assumptions in 3 lines max.
2. List behavior checklist before edits (happy path, edge cases, regressions).
3. For security changes, explicitly check compatibility + observability tradeoffs.
4. Implement smallest safe patch.
5. Run focused verification first, then broader checks as needed.
6. Report changed files, test results, and residual risk.
