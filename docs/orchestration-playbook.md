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
