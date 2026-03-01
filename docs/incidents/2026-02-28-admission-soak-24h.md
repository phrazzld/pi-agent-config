# Incident Note: 24h Admission Mixed-Workload Soak (2026-02-28)

## Context

Executed the full 24h soak for orchestration admission after shipping shared delegation recovery and recursive-fanout stress coverage.

Command:

```bash
scripts/soak/run-mixed-workload-24h.sh \
  --out logs/soak/2026-02-27T19-18-54Z \
  --pressure-cycle-ms 1200000 \
  --pressure-critical-ms 30000 \
  --pressure-warn-ms 90000
```

## Final telemetry snapshot

Source: `logs/soak/2026-02-27T19-18-54Z/soak-report.md`

- admission event files parsed: `orchestration-admission.ndjson*` (base + rotated backups)
- run allowed: **68,840**
- run denied: **24,075** (25.9%)
- slot allowed: **357,814**
- slot denied: **121,456** (25.3%)
- breaker trips: **call_result_gap=294**, **host_pressure=61**
- workload-normalized run denial ratio: **17.4%**
- probe-inclusive denial ratio: **25.7%**

## What this means

- Admission invariants held for 24h (no leaked run/slot leases at finish).
- Depth guard is healthy (`DEPTH_EXCEEDED` probe path behaved deterministically).
- High aggregate denial rates are substantially inflated by synthetic probe lanes (`depth_probe`, `gap_probe`) and deliberate burst over-ask.
- No `RUN_CAP_REACHED` denials occurred; this run does **not** justify raising `PI_ORCH_ADM_MAX_RUNS`.

## Tuning decision

Adopt faster gap-breaker recovery defaults globally based on stable 24h behavior under stress:

- `PI_ORCH_ADM_BREAKER_COOLDOWN_MS`: **30000** (was 120000)
- `PI_ORCH_ADM_GAP_RESET_QUIET_MS`: **45000** (was 180000)

Rationale: call-result-gap breaker dominated denials; lower cooldown/quiet windows reduce prolonged denial tails while retaining fail-closed behavior.

## Follow-ups

1. Keep workload-normalized analyzer view as the default decision surface for threshold changes.
2. Re-run smoke + next full soak after additional orchestration/runtime changes.
3. Continue watching for real-world `RUN_CAP_REACHED` before tuning run-cap upward.
