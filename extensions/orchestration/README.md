# orchestration extension

Declarative team + pipeline execution with live dashboard visualization and adaptive execution guardrails.

## Config source

Prefers repo-local orchestration config when present:

- `<repo>/.pi/agents/teams.yaml`
- `<repo>/.pi/agents/pipelines.yaml`

Falls back to global runtime config:

- `~/.pi/agent/agents/teams.yaml`
- `~/.pi/agent/agents/pipelines.yaml`

(Uses `PI_CONFIG_DIR` / `PI_CODING_AGENT_DIR` when set.)

## Commands

- `/teams` — list teams
- `/pipelines` — list pipelines
- `/team <name> <goal> [--scope user|project|both] [--concurrency N] [--gov-mode observe|warn|enforce]`
- `/pipeline <name> <goal> [--scope user|project|both] [--gov-mode observe|warn|enforce]`
- `/orchestration` — refresh last dashboard snapshot
- `/orchestration-clear` — clear widget/status immediately
- `/orchestration-policy` — show admission policy limits/paths
- `/orchestration-circuit` — show live admission/circuit status

Governor overrides also support:
- `--gov-max-cost <usd>`
- `--gov-max-tokens <n>`
- `--gov-fuse-seconds <seconds>`

## Tools

- `team_run`
- `pipeline_run`

These enable LLM-driven orchestration while preserving dashboard visibility.
All orchestration tool paths are now protected by admission control and can fail closed
with structured error codes when limits are exceeded.

Idempotency behavior:
- repeated identical `team_run` / `pipeline_run` requests now compute an idempotency key
- if a matching run is already in-flight, admission deduplicates to the existing run lease instead of spawning another fan-out
- dedup outcomes are logged in admission telemetry (`deduped: true`)

## Adaptive governor (v1)

Execution uses progress-aware checks instead of short fixed runtime caps.

Modes:
- `observe` (never interrupts)
- `warn` (default)
- `enforce` (aborts on sustained low progress/tripwires)

Tripwires:
- loop detection
- retry churn
- optional cost/token budgets
- emergency fuse

Env knobs:
- `PI_ORCH_GOV_MODE`
- `PI_ORCH_GOV_CHECK_SECONDS`
- `PI_ORCH_GOV_WINDOW_SECONDS`
- `PI_ORCH_GOV_EMERGENCY_FUSE_SECONDS`
- `PI_ORCH_GOV_MAX_COST_USD`
- `PI_ORCH_GOV_MAX_TOKENS`

Admission knobs:
- `PI_ORCH_ADM_MAX_RUNS`
- `PI_ORCH_ADM_MAX_SLOTS`
- `PI_ORCH_ADM_MAX_DEPTH`
- `PI_ORCH_ADM_BREAKER_COOLDOWN_MS`
- `PI_ORCH_ADM_GAP_MAX`
- `PI_ORCH_ADM_GAP_RESET_QUIET_MS`
- `PI_ORCH_ADM_RUN_TTL_MS`
- `PI_ORCH_ADM_SLOT_TTL_MS`
- `PI_ORCH_ADM_STATE_PATH`
- `PI_ORCH_ADM_EVENT_LOG_PATH`
- `PI_ORCH_ADM_EVENT_LOG_MAX_BYTES`
- `PI_ORCH_ADM_EVENT_LOG_MAX_BACKUPS`
- `PI_ORCH_ADM_EVENT_LOG_ROTATE_CHECK_MS`
- `PI_ORCH_ADM_PRESSURE_LOG_PATH`

## UI

- Dashboard widget renders above editor during runs
- Auto-clears after completion (plus manual clear command)
- Multi-card grid layout (responsive columns based on terminal width)
- Pipeline flow line (`agent -> agent -> agent`) with active step highlighted
- Per-agent cards with status, source, usage, governor state (when relevant), and output preview

## Scope notes

- Uses existing subagent agent discovery (`user`, `project`, `both`).
- Team runs execute members in parallel (bounded concurrency).
- Pipeline runs execute steps sequentially with `$INPUT` and `$ORIGINAL` substitution.
