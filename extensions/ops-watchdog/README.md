# ops-watchdog extension

Host-level stability telemetry and optional high-risk command guardrails.

## What it does

- Samples process table on an interval.
- Tracks Node process count and total Node RSS footprint.
- Emits UI status + alerts on warn/critical thresholds.
- Logs snapshots to `~/.pi/agent/logs/ops-watchdog.ndjson`.
- Rotates watchdog logs to prevent unbounded growth.
- Optionally blocks high-risk test/build commands when guardrail enforcement is on.

## Commands

- `/ops-status` — latest snapshot
- `/ops-policy` — thresholds + guardrail mode
- `/ops-tail [limit]` — tail local watchdog log

## Runtime scope

- Enabled for top-level sessions by default.
- Nested orchestration sessions (`PI_ORCH_DEPTH>0`) skip watchdog sampling unless explicitly enabled.

## Environment

- `PI_OPS_WATCHDOG_INTERVAL_MS` (default `15000`)
- `PI_OPS_WATCHDOG_LOG_INTERVAL_MS` (default `60000`)
- `PI_OPS_WATCHDOG_WARN_NODE_COUNT` (default `120`)
- `PI_OPS_WATCHDOG_CRITICAL_NODE_COUNT` (default `260`)
- `PI_OPS_WATCHDOG_WARN_NODE_RSS_MB` (default `16384`)
- `PI_OPS_WATCHDOG_CRITICAL_NODE_RSS_MB` (default `32768`)
- `PI_OPS_WATCHDOG_ENFORCE` (default `false`)
- `PI_OPS_WATCHDOG_ENABLE_NESTED` (default `false`)
- `PI_OPS_WATCHDOG_LOG_MAX_BYTES` (default `10485760`)
- `PI_OPS_WATCHDOG_LOG_MAX_BACKUPS` (default `5`)
- `PI_OPS_WATCHDOG_LOG_ROTATE_CHECK_MS` (default `15000`)

When `PI_OPS_WATCHDOG_ENFORCE=true` or watchdog severity is `critical`,
ops-watchdog blocks risky test/build commands that do not include explicit timeout,
and blocks JS test runners without worker bounds.
