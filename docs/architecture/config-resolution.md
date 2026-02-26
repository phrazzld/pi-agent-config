# Config Resolution and Active Surface

This document defines which config wins and when.

## Resolution order (high to low)

1. **Repo-local**: `<repo>/.pi/settings.json` and repo-local overlays (`.pi/agents`, `.pi/prompts`, `.pi/skills`)
2. **Global runtime**: `~/.pi/agent/settings.json` + this repo’s synced assets
3. **Runtime defaults**: Pi built-ins + loaded extension defaults

## Context layering order

1. `~/.pi/agent/AGENTS.md` (global baseline)
2. parent directories `AGENTS.md` down to repo
3. repo-local `AGENTS.md` (most specific)

## Runtime circumstance modifiers

| Circumstance | Source | Effect |
|---|---|---|
| `pictl <target>` | `slices/<target>.json` | selects extension pack |
| `PI_WORKFLOW_TARGET` / `PI_WORKFLOW_SLICE` | exported by `pictl` launcher | runtime capability scoping (e.g., autopilot pipelines build-only) |
| `--profile` / `PI_DEFAULT_PROFILE` | `profiles` extension | tool/thinking posture |
| Orchestration depth > 0 | `PI_ORCH_DEPTH` | delegated-run policy behavior |
| Repo-local orchestration files present | `<repo>/.pi/agents/{teams,pipelines}.yaml` | local-first team/pipeline resolution |

## Operational command

Use:

```text
/visibility config
```

This prints active runtime context:
- profile, active tool surface
- global vs local settings presence
- local `.pi` overlays detected
- inventory counts (commands/tools)

## Drift control

- Regenerate inventory after composition changes:

```bash
./scripts/gen-runtime-inventory.sh
```

- Keep generated inventory committed for reviewability.
