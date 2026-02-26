# Delegated Run Health Model v1 (stall-aware, progress-based)

Status: v1 design complete; v0 runtime shipped in `orchestration` + `bootstrap` (shared monitor).

## Trigger incident

In meta-council execution, `meta-keybindings-expert` failed with:
- `status=failed`, `error=aborted`
- `usage.turns=1`, `usage.toolCalls=1`
- governor: `reason=low_progress`, `elapsedSeconds=1027`, `lastSignalAgeSeconds=1024`

This indicates a stalled delegated run (near-zero progress for ~17m), not a valid long-running task.

## Root cause

Reliability policy is inconsistent across delegated execution paths:
- `subagent` historically had stronger runtime/turn/heartbeat controls.
- orchestration/member runs use separate spawn logic and rely primarily on coarse governor heuristics.

System design failure: no unified delegated-runner health contract.

## Design goals

1. Allow legitimate long-running tasks (hours/days when progressing).
2. Detect and recover from true stalls quickly.
3. Provide explicit forensics when runs are terminated/retried.
4. Keep policy composable and mode-aware (interactive vs headless).

## Non-goals

- Hard global max runtime as primary safety control.
- Hard turn cap as primary safety control.

## Health model

Each delegated run emits periodic health snapshots:

```json
{
  "runId": "...",
  "agent": "...",
  "ts": 1772065904637,
  "lastEventAt": 1772064878016,
  "lastMeaningfulProgressAt": 1772064878016,
  "lastAction": "tool_call:bash",
  "turns": 1,
  "toolCalls": 1,
  "assistantChars": 142,
  "progressFingerprint": "hash-of-recent-state",
  "stallScore": 0.87,
  "classification": "healthy|slow|stalled|wedged"
}
```

### Meaningful progress signals

- new assistant text above threshold
- tool call/result transitions
- usage deltas (tokens/toolCalls/turns)
- status transitions (planning -> acting -> summarizing)

### Stall classification

Use progress-delta over time windows (e.g., 30s, 2m, 5m):
- **healthy**: recent meaningful delta
- **slow**: sparse but plausible deltas
- **stalled**: no meaningful delta for threshold window
- **wedged**: stalled + repeated unchanged fingerprint / stuck on same tool phase

## Recovery policy

For `stalled/wedged`:
1. soft interrupt and capture final snapshot
2. classify failure reason (`stall_no_progress`, `stall_same_tool_phase`, etc.)
3. optional bounded retry (with jitter and one-shot only by default)
4. escalate to parent with structured degraded result

Never silently hang.


## Rollout status

- ✅ `extensions/shared/delegated-health.ts` shipped with stall-aware polling + classification + tool-aware thresholds.
- ✅ Integrated into `extensions/orchestration/index.ts` delegated member runs.
- ✅ Integrated into `extensions/bootstrap/index.ts` lane runner (`runPiPrompt`).
- ✅ Integrated into `extensions/subagent/index.ts` with health snapshots surfaced in subagent run details.
- ✅ Shared execution engine extracted at `extensions/shared/delegation-runner.ts` and adopted by subagent/orchestration/bootstrap.

## Integration points

- `extensions/subagent/index.ts`
- `extensions/orchestration/index.ts`
- `extensions/bootstrap/index.ts` lane runner

Current baseline: shared `extensions/shared/delegation-runner.ts` with common health instrumentation.

## Acceptance criteria

1. Long-running productive delegated run is not killed solely for duration.
2. Stalled run is detected and surfaced with explicit reason within configured stall window.
3. Parent receives structured health/recovery details for every abnormal termination.
4. Regression tests cover: healthy long run, silent stall, wedged tool phase, retry success/failure.


## Initial runtime knobs

- `PI_DELEGATED_HEALTH_POLL_MS`
- `PI_DELEGATED_HEALTH_WARN_NO_PROGRESS_MS`
- `PI_DELEGATED_HEALTH_ABORT_NO_PROGRESS_MS`
- `PI_DELEGATED_HEALTH_ABORT_QUICK_TOOL_MS`
- `PI_DELEGATED_HEALTH_ABORT_ACTIVE_TOOL_MS`
- `PI_DELEGATED_HEALTH_WARN_COOLDOWN_MS`
- `PI_DELEGATED_HEALTH_DISABLE_ABORT` (warnings-only mode)


## Next hardening layer

- Add retry/quorum/degraded completion policy hooks on top of the shared delegation runner.
- Add focused integration tests for stalled single-tool-call delegated runs and bounded recovery behavior.
