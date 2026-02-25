# Teams + Pipelines Playbook (Current State)

## Status

This repo currently has:
- reusable specialist agents in `agents/*.md`
- delegation primitives via `extensions/subagent` (`single`, `parallel`, `chain`)
- team/pipeline definitions as data in:
  - `agents/teams.yaml`
  - `agents/pipelines.yaml`

Today, `teams.yaml` and `pipelines.yaml` are **source-of-truth docs/config data**.
A dedicated team/pipeline orchestrator extension can be added later to execute them directly.

Current specialist roster:
- `scout` (recon)
- `planner` (implementation plan)
- `plan-reviewer` (plan stress test)
- `worker` (implementation)
- `reviewer` (quality review)
- `red-team` (security/adversarial review)
- `documenter` (PR/docs narrative)

## Team usage pattern (today)

Use `subagent` with explicit role routing.

Example: intake team (`scout` + `planner` + `plan-reviewer`)

1. Scout recon
2. Planner converts findings to an executable plan
3. Plan-reviewer stress-tests the plan before code changes

Example handoff prompt:

```text
Use subagent chain:
1) scout: map relevant files and architecture for <goal>
2) planner: turn scout output into concrete implementation steps with tests and risks
3) plan-reviewer: critique the plan and force missing-step/risk fixes before implementation
```

## Pipeline usage pattern (today)

Use `subagent` chain mode for deterministic flows.

Example: plan-build-review

```text
Call subagent in chain mode with:
- planner: "Create an implementation plan for: <goal>"
- worker: "Execute this plan with focused changes and verification:\n\n{previous}"
- reviewer: "Review this implementation for correctness, risk, and maintainability:\n\n{previous}"
```

## Autopilot-v1 intent

`autopilot-v1` in `agents/pipelines.yaml` is the first bounded issue-to-PR pipeline contract:

1. intake (`scout`)
2. plan (`planner`)
3. plan critique (`plan-reviewer`)
4. implement (`worker`)
5. blocking quality review (`reviewer`)
6. adversarial hardening review (`red-team`)
7. PR/docs prep (`documenter`)
8. merge-readiness review (`reviewer`)

Human checkpoints (explicit):
- after intake
- before PR
- before merge

## Strategic principle

Prefer:
- small specialist prompts
- config-as-data for routing (`teams.yaml`, `pipelines.yaml`)
- one orchestration primitive (`subagent`) reused everywhere

Avoid:
- multiple orchestration engines with overlapping behavior
- always-on full capability stacks
- unbounded review/CI loops without hard stop criteria
