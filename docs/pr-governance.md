# PR Governance Guardrails

## What is enforced in code

1. `gh pr create/edit --body/-b` is blocked.
   - Use `--body-file/-F` only.
2. After successful `gh pr create/edit`, PR metadata is auto-linted.
3. Malformed title/body is auto-fixed (`gh pr edit`) when autofix is enabled.
4. Direct `gh pr merge` is blocked.
   - Use `/squash-merge` so merge readiness checks run.
5. `/squash-merge` blocks actionable `critical/high` findings by default, including bot findings.

## Commands

- `/pr-lint` — lint/fix current PR metadata on demand
- `/pr-trends [limit]` — summarize local PR governance trend logs
- `/review-policy` — print reviewer severity policy matrix
- `/squash-merge` — merge with readiness checks

## Local trend log

- Path: `~/.pi/agent/logs/pr-governance.ndjson`
- Event kinds:
  - `pr_metadata_lint`
  - `review_gate`

This log is local-first and can be indexed by memory ingestion for trend reflection.

## Environment

- `PI_PR_GOVERNANCE_AUTOFIX` (default `true`)
- `PI_PR_LINT_TIMEOUT_MS` (default `120000`)
- `PI_PR_TITLE_MAX_CHARS` (default `72`)
- `PI_PR_GOV_LOG_MAX_BYTES` (default `5242880`)
- `PI_PR_GOV_LOG_MAX_BACKUPS` (default `5`)
- `PI_PR_GOV_LOG_ROTATE_CHECK_MS` (default `30000`)
