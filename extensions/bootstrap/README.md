# bootstrap extension

Code-backed repository bootstrap primitive with an opinionated flow.

## Command

- `/bootstrap-repo [domain] [--force]`
- `/bootstrap-repo --domain vox`

## Tool

- `bootstrap_repo`

## Opinionated flow (always-on)

`/bootstrap-repo` always runs this sequence:

1. repository reconnaissance across parallel specialist lanes
2. ambition pass (`single highest-leverage addition` + 72h validation + kill criteria)
3. synthesis into repo-local `.pi` artifacts
4. immediate apply/write of the generated foundation

No quick/plan toggles are required in normal operation.

> Compatibility note: legacy `--quick` / `--max` flags are ignored.

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

Bootstrap-generated `.pi/settings.json` preserves a base extension capability set by default:
- `organic-workflows`
- `profiles`
- `subagent`
- `orchestration`
- `web-search`

This avoids accidental loss of orchestration/memory capabilities when local extension allow-lists are generated.
