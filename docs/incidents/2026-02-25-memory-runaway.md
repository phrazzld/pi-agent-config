# Postmortem: 2026-02-25 Pi memory runaway

Status: final  
Severity: SEV-1 (host crash)  
Date: 2026-02-25 (CST, UTC-06:00)

## Summary

Two host crashes occurred on Wednesday, February 25, 2026 while running Pi orchestration-heavy workflows. The first crash had explicit macOS Jetsam evidence showing 600 `node` processes and ~49-51 GB aggregate Node RSS. After reboot, a second run again entered runaway orchestration behavior (`team_run` storms, large `session_start` and `agent_start` spikes) and the machine rebooted at 14:30 CST. Root cause was unbounded orchestration admission: `team_run` and `pipeline_run` could trigger rapid `spawn("pi", ...)` fan-out without host-global concurrency limits, recursion limits, or fail-closed orchestration circuit breakers.

## Impact

- Primary workstation became unstable and rebooted twice in under 1 hour.
- Active Pi sessions were lost.
- Investigation and feature work were interrupted.
- Risk exposure: any similar recursive fan-out could reoccur under high parallelism.

## Timeline

All times include local CST and UTC.

| Time (CST) | Time (UTC) | Event |
|---|---|---|
| 13:26:20 | 19:26:20 | `JetsamEvent-2026-02-25-132621.ips` recorded. |
| 13:28:26 | 19:28:26 | `JetsamEvent-2026-02-25-132827.ips` recorded. |
| 13:41 | 19:41 | Reboot observed in `last reboot`. |
| 14:12:49 | 20:12:49 | New orchestration burst starts (`session-handoff.ndjson`). |
| 14:21:45 | 20:21:45 | `ops-watchdog` first `critical` sample in second incident window. |
| 14:27:02 | 20:27:02 | `ops-watchdog` still critical near end of second window. |
| 14:30 | 20:30 | Second reboot observed in `last reboot`. |

## Evidence

### 1) First crash: Jetsam proves process storm

Evidence files:
- `/Library/Logs/DiagnosticReports/JetsamEvent-2026-02-25-132621.ips`
- `/Library/Logs/DiagnosticReports/JetsamEvent-2026-02-25-132827.ips`

Key facts (from `scripts/forensics/jetsam-summary.py`):
- `node` process count: `600` in both reports
- aggregate Node RSS:
  - `49050.4 MB` at 13:26:20 CST
  - `50994.7 MB` at 13:28:26 CST
- Node process age distribution: `589/600` younger than 10 seconds
- host memory pressure symptoms include `vm-compressor-space-shortage`

Interpretation:
- This is process birth amplification (fork/process storm), not one long process leaking.

### 2) Second crash: telemetry shows orchestration runaway

Evidence files:
- `.pi/state/session-handoff.ndjson`
- `~/.pi/agent/logs/ops-watchdog.ndjson`

Window analyzed: 14:20:00-14:30:00 CST.

Observed counters:
- total events: `4239`
- `tool_call`: `1556`
- `tool_result`: `1367`
- `team_run` calls: `157`
- `team_run` results: `8`
- `session_start`: `440`
- `agent_start`: `435`
- `agent_end`: `6`

`ops-watchdog` in same window:
- samples: `3768`
- critical samples: `2429`
- max `nodeCount`: `613`
- max `totalProcesses`: `2858`
- critical first seen at 14:21:45 CST

Interpretation:
- Tool-call and completion mismatch plus rising process counts indicate orchestration admission collapse.
- No second Jetsam report was captured, but reboot timing and telemetry are consistent with another runaway.

### 3) Session artifact showing incomplete `team_run`

File:
- `~/.pi/agent/sessions/--Users-phaedrus-Development-pi-agent-config--/2026-02-25T19-16-09-290Z_50c617cc-5cc3-4310-abbf-9b9b10f5c114.jsonl`

Finding:
- Contains a `team_run` call to `meta-council` without a matching `toolResult` before session end.

## Root cause

### Technical root cause

Orchestration admission was not globally bounded. The execution path in `extensions/orchestration/index.ts` creates child processes per agent run (`spawn("pi", ...)`) and enforces only per-team concurrency in one call, not host-global limits across concurrent tool calls.

### Guardrail gap details

- `extensions/guardrails/policy.ts` blocks nested non-interactive `pi` only for command text evaluated through command safety checks.
- `extensions/ops-watchdog/index.ts` enforces only for risky `bash` tool calls, not for `team_run`, `pipeline_run`, or `subagent`.
- `extensions/orchestration/governor.ts` defaults to `warn` with a long check interval (`75s`), too slow and non-blocking for sub-10-second fan-out.

## 5 Whys

1. Why did the host crash?  
Memory pressure exceeded safe limits and macOS entered Jetsam behavior.
2. Why did memory pressure spike so fast?  
Hundreds of `node` processes were created in a short burst.
3. Why were so many processes created?  
Orchestration fan-out recursively/repeatedly triggered `spawn("pi", ...)` without host-global admission limits.
4. Why was this not blocked by existing safeguards?  
Guardrails and ops watchdog primarily protected `bash` calls; orchestration tool paths bypassed those controls.
5. Why did monitoring not contain the blast radius?  
Governor defaults were reactive (`warn`) and slow (`75s`), so they observed rather than prevented rapid fan-out.

## What went well

- Jetsam artifacts were available and preserved.
- `session-handoff` and `ops-watchdog` logs enabled high-fidelity reconstruction.
- Existing repo hardening already delivered useful primitives (guardrails, handoff, watchdog, sysadmin slice).
- Root-cause path narrowed quickly to orchestration admission and spawn model.

## What went wrong

- No fail-closed orchestration gate existed under host pressure.
- No host-global in-flight cap across concurrent orchestration tool calls.
- No recursion-depth or idempotency protection at orchestration entry.
- Governor settings were not tuned for high-velocity runaway modes.

## Corrective actions

| Priority | Action | Owner | Target date | Status |
|---|---|---|---|---|
| P0 | Add orchestration admission controller for `team_run`, `pipeline_run`, `subagent` (global token cap + fail-closed circuit breaker on critical pressure) | orchestration extension | 2026-03-04 | implemented (pending soak) |
| P0 | Add orchestration recursion-depth guard (`PI_ORCH_DEPTH`) and reject above max depth | orchestration extension | 2026-03-04 | implemented |
| P0 | Add idempotency key + dedup for repeated identical orchestration requests | orchestration extension | 2026-03-07 | implemented |
| P1 | Tighten governor defaults for orchestration slices (`enforce` for ops/meta) and shorter check interval | orchestration + profiles | 2026-03-10 | planned |
| P1 | Add stress harness: synthetic runaway test asserting process-count ceiling and fast fail-close behavior | scripts/forensics + CI | 2026-03-12 | implemented (unit harness) |
| P1 | Add NDJSON log rotation and bounded retention for watchdog/handoff/admission telemetry | runtime extensions + sysadmin scripts | 2026-03-12 | implemented |
| P2 | Prototype fixed worker-pool/queue runtime in `pictl` and define migration trigger | control plane | 2026-03-31 | planned |

## Mitigations already implemented

- `extensions/guardrails/policy.ts`
  - added nested non-interactive `pi` command block (`pi-nested-noninteractive`)
- `extensions/profiles/index.ts`
  - tighter profile/tool-scope behavior and guidance updates
- `extensions/ops-watchdog/index.ts`
  - host telemetry and pressure reporting
- `extensions/handoff/index.ts`
  - crash-recovery snapshots
- `slices/sysadmin.json`
  - dedicated ops/sysadmin slice composition
- `extensions/shared/log-rotation.ts`
  - bounded NDJSON retention for watchdog/handoff/admission/visibility/governance/web-search logs
- `scripts/sysadmin/watchdog.sh`
  - added size-based log rotation and stdout suppression by default for launchd runs

## Residual risk

- Admission control is now on-path, but needs soak validation to tune false positives and rejection rates under mixed workloads.
- Governor defaults are still conservative (`warn` in many flows); runaway detection latency can remain higher than desired.
- Heavy non-Pi workloads (virtualization, browsers, local builds/tests) still reduce memory headroom.

## Validation criteria for closure

- Synthetic infinite `team_run` loop never exceeds configured global process ceiling.
- Under critical pressure, new orchestration requests fail closed in <200ms.
- `team_run` call/result mismatch stays <1% over a 24-hour soak run.
- No Jetsam events during 1-hour mixed workload stress test.

## Repeatable forensic commands

```bash
# Jetsam summary
python3 scripts/forensics/jetsam-summary.py \
  /Library/Logs/DiagnosticReports/JetsamEvent-2026-02-25-132621.ips \
  /Library/Logs/DiagnosticReports/JetsamEvent-2026-02-25-132827.ips

# Reboot timeline
last reboot | head -n 10

# Quick event sanity checks
wc -l .pi/state/session-handoff.ndjson ~/.pi/agent/logs/ops-watchdog.ndjson
```
