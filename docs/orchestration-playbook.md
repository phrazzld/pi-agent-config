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

## Delegated run health monitor (stall-aware)

## Master-only orchestration policy

- `team_run` and `pipeline_run` are master-only tools (top-level session only).
- Delegated callers (`PI_DELEGATED_BY!=master`) are denied for team/pipeline fan-out.
- `subagent` may be called by master and team/pipeline members, but subagents may not invoke `subagent` recursively.

Orchestration member runs now include a shared delegated health monitor (`extensions/shared/delegated-health.ts`) that polls progress fingerprints instead of relying on blunt wall-clock cutoffs.
Execution lifecycle is now unified through `extensions/shared/delegation-runner.ts` across subagent/orchestration/bootstrap.

Primary knobs:
- `PI_DELEGATED_HEALTH_POLL_MS`
- `PI_DELEGATED_HEALTH_WARN_NO_PROGRESS_MS`
- `PI_DELEGATED_HEALTH_ABORT_NO_PROGRESS_MS`
- `PI_DELEGATED_HEALTH_ABORT_QUICK_TOOL_MS`
- `PI_DELEGATED_HEALTH_ABORT_ACTIVE_TOOL_MS`
- `PI_DELEGATED_HEALTH_WARN_COOLDOWN_MS`
- `PI_DELEGATED_HEALTH_DISABLE_ABORT`

Command overrides (`/team`, `/pipeline`):
- `--gov-mode observe|warn|enforce`
- `--gov-max-cost <usd>`
- `--gov-max-tokens <n>`
- `--gov-fuse-seconds <seconds>`

## Admission control + circuit breaker (v1)

Orchestration now has a fail-closed admission layer in front of execution.

What it gates:
- `team_run`
- `pipeline_run`
- `subagent` (when circuit/depth policy blocks further fan-out)
- per-agent spawn slots inside orchestration runner

Core controls:
- host-global run cap (`PI_ORCH_ADM_MAX_RUNS`)
- host-global slot/process cap (`PI_ORCH_ADM_MAX_SLOTS`)
- recursion depth cap via `PI_ORCH_DEPTH` + `PI_ORCH_ADM_MAX_DEPTH`
- circuit opens on:
  - critical host pressure from `ops-watchdog`
  - excessive tool call/result mismatch gap (auto-resets after quiet period)

Operational commands:
- `/orchestration-policy`
- `/orchestration-circuit`

State/log paths (default):
- `~/.pi/agent/state/orchestration-admission-state.json`
- `~/.pi/agent/logs/orchestration-admission.ndjson`
Admission env knobs:
- `PI_ORCH_ADM_MAX_RUNS`
- `PI_ORCH_ADM_MAX_SLOTS`
- `PI_ORCH_ADM_MAX_DEPTH`
- `PI_ORCH_ADM_BREAKER_COOLDOWN_MS`
- `PI_ORCH_ADM_GAP_MAX`
- `PI_ORCH_ADM_GAP_RESET_QUIET_MS`
- `PI_ORCH_ADM_RUN_TTL_MS`
- `PI_ORCH_ADM_SLOT_TTL_MS`
- `PI_ORCH_ADM_EVENT_LOG_MAX_BYTES`
- `PI_ORCH_ADM_EVENT_LOG_MAX_BACKUPS`
- `PI_ORCH_ADM_EVENT_LOG_ROTATE_CHECK_MS`

