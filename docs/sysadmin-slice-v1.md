# Sysadmin Slice v1 (Argus)

First iteration of a system-administration runtime for host stability and incident response.

## Goals

- Detect process/memory pressure early.
- Keep crash recovery state in each workspace.
- Reduce sharp-edge commands that can trigger runaway process storms.

## Launch

```bash
pictl ops
```

This maps to `slices/sysadmin.json`.

## Included capabilities

- `guardrails` (command safety + nested non-interactive Pi recursion block)
- `profiles` (tool-scope-respecting profile activation)
- `handoff` (workspace state snapshots in `.pi/state/`)
- `ops-watchdog` (Node process + RSS monitoring + optional enforcement)
- `subagent` + `orchestration` + `visibility` + `web-search`

## Runtime commands

- `/handoff` and `/handoff write`
- `/ops-status`
- `/ops-policy`
- `/ops-tail [limit]`

## Autonomous host watchdog (optional)

Manual run:

```bash
./scripts/sysadmin/watchdog.sh
```

Install LaunchAgent (always-on at login):

```bash
./scripts/sysadmin/install-launchagent.sh
```

Stop/remove LaunchAgent:

```bash
./scripts/sysadmin/uninstall-launchagent.sh
```

## Safety knobs

- `PI_GUARDRAILS_ALLOW_NESTED_PI=true` (temporary override only)
- `PI_OPS_WATCHDOG_ENFORCE=true` (enforce timeout/worker-cap blocks)

## Naming direction

This slice uses **Argus** as a codename (watcher/guardian archetype).
Use aliases like `ops`, `sysadmin`, `argus`, or `guardian`.


## Log growth controls

Defaults now rotate watchdog/handoff/admission NDJSON logs with bounded backups.

Key knobs:
- `PI_SYSADMIN_LOG_MAX_BYTES` / `PI_SYSADMIN_LOG_MAX_BACKUPS`
- `PI_OPS_WATCHDOG_LOG_MAX_BYTES` / `PI_OPS_WATCHDOG_LOG_MAX_BACKUPS`
- `PI_HANDOFF_EVENT_LOG_MAX_BYTES` / `PI_HANDOFF_EVENT_LOG_MAX_BACKUPS`
- `PI_ORCH_ADM_EVENT_LOG_MAX_BYTES` / `PI_ORCH_ADM_EVENT_LOG_MAX_BACKUPS`

Nested orchestration sessions skip `handoff` + `ops-watchdog` by default to reduce fan-out overhead.
