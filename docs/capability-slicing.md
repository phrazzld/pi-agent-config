# Capability Slicing (Ousterhout-Style)

## Why this exists

Strategic goal: **reduce ambient complexity per session** while keeping a large capability library.

Instead of loading every extension for every task, run Pi with a narrow capability slice tuned to the job.

## Three-layer model

1. **Baseline (always small)**
   - Safety and mode control you almost always want.
   - In this repo: `guardrails`, `profiles`.

2. **Slice (task context)**
   - A curated extension bundle for a class of work.
   - Examples: `research`, `delivery`, `autopilot`, `pi-dev`.

3. **Profile (in-slice behavior)**
   - `fast`, `execute`, `ship`, `ultrathink` (`meta` alias) from `/profile`.
   - Profile controls thinking/tool posture; slice controls what is even loaded.

Rule of thumb:
- **Slice = loaded capabilities**
- **Profile = behavior inside those capabilities**

## Available slices

Slice manifests live in `slices/*.json`.

- `baseline`: minimal safety-first default
- `research`: retrieval + delegation
- `delivery`: implementation + governance + delegation
- `autopilot`: full issue-to-PR stack
- `pi-dev`: focused on improving this Pi config repo

## How to run

High-level control plane (recommended):

```bash
pictl
pictl list
pictl meta
pictl delivery
```

Low-level slice launcher:

```bash
pictl slices
pictl slice baseline
pictl slice research --profile meta
pictl slice delivery --profile execute
pictl slice autopilot --profile ship
pictl slice pi-dev --model openrouter/google/gemini-3-flash-preview
```

Strict narrow mode (disable discovered skills/prompts/themes too):

```bash
pictl slice --strict research --profile meta
```

## What `pictl slice` does

`pictl slice` launches Pi with:
- `--no-extensions` (turns off extension auto-discovery)
- explicit `-e` extension paths from the selected slice manifest
- optional `--strict` that also adds:
  - `--no-skills`
  - `--no-prompt-templates`
  - `--no-themes`

If the slice has `defaultProfile` and you do not pass `--profile`, it exports `PI_DEFAULT_PROFILE` for that run.

## Repo-specific slice strategy

Use this repository as the shared library, then choose slices per repo context:

- Working on `pi-agent-config` itself → `pi-dev`
- Working on product implementation repo → `delivery`
- Deep docs/API research session → `research`
- Autonomous issue-to-PR run → `autopilot`

Keep each repository’s `.pi/settings.json` minimal; rely on slice launchers for runtime composition.

## Next strategic step

- Keep agent roles in `agents/*.md` specialized and small.
- Define team/pipeline configs in `agents/teams.yaml` and `agents/pipelines.yaml` as orchestration data.
- Add a thin orchestrator extension later that reads those configs and delegates through existing `subagent` primitives.
