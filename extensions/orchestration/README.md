# orchestration extension

Declarative team + pipeline execution with live dashboard visualization.

## Config source

Reads orchestration config from runtime agent directory:

- `~/.pi/agent/agents/teams.yaml`
- `~/.pi/agent/agents/pipelines.yaml`

(Uses `PI_CONFIG_DIR` / `PI_CODING_AGENT_DIR` when set.)

## Commands

- `/teams` — list teams
- `/pipelines` — list pipelines
- `/team <name> <goal> [--scope user|project|both] [--concurrency N]`
- `/pipeline <name> <goal> [--scope user|project|both]`
- `/orchestration` — refresh last dashboard snapshot

## Tools

- `team_run`
- `pipeline_run`

These enable LLM-driven orchestration while preserving dashboard visibility.

## UI

- Persistent dashboard widget (below editor) during runs
- Multi-card grid layout (responsive columns based on terminal width)
- Pipeline flow line (`agent -> agent -> agent`) with active step highlighted
- Per-agent cards with status, source, token/cost usage snippet, and output preview

## Scope notes

- Uses existing subagent agent discovery (`user`, `project`, `both`).
- Team runs execute members in parallel (bounded concurrency).
- Pipeline runs execute steps sequentially with `$INPUT` and `$ORIGINAL` substitution.
