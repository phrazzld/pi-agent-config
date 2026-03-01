# visibility extension

Maximum-visibility runtime instrumentation for onboarding and workflow tuning.

## What it adds

- Persistent visibility widget (below editor) showing:
  - active model
  - run state (active/idle)
  - top tool usage (run + session)
  - top slash-command usage
  - runtime inventory counts (extension/prompt/skill commands + tools)
- Footer status summary via `ctx.ui.setStatus`
- End-of-run primitive summary message after every agent run
- Local NDJSON usage log: `~/.pi/agent/logs/primitive-usage.ndjson`

## Commands

- `/visibility` — print current primitive snapshot
- `/visibility on|off` — toggle live widget
- `/visibility config` — print active config resolution snapshot
- `/visibility-reset` — reset session counters

## Notes

- Skill usage is inferred when `read` targets a `*/SKILL.md` path.
- This extension is intentionally verbose and intended for onboarding / meta optimization sessions.
- Nested orchestration sessions (`PI_ORCH_DEPTH>0`) disable visibility telemetry by default.


## Environment

- `PI_VISIBILITY_LOG_MAX_BYTES` (default `10485760`)
- `PI_VISIBILITY_LOG_MAX_BACKUPS` (default `5`)
- `PI_VISIBILITY_LOG_ROTATE_CHECK_MS` (default `30000`)
- `PI_VISIBILITY_ENABLE_NESTED` (default `false`)
