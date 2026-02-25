# bootstrap extension

Code-backed repository bootstrap primitive with autonomous multi-lane synthesis.

## Command

- `/bootstrap-repo [domain] [--force] [--quick] [--max]`
- `/bootstrap-repo --domain vox`

## Tool

- `bootstrap_repo`

## Plan vs Apply

- `/bootstrap-plan` (prompt template) = planning/recon only, no file writes.
- `/bootstrap-repo` (extension command/tool) = writes repo-local `.pi/` artifacts.

## Default behavior (intelligent mode)

By default, bootstrap dispatches parallel lanes to explore and stress-test a repo-local Pi foundation:

1. repo scout lane (engineering workflow reconnaissance)
2. context bridge lane (AGENTS/CLAUDE/.claude/.codex/.pi adopt-bridge-ignore)
3. docs research lane (retrieval-backed best practices)
4. workflow critic lane (failure modes and safeguards)
5. synthesis lane (generates repo-local Pi artifacts)

This is intentionally goal-oriented: set success criteria, gather evidence, synthesize, and avoid brittle micro-procedures.

## Max mode

Use `--max` to add extra ideation and implementation-critique lanes before synthesis.

## Quick mode

Use `--quick` to skip autonomous lanes and generate template-based bootstrap artifacts.

## Model routing

Model defaults are configurable via env:

- `PI_BOOTSTRAP_MODEL_SCOUT`
- `PI_BOOTSTRAP_MODEL_CONTEXT`
- `PI_BOOTSTRAP_MODEL_RESEARCH`
- `PI_BOOTSTRAP_MODEL_CRITIC`
- `PI_BOOTSTRAP_MODEL_IDEATION`
- `PI_BOOTSTRAP_MODEL_SYNTHESIS`

## What it scaffolds

In the target repository root:

- `.pi/settings.json`
- `.pi/agents/planner.md`
- `.pi/agents/worker.md`
- `.pi/agents/reviewer.md`
- `.pi/agents/teams.yaml`
- `.pi/agents/pipelines.yaml`
- `.pi/prompts/discover.md`
- `.pi/prompts/design.md`
- `.pi/prompts/deliver.md`
- `.pi/prompts/review.md`
- `.pi/bootstrap-report.md`
- `docs/pi-local-workflow.md`

Generated workflow docs/prompts include local-first memory guidance (`/memory-ingest`, `/memory-search`, `/memory-context`).

By default, existing files are preserved. Use `--force` to overwrite differing files.

Bootstrap-generated `.pi/settings.json` now preserves a base extension capability set by default:
- `organic-workflows`
- `profiles`
- `subagent`
- `orchestration`
- `web-search`

This avoids accidental loss of orchestration/memory capabilities when local extension allow-lists are generated.
