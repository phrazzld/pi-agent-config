#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

DURATION="24h"
SNAPSHOT_MS="15000"
LOOP_DELAY_MS="800"
OUT_DIR=""
PRESSURE_CYCLE_MS=""
PRESSURE_CRITICAL_MS=""
PRESSURE_WARN_MS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --smoke)
      DURATION="30m"
      shift
      ;;
    --duration)
      DURATION="${2:-}"
      shift 2
      ;;
    --out)
      OUT_DIR="${2:-}"
      shift 2
      ;;
    --snapshot-ms)
      SNAPSHOT_MS="${2:-}"
      shift 2
      ;;
    --loop-delay-ms)
      LOOP_DELAY_MS="${2:-}"
      shift 2
      ;;
    --pressure-cycle-ms)
      PRESSURE_CYCLE_MS="${2:-}"
      shift 2
      ;;
    --pressure-critical-ms)
      PRESSURE_CRITICAL_MS="${2:-}"
      shift 2
      ;;
    --pressure-warn-ms)
      PRESSURE_WARN_MS="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$OUT_DIR" ]]; then
  stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
  OUT_DIR="$ROOT_DIR/logs/soak/$stamp"
fi

mkdir -p "$OUT_DIR"

echo "[soak] starting mixed-workload run"
echo "[soak] duration=$DURATION out=$OUT_DIR snapshotMs=$SNAPSHOT_MS loopDelayMs=$LOOP_DELAY_MS"

extra_args=()
if [[ -n "$PRESSURE_CYCLE_MS" ]]; then
  extra_args+=(--pressure-cycle-ms "$PRESSURE_CYCLE_MS")
fi
if [[ -n "$PRESSURE_CRITICAL_MS" ]]; then
  extra_args+=(--pressure-critical-ms "$PRESSURE_CRITICAL_MS")
fi
if [[ -n "$PRESSURE_WARN_MS" ]]; then
  extra_args+=(--pressure-warn-ms "$PRESSURE_WARN_MS")
fi

cmd=(
  bun run scripts/soak/mixed-workload-soak.ts
  --duration "$DURATION"
  --out "$OUT_DIR"
  --snapshot-ms "$SNAPSHOT_MS"
  --loop-delay-ms "$LOOP_DELAY_MS"
)
if [[ ${#extra_args[@]} -gt 0 ]]; then
  cmd+=("${extra_args[@]}")
fi
"${cmd[@]}"

REPORT_PATH="$OUT_DIR/soak-report.md"
python3 scripts/soak/analyze-soak-telemetry.py --dir "$OUT_DIR" --out "$REPORT_PATH" >/dev/null

echo "[soak] complete"
echo "[soak] summary: $OUT_DIR/summary.json"
echo "[soak] report:  $REPORT_PATH"
