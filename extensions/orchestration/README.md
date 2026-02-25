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

Governor overrides also support:
- `--gov-max-cost <usd>`
- `--gov-max-tokens <n>`
- `--gov-fuse-seconds <seconds>`

## Tools

- `team_run`
- `pipeline_run`

These enable LLM-driven orchestration while preserving dashboard visibility.

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
