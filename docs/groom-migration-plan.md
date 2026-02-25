# Groom Migration Plan (Claude -> Pi-native)

## Goal

Port `/groom` from the legacy Claude skill ecosystem into a Pi-native workflow that is:
- orchestration-first (`team_run`, `pipeline_run`)
- model-diverse (multi-provider specialist lanes)
- low-config and opinionated by default
- ambition-gated before issue synthesis

## Source reference

Primary legacy source:
- `~/.claude/skills/groom/SKILL.md`

We port intent and architecture, not one-to-one command dependencies.

## Target Pi-native architecture

### Core primitives

- Prompt: `prompts/groom.md`
- Team: `groom-council` (+ optional `groom-ambition-council`)
- Pipeline: `groom-v1`
- Agents:
  - `groom-strategist`
  - `groom-researcher`
  - `groom-critic`
  - `groom-synthesizer`

### Required checkpoint

Every groom run includes an ambition checkpoint:
1. Ask the frontier question
2. Produce 3 candidates
3. Select 1 accretive addition (or reject all)
4. Attach 72h validation + kill criteria + rollback

## Phased rollout

### Phase 1 (land now)
- Upgrade `prompts/groom.md` to orchestration-native workflow with ambition checkpoint.
- Add dedicated groom agents and team/pipeline definitions.
- Keep outputs planning/synthesis-first (no forced issue writes in v1).

### Phase 2
- Add issue writer quality gate:
  - issue template contract
  - dedupe checks
  - severity/impact scoring rubric
- Add lightweight run artifact (`.groom/plan-<date>.md`) for review continuity.

### Phase 3
- Extension-backed `/groom` command:
  - deterministic checkpoints
  - optional GH write mode via safe body-file patterns
  - post-run telemetry summary

## Constraints

- Keep default flow opinionated; avoid optional mode explosion.
- Prefer composable single-purpose agents over one giant prompt.
- Keep migration incremental; no hard dependency on legacy Claude-only skills.

## Acceptance criteria

- `/groom` can run end-to-end using Pi-native prompts + teams/pipelines.
- Multi-provider lanes produce differentiated signals.
- Ambition checkpoint appears in final output every run.
- Result includes executable prioritized slices with acceptance criteria.
