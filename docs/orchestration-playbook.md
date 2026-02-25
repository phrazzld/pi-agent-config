# Teams + Pipelines Playbook (Current State)

## Status

This repo now has:
- reusable specialist agents in `agents/*.md`
- `subagent` delegation primitives (`single`, `parallel`, `chain`)
- declarative orchestration config:
  - `agents/teams.yaml`
  - `agents/pipelines.yaml`
- executable orchestration extension:
  - `extensions/orchestration/index.ts`
  - commands: `/teams`, `/pipelines`, `/team`, `/pipeline`
  - tools: `team_run`, `pipeline_run`
  - live dashboard widget for team cards + pipeline graph

## Team execution

```text
/team <team-name> <goal>
```

Behavior:
- resolves team members from `teams.yaml`
- discovers agents via `user|project|both` scope
- runs members in parallel (bounded concurrency)
- updates dashboard cards with status, usage, and output preview

## Pipeline execution

```text
/pipeline <pipeline-name> <goal>
```

Behavior:
- resolves ordered steps from `pipelines.yaml`
- executes sequentially
- supports `$INPUT` (previous step output) and `$ORIGINAL` (initial goal)
- renders flow line with active step highlighted

## Current specialist roster

Core delivery:
- `scout`, `planner`, `plan-reviewer`, `worker`, `reviewer`, `red-team`, `documenter`
- grooming specialists: `groom-strategist`, `groom-researcher`, `groom-critic`, `groom-synthesizer`

Meta council (Pi domain experts):
- `meta-agent-expert`
- `meta-config-expert`
- `meta-extension-expert`
- `meta-skill-expert`
- `meta-prompt-expert`
- `meta-team-ui-expert`
- `meta-theme-expert`
- `meta-keybindings-expert`

## Strategic principle

Prefer:
- small specialist prompts
- config-as-data routing (`teams.yaml`, `pipelines.yaml`)
- explicit orchestration execution (`/team`, `/pipeline`) with visible UI state

Avoid:
- hidden orchestration behavior
- always-on maximal stacks for every repo
- unbounded loops without checkpoints/circuit breakers

## Adaptive orchestration governor (v1)

Subagent execution now uses a progress-aware governor instead of short hard runtime caps.

Modes:
- `observe`: score and log only, never interrupt
- `warn`: emit warnings when progress is weak or budgets trip
- `enforce`: abort on sustained low-progress or direct tripwires

Direct tripwires:
- loop detection (repeated tool signatures with low novelty)
- retry churn (repeated failures without recovery)
- optional cost/token budget breach
- emergency fuse breach (high safety cap)

Defaults:
- mode: `warn`
- check interval: `75s`
- scoring window: `180s`
- emergency fuse: `4h`

Env knobs:
- `PI_ORCH_GOV_MODE`
- `PI_ORCH_GOV_CHECK_SECONDS`
- `PI_ORCH_GOV_WINDOW_SECONDS`
- `PI_ORCH_GOV_EMERGENCY_FUSE_SECONDS`
- `PI_ORCH_GOV_MAX_COST_USD`
- `PI_ORCH_GOV_MAX_TOKENS`

Command overrides (`/team`, `/pipeline`):
- `--gov-mode observe|warn|enforce`
- `--gov-max-cost <usd>`
- `--gov-max-tokens <n>`
- `--gov-fuse-seconds <seconds>`
