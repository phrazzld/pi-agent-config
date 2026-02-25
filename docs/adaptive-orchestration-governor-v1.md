# Adaptive Orchestration Governor v1

Status: implemented (initial release)

## Why

Fixed short runtime caps quickly become stale as agent capability improves.
This governor protects against stalls/loops while allowing productive long-running execution.

## Core behavior

- Evaluate progress on a rolling window.
- Increase scrutiny as elapsed runtime grows.
- Use direct tripwires for clearly bad states.
- Keep a high emergency fuse for zombie-process safety.

## Modes

- `observe`: no interruption; records/flags poor-progress states.
- `warn`: emits warnings when tripwires or low-progress thresholds trigger.
- `enforce`: aborts execution when thresholds/tripwires trigger.

## Scoring model (windowed)

Signals considered:
- tool starts/completions
- novelty of tool signature sequence
- assistant output volume
- verification command execution (test/lint/type/build)
- error/retry churn
- idle duration

Escalation bands:
- 0–5m: low minimum score, larger strike budget
- 5–15m: moderate threshold
- 15–45m: stricter threshold
- 45m+: strict threshold

Low-progress strikes accumulate when score drops below threshold and decay when score recovers.

## Direct tripwires

- loop detection
- retry churn
- optional cost budget exceeded
- optional token budget exceeded
- emergency fuse exceeded

## Configuration

Environment:
- `PI_ORCH_GOV_MODE` (`observe|warn|enforce`, default `warn`)
- `PI_ORCH_GOV_CHECK_SECONDS` (default `75`)
- `PI_ORCH_GOV_WINDOW_SECONDS` (default `180`)
- `PI_ORCH_GOV_EMERGENCY_FUSE_SECONDS` (default `14400`)
- `PI_ORCH_GOV_MAX_COST_USD` (optional)
- `PI_ORCH_GOV_MAX_TOKENS` (optional)

Runtime overrides (`/team`, `/pipeline`, `team_run`, `pipeline_run`):
- `--gov-mode`
- `--gov-max-cost`
- `--gov-max-tokens`
- `--gov-fuse-seconds`

## Implementation touchpoints

- `extensions/orchestration/governor.ts`
- `extensions/orchestration/index.ts`
- `extensions/orchestration/__tests__/governor.test.ts`

## Next calibration work

- tune weights/thresholds on real telemetry traces
- reduce false positives in long sparse phases
- decide if/when to make `enforce` default for selected flows
