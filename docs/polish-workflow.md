# Polish Workflow Architecture

## Goal

After CI passes and PR feedback is addressed, run one final quality pass so each merge leaves the codebase stronger:
- clearer abstractions
- tighter quality gates
- better docs
- higher confidence in safe iteration

## What ships now

1. **Prompt template:** `/polish` (`prompts/polish.md`)
   - execution-oriented command for post-review final pass
2. **Skill:** `pr-polish` (`skills/pr-polish/SKILL.md`)
   - reusable lane-based operating model (refactor, gates, docs, reliability)
3. **Comms upgrade:** `/respond` (`prompts/respond.md`)
   - stricter readability and formatting standards for GitHub comments/replies

## How it composes with existing stack

- `/respond` handles review triage/fix/reply loop
- `/polish` runs after `/respond` is complete and CI is green
- `subagent` extension can parallelize polish lanes when worthwhile
- `/squash-merge` remains the enforcement gate for merge readiness

## Recommended sequence

1. `/autopilot` or manual implementation flow
2. `/respond` (resolve review comments)
3. Re-run CI/local verification
4. `/polish`
5. `/squash-merge`

## Next possible enforcement upgrades (optional)

- Add a lightweight `/polish-report` extension command that appends a standardized PR comment artifact
- Add guardrail checks for missing docs/test updates on behavior-changing PRs
- Add trend tracking for repeated deferred polish items (`/pr-trends` integration)
