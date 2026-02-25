# Guardrails Extension

Adds:
- irreversible-command `bash` blocker (`rm`, `git rebase`, force-push/history-rewrite)
- blocks direct `gh pr merge` (forces `/squash-merge` readiness gate path)
- post-edit fast feedback (`lint`/`typecheck`/`check` auto-detect)
- PR metadata guardrails:
  - blocks inline GitHub write bodies (`gh pr|issue ... --body/-b`) and requires `--body-file/-F`
  - auto-lints and auto-fixes malformed PR title/body after successful PR create/edit
  - strips escaped newlines / log-noise artifacts from PR descriptions
- `/pr` completion gate:
  - when `/pr` is invoked, guardrails verifies a PR exists for the current branch before treating flow as complete
  - if missing, injects a follow-up instruction to create/update PR and report URL
- repository scope guardrail:
  - read/write/edit and `bash` commands that `cd` outside the current cwd require explicit confirmation
  - approvals are remembered per external repo scope for the current session
- local PR governance trend logging (`logs/pr-governance.ndjson`)

Env:
- `PI_FAST_FEEDBACK_CMD` (override auto-detected check command)
- `PI_FAST_FEEDBACK_TIMEOUT_MS` (default `90000`)
- `PI_PR_GOVERNANCE_AUTOFIX` (default `true`)
- `PI_PR_LINT_TIMEOUT_MS` (default `120000`)
- `PI_PR_TITLE_MAX_CHARS` (default `72`)
- `PI_EXTERNAL_SCOPE_GUARD` (default `true`; set `false` to disable external-path confirmations)

Commands:
- `/guardrails` to view active config
- `/pr-lint` to lint/fix current PR metadata on demand
- `/pr-trends [limit]` to summarize local governance trend logs
- `/review-policy` to display reviewer severity policy matrix
