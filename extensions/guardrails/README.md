# Guardrails Extension

Adds:
- irreversible-command `bash` blocker (`rm`, `git rebase`, force-push/history-rewrite)
- post-edit fast feedback (`lint`/`typecheck`/`check` auto-detect)

Env:
- `PI_FAST_FEEDBACK_CMD` (override auto-detected check command)
- `PI_FAST_FEEDBACK_TIMEOUT_MS` (default `90000`)

Command:
- `/guardrails` to view active config
