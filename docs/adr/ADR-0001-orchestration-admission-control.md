# ADR-0001: Orchestration admission control with fail-closed circuit breaker

Date: 2026-02-25  
Status: accepted  
Decision type: architecture/reliability

## Context and problem statement

On 2026-02-25, two host crashes were linked to orchestration fan-out collapse:
- first crash with Jetsam evidence (`600` node processes, ~`49-51 GB` Node RSS)
- second crash with telemetry evidence (`team_run` call/result mismatch, critical process counts)

Current orchestration behavior:
- `team_run` / `pipeline_run` fan out to per-agent `spawn("pi", ...)`
- no host-global orchestration admission cap
- no orchestration-level fail-closed circuit breaker
- watchdog enforcement primarily targets `bash` tool calls, not orchestration tools

## Decision drivers

- Prevent host crashes from orchestration fan-out
- Keep runtime understandable and easy to operate
- Minimize migration risk and implementation delay
- Preserve extensibility for future queue/worker architecture

## Considered options

### Option 1: Global admission control + fail-closed circuit breaker

- Gate orchestration tools at entry.
- Enforce global in-flight token budget.
- Enforce recursion-depth limit.
- Open circuit under critical host pressure and reject new orchestration tasks quickly.

### Option 2: Worker pool + queue supervisor

- Replace per-task spawn with fixed worker pool and task queue.
- Stronger long-term architecture, higher migration complexity.

### Option 3: Adaptive degradation only

- Drive concurrency/fan-out from telemetry severity.
- Useful but reactive; insufficient alone as primary guardrail.

## Decision outcome

Chosen option: **Option 1**.

Rationale:
- Best robustness/simplicity tradeoff for immediate risk containment.
- Most Pi-native change set (extends existing orchestration + watchdog extensions).
- Lowest migration cost while preserving a path to Option 2.

## Consequences

### Positive

- Immediate fail-closed behavior for orchestration overload conditions.
- Deterministic global upper bound on orchestration in-flight work.
- Reduced chance of process storms from recursive or repeated tool invocation.

### Negative

- Does not remove spawn-per-task overhead.
- Requires careful state management for token accounting.
- May reject work during short-lived spikes if thresholds are too aggressive.

## Implementation requirements

1. Admission gate at `team_run`, `pipeline_run`, and orchestration-use `subagent`.
2. Global in-flight cap for orchestration tasks/processes.
3. Recursion depth guard (`PI_ORCH_DEPTH`) with strict max depth.
4. Circuit-breaker state machine driven by watchdog severity and run mismatch metrics.
5. Structured denial responses with machine-readable error codes.
6. NDJSON observability events for admission, breaker state, and rejects.

## Acceptance criteria

1. Synthetic infinite `team_run` loop cannot exceed configured process cap.
2. Under `critical` pressure, new orchestration requests fail closed in <200ms.
3. `team_run` call/result mismatch <1% over 24h soak.
4. Zero Jetsam events in 1h mixed orchestration stress run after rollout.

## Rollout plan

### Phase 1 (P0, immediate)

- Implement admission gate + circuit breaker + depth guard.
- Add metrics and log events.

### Phase 2 (P1, stabilization)

- Tune limits from telemetry.
- Add idempotency key + dedup for repeated orchestration requests.
- Add adaptive degradation policy as secondary control.

### Phase 3 (P2, reconsideration trigger)

Re-open ADR and evaluate Option 2 if any trigger is hit:
- repeated queueing/denial causing >5% orchestration task rejection in normal load
- sustained need for >16 concurrent orchestration workers
- new incidents involving admission-controller limitations

## References

- `docs/incidents/2026-02-25-memory-runaway.md`
- `docs/orchestration-resilience-options-2026-02-25.md`
- `extensions/orchestration/index.ts`
- `extensions/ops-watchdog/index.ts`
- `extensions/guardrails/policy.ts`
