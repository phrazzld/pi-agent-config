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
   - Examples: `pi-dev`, `software`, `daybook`, `autopilot`.

3. **Profile (in-slice behavior)**
   - `fast`, `execute`, `ship`, `ultrathink` (`meta` alias) from `/profile`.
   - Profile controls thinking/tool posture; slice controls what is even loaded.

Rule of thumb:
- **Slice = loaded capabilities**
- **Profile = behavior inside those capabilities**

## Available slices

Slice manifests live in `slices/*.json`.

- `baseline`: minimal safety-first default
- `pi-dev`: meta architecture + maximum visibility + orchestration UI
- `research`: retrieval + delegation + visibility
- `delivery`: implementation + governance + orchestration (legacy alias slice; prefer `software`)
- `software`: generic product engineering slice for most repos
- `autopilot`: full issue-to-PR stack
- `daybook`: charisma-first one-on-one journaling slice

## How to run

High-level control plane (recommended):

```bash
pictl
pictl list
pictl meta
pictl build
pictl daybook
```

Low-level slice launcher:

```bash
pictl slices
pictl slice baseline
pictl slice pi-dev --profile meta
pictl slice software --profile execute
pictl slice autopilot --profile ship
pictl slice daybook --profile fast
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
- Bootstrapping a new repo config → run `meta` in that repo once, then switch
- Day-to-day product repo work → `build` target (backed by `software` slice) or a domain-specific local slice
- Deep docs/API research session → `research`
- Autonomous issue-to-PR run → `autopilot`
- Journaling/daybook session → `daybook`

Keep each repository’s `.pi/settings.json` minimal; rely on slice launchers for runtime composition.

## Next strategic step

- Keep agent roles in `agents/*.md` specialized and small.
- Keep orchestration config declarative in `agents/teams.yaml` and `agents/pipelines.yaml`.
- Extend visibility instrumentation with weekly rollups and quality/cost trend summaries.
