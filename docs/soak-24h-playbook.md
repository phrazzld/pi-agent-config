# 24h Mixed-Workload Soak Playbook

Purpose: validate orchestration admission caps + circuit breaker behavior under sustained mixed load, then tune thresholds from telemetry.

## Scope

This soak targets:

- admission decisions (`run/slot/depth`)
- breaker trips (`host_pressure`, `call_result_gap`)
- recovery behavior over long-running churn (opens/recovers, denial ratios)

This is **synthetic mixed workload** at the admission layer (deterministic and low-cost), not a model-cost-heavy end-to-end swarm run.

## Run modes

### Full soak (24h)

```bash
scripts/soak/run-mixed-workload-24h.sh
```

### Smoke mode (30m)

```bash
scripts/soak/run-mixed-workload-24h.sh --smoke
```

### Optional custom duration/output

```bash
scripts/soak/run-mixed-workload-24h.sh \
  --duration 6h \
  --out logs/soak/manual-6h
```

## Workload matrix

The soak runner cycles scenarios:

1. `normal_team` — nominal team-style run + bounded slot usage
2. `normal_pipeline` — nominal pipeline-style run + serial slot usage
3. `burst_slots` — over-ask slot acquisitions to test slot caps and denials
4. `depth_probe` — depth > maxDepth to verify recursion gate
5. `gap_probe` — call/result imbalance to force gap breaker behavior

Synthetic pressure phases (`ok`/`warn`/`critical`) are injected on a repeating cycle to validate host-pressure breaker behavior.

## Artifacts

Per run, artifacts are written to `logs/soak/<timestamp>/`:

- `orchestration-admission.ndjson` — raw admission events
- `ops-watchdog.ndjson` — synthetic pressure samples (`kind=sample`)
- `status.ndjson` — periodic admission status snapshots
- `workload.ndjson` — scenario-level execution trace
- `summary.json` — run metadata and terminal status
- `soak-report.md` — computed analysis + recommendations

## Success criteria (go/no-go)

- No unbounded growth in active runs/slots from status snapshots.
- Circuit can open under pressure/gap and later recover (closed samples present).
- Denials are explainable by configured gates (code breakdown is stable and expected).
- No state errors / lock timeouts dominating event stream.

## Triage flow

1. Check `soak-report.md` recommendations.
2. If denial ratios are high outside critical pressure:
   - tune `PI_ORCH_ADM_MAX_RUNS` / `PI_ORCH_ADM_MAX_SLOTS`.
3. If gap trips are frequent:
   - inspect `counter_call` vs `counter_result` drift,
   - tune `PI_ORCH_ADM_GAP_MAX` / `PI_ORCH_ADM_GAP_RESET_QUIET_MS`.
4. If pressure samples are critical but no host-pressure trips:
   - verify pressure feed freshness (`PI_ORCH_ADM_PRESSURE_FRESHNESS_MS`).
5. Re-run smoke (30m), then full soak if stable.

## Tuning knobs (common)

- `PI_ORCH_ADM_MAX_RUNS`
- `PI_ORCH_ADM_MAX_SLOTS`
- `PI_ORCH_ADM_MAX_DEPTH`
- `PI_ORCH_ADM_BREAKER_COOLDOWN_MS`
- `PI_ORCH_ADM_GAP_MAX`
- `PI_ORCH_ADM_GAP_RESET_QUIET_MS`

Synthetic soak-specific convenience knobs:

- `PI_SOAK_MAX_RUNS`
- `PI_SOAK_MAX_SLOTS`
- `PI_SOAK_MAX_DEPTH`
- `PI_SOAK_BREAKER_COOLDOWN_MS`
- `PI_SOAK_MAX_CALL_RESULT_GAP`
- `PI_SOAK_GAP_RESET_QUIET_MS`
