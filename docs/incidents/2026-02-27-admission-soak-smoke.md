# Incident Note: Admission Soak Harness Smoke Validation (2026-02-27)

## Context

To execute backlog item **"Run 24h mixed-workload soak with admission state + breaker telemetry review"**, we first shipped a deterministic soak harness + analyzer and ran a short smoke pass to validate telemetry integrity before starting a full 24h run.

## Smoke command

```bash
scripts/soak/run-mixed-workload-24h.sh \
  --duration 90s \
  --out logs/soak/smoke-2026-02-27-mixed \
  --pressure-cycle-ms 60000 \
  --pressure-critical-ms 10000 \
  --pressure-warn-ms 10000
```

## Key observations

- run allowed: **19**
- run denied: **89**
- slot allowed: **108**
- slot denied: **40**
- max active runs observed: **3**
- max active slots observed: **16**
- breaker trips: **2 host_pressure**
- denial codes observed:
  - `CIRCUIT_OPEN`
  - `CIRCUIT_OPEN_HOST_PRESSURE`
  - `DEPTH_EXCEEDED`
  - `SLOT_CAP_REACHED`

## Result

Smoke validation passed for harness correctness:

- admission event stream is populated
- status snapshots capture circuit + pressure transitions
- analyzer report computes denial and breaker breakdowns
- scenario trace confirms mixed workload generation

No threshold tuning decision is made from this 90s smoke run; proceed to full 24h soak for production-grade threshold calibration.
