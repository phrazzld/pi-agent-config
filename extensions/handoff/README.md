# handoff extension

Crash-resilient workspace state snapshots.

## What it does

- Writes `.pi/state/session-handoff.json` in the active workspace.
- Appends event timeline to `.pi/state/session-handoff.ndjson`.
- Tracks:
  - last user input
  - pending tool calls
  - recent tool results
  - run-active status
  - git branch (when available)
- Applies NDJSON log rotation to prevent unbounded growth.

## Command

- `/handoff` — show current snapshot summary and file path
- `/handoff write` — force an immediate snapshot flush

## Runtime scope

- Enabled for top-level sessions by default.
- Nested orchestration sessions (`PI_ORCH_DEPTH>0`) skip handoff unless explicitly enabled.

## Environment

- `PI_HANDOFF_ENABLE_NESTED` (default `false`)
- `PI_HANDOFF_EVENT_LOG_MAX_BYTES` (default `5242880`)
- `PI_HANDOFF_EVENT_LOG_MAX_BACKUPS` (default `3`)
- `PI_HANDOFF_EVENT_LOG_ROTATE_CHECK_MS` (default `10000`)

## Why

If a session crashes or is interrupted, the next session can quickly inspect
`.pi/state/session-handoff.json` and resume from the latest known state.
