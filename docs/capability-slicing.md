# Capability Slicing (Kernel + Overlay Model)

## Why this exists

Strategic goal: keep session startup simple while allowing rich repo-local behavior.

Use a **small set of kernel slices** globally, then layer capabilities via pipelines/agents/bootstrap-generated local overlays.

## Three-layer model

1. **Kernel slice (global, stable)**
   - Defines the base extension surface for a class of work.
   - Kernels in this repo: `meta`, `software` (build), `daybook`, `sysadmin` (ops).

2. **Capability overlay (workflow-specific)**
   - Issue-to-PR autopilot, deep research posture, etc.
   - Usually expressed as pipelines/agents/prompts, not extra top-level slices.

3. **Profile (runtime behavior)**
   - `fast`, `execute`, `ship`, `ultrathink` (`meta` alias).
   - Profile controls thinking/tool posture; slice controls what is loaded.

Rule of thumb:
- **Slice = kernel capability envelope**
- **Capability overlay = workflow composition on top of slice**
- **Profile = behavior tuning**

## Available kernel slices

Slice manifests live in `slices/*.json`.

- `meta`: Pi architecture/config/bootstrap work
- `software`: default engineering build slice
- `daybook`: journaling/brainstorming context
- `sysadmin`: host reliability/incident response

## How to run

High-level control plane (recommended):

```bash
pictl
pictl list
pictl meta
pictl build
pictl daybook
pictl ops
```

Low-level slice launcher:

```bash
pictl slices
pictl slice meta --profile meta
pictl slice software --profile execute
pictl slice daybook --profile fast
pictl slice sysadmin --profile execute
```

Strict narrow mode (disable discovered skills/prompts/themes too):

```bash
pictl slice --strict meta --profile meta
```

## Capability examples (not top-level targets)

- Autopilot issue-to-PR workflow (build capability):

```bash
pictl build -- /pipeline autopilot-v1 "ship highest-priority issue"
```

- Research posture inside current repo context:
  - run in `meta`, `build`, or `daybook`
  - use web retrieval + subagents + local context

## Repo-local strategy

- Bootstrap once in repo context (`pictl meta` + `/bootstrap-repo`)
- Relaunch `pictl build` for day-to-day work
- Let bootstrap generate repo-local overlays (`.pi/agents`, `.pi/prompts`, persona/capability specifics)

This minimizes global complexity while maximizing local usefulness.
