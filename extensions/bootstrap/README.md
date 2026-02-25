# bootstrap extension

Code-backed repository bootstrap primitive with intelligent multi-model synthesis.

## Command

- `/bootstrap-repo [domain] [--force] [--quick]`
- `/bootstrap-repo --domain vox`

## Tool

- `bootstrap_repo`

## Default behavior (intelligent mode)

By default, bootstrap runs a multi-lane autonomous workflow:

1. repo scout lane (deep codebase reconnaissance)
2. docs research lane (retrieval-backed best practices)
3. market/product lane (workflow implications)
4. critic lane (failure modes and safeguards)
5. synthesis lane (generates repo-local Pi config artifacts)

Model defaults are configurable via env:

- `PI_BOOTSTRAP_MODEL_SCOUT`
- `PI_BOOTSTRAP_MODEL_RESEARCH`
- `PI_BOOTSTRAP_MODEL_MARKET`
- `PI_BOOTSTRAP_MODEL_CRITIC`
- `PI_BOOTSTRAP_MODEL_SYNTHESIS`

## Quick mode

Use `--quick` to skip autonomous lanes and generate template-based bootstrap artifacts.

## What it scaffolds

In the target repository root:

- `.pi/settings.json`
- `.pi/agents/planner.md`
- `.pi/agents/worker.md`
- `.pi/agents/reviewer.md`
- `.pi/agents/teams.yaml`
- `.pi/agents/pipelines.yaml`
- `.pi/bootstrap-report.md`
- `docs/pi-local-workflow.md`

By default, existing files are preserved. Use `--force` to overwrite differing files.
