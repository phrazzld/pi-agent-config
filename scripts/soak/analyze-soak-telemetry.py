#!/usr/bin/env python3
"""Analyze admission/breaker soak telemetry and emit a markdown report."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyze soak telemetry artifacts")
    parser.add_argument("--dir", required=True, help="Soak artifact directory")
    parser.add_argument(
        "--out",
        default="",
        help="Output markdown path (default: <dir>/soak-report.md)",
    )
    return parser.parse_args()


def load_ndjson(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []

    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            text = line.strip()
            if not text:
                continue
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                rows.append(parsed)
    return rows


@dataclass
class SoakMetrics:
    event_counts: Counter
    run_denials: Counter
    slot_denials: Counter
    tool_gate_denials: Counter
    breaker_trips: Counter
    total_run_allowed: int
    total_run_denied: int
    total_slot_allowed: int
    total_slot_denied: int
    max_active_runs: int
    max_active_slots: int
    max_gap: int
    critical_status_samples: int
    warn_status_samples: int
    ok_status_samples: int
    circuit_open_samples: int
    circuit_closed_samples: int


def compute_metrics(events: list[dict[str, Any]], status_rows: list[dict[str, Any]]) -> SoakMetrics:
    event_counts: Counter = Counter()
    run_denials: Counter = Counter()
    slot_denials: Counter = Counter()
    tool_gate_denials: Counter = Counter()
    breaker_trips: Counter = Counter()

    total_run_allowed = 0
    total_run_denied = 0
    total_slot_allowed = 0
    total_slot_denied = 0

    active_runs_from_events = 0
    active_slots_from_events = 0
    max_active_runs_from_events = 0
    max_active_slots_from_events = 0

    for row in events:
        kind = str(row.get("kind", "unknown"))
        event_counts[kind] += 1

        if kind == "run_allowed":
            total_run_allowed += 1
            active_runs_from_events += 1
            max_active_runs_from_events = max(max_active_runs_from_events, active_runs_from_events)
        elif kind == "run_end":
            active_runs_from_events = max(0, active_runs_from_events - 1)
        elif kind == "run_denied":
            total_run_denied += 1
            run_denials[str(row.get("code", "UNKNOWN"))] += 1
        elif kind == "slot_allowed":
            total_slot_allowed += 1
            active_slots_from_events += 1
            max_active_slots_from_events = max(max_active_slots_from_events, active_slots_from_events)
        elif kind == "slot_release":
            active_slots_from_events = max(0, active_slots_from_events - 1)
        elif kind == "slot_denied":
            total_slot_denied += 1
            slot_denials[str(row.get("code", "UNKNOWN"))] += 1
        elif kind == "tool_gate_denied":
            tool_gate_denials[str(row.get("code", "UNKNOWN"))] += 1
        elif kind == "circuit_open":
            breaker_trips[str(row.get("reason", "unknown"))] += 1

    max_active_runs = max_active_runs_from_events
    max_active_slots = max_active_slots_from_events
    max_gap = 0
    critical_status_samples = 0
    warn_status_samples = 0
    ok_status_samples = 0
    circuit_open_samples = 0
    circuit_closed_samples = 0

    for row in status_rows:
        max_active_runs = max(max_active_runs, int(row.get("activeRuns", 0)))
        max_active_slots = max(max_active_slots, int(row.get("activeSlots", 0)))
        max_gap = max(max_gap, int(row.get("maxGap", 0)))

        pressure = row.get("pressure") or {}
        severity = str(pressure.get("severity", "ok"))
        if severity == "critical":
            critical_status_samples += 1
        elif severity == "warn":
            warn_status_samples += 1
        else:
            ok_status_samples += 1

        circuit = row.get("circuit") or {}
        if str(circuit.get("status", "closed")) == "open":
            circuit_open_samples += 1
        else:
            circuit_closed_samples += 1

    return SoakMetrics(
        event_counts=event_counts,
        run_denials=run_denials,
        slot_denials=slot_denials,
        tool_gate_denials=tool_gate_denials,
        breaker_trips=breaker_trips,
        total_run_allowed=total_run_allowed,
        total_run_denied=total_run_denied,
        total_slot_allowed=total_slot_allowed,
        total_slot_denied=total_slot_denied,
        max_active_runs=max_active_runs,
        max_active_slots=max_active_slots,
        max_gap=max_gap,
        critical_status_samples=critical_status_samples,
        warn_status_samples=warn_status_samples,
        ok_status_samples=ok_status_samples,
        circuit_open_samples=circuit_open_samples,
        circuit_closed_samples=circuit_closed_samples,
    )


def ratio(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return numerator / denominator


def suggestions(metrics: SoakMetrics) -> list[str]:
    out: list[str] = []

    run_total = metrics.total_run_allowed + metrics.total_run_denied
    slot_total = metrics.total_slot_allowed + metrics.total_slot_denied

    run_denial_ratio = ratio(metrics.total_run_denied, run_total)
    slot_denial_ratio = ratio(metrics.total_slot_denied, slot_total)

    critical_ratio = ratio(
        metrics.critical_status_samples,
        metrics.critical_status_samples + metrics.warn_status_samples + metrics.ok_status_samples,
    )

    if run_denial_ratio > 0.25 and critical_ratio < 0.1:
        out.append(
            "High run denial ratio outside sustained critical pressure. Consider raising PI_ORCH_ADM_MAX_RUNS or reducing background fan-out."
        )

    if slot_denial_ratio > 0.30 and critical_ratio < 0.1:
        out.append(
            "High slot denial ratio with low critical pressure share. Consider tuning PI_ORCH_ADM_MAX_SLOTS and/or team concurrency defaults."
        )

    gap_trips = metrics.breaker_trips.get("call_result_gap", 0)
    if gap_trips >= 3:
        out.append(
            "Frequent call_result_gap breaker trips detected. Review tool_call/tool_result pairing and tune PI_ORCH_ADM_GAP_MAX or quiet reset window."
        )

    if metrics.breaker_trips.get("host_pressure", 0) == 0 and metrics.critical_status_samples > 0:
        out.append(
            "Critical pressure samples observed without host_pressure breaker trips. Verify pressure freshness window and ops-watchdog log feed."
        )

    if not out:
        out.append("No urgent threshold change indicated from this run; keep defaults and continue periodic soak runs.")

    return out


def to_iso(ms: int | None) -> str:
    if not ms:
        return "n/a"
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


def generate_report(
    artifact_dir: Path,
    events: list[dict[str, Any]],
    status_rows: list[dict[str, Any]],
    workload_rows: list[dict[str, Any]],
    metrics: SoakMetrics,
) -> str:
    ts_values = [int(row.get("ts", 0)) for row in workload_rows if int(row.get("ts", 0)) > 0]
    first_ts = min(ts_values) if ts_values else 0
    last_ts = max(ts_values) if ts_values else 0

    run_total = metrics.total_run_allowed + metrics.total_run_denied
    slot_total = metrics.total_slot_allowed + metrics.total_slot_denied

    run_denial_ratio = ratio(metrics.total_run_denied, run_total)
    slot_denial_ratio = ratio(metrics.total_slot_denied, slot_total)

    lines: list[str] = []
    lines.append("# Mixed-Workload Soak Report")
    lines.append("")
    lines.append(f"- artifact dir: `{artifact_dir}`")
    lines.append(f"- workload start (UTC): {to_iso(first_ts if first_ts > 0 else None)}")
    lines.append(f"- workload end (UTC): {to_iso(last_ts if last_ts > 0 else None)}")
    lines.append(f"- admission events: {len(events)}")
    lines.append(f"- status samples: {len(status_rows)}")
    lines.append(f"- workload events: {len(workload_rows)}")
    lines.append("")

    lines.append("## Admission Summary")
    lines.append("")
    lines.append(f"- run allowed: {metrics.total_run_allowed}")
    lines.append(f"- run denied: {metrics.total_run_denied} ({run_denial_ratio:.1%})")
    lines.append(f"- slot allowed: {metrics.total_slot_allowed}")
    lines.append(f"- slot denied: {metrics.total_slot_denied} ({slot_denial_ratio:.1%})")
    lines.append(f"- max active runs observed: {metrics.max_active_runs}")
    lines.append(f"- max active slots observed: {metrics.max_active_slots}")
    lines.append(f"- max call/result gap observed: {metrics.max_gap}")
    lines.append("")

    lines.append("## Breaker + Denial Breakdown")
    lines.append("")

    lines.append("### Circuit trips by reason")
    for reason, count in metrics.breaker_trips.most_common() or [("(none)", 0)]:
        lines.append(f"- {reason}: {count}")

    lines.append("")
    lines.append("### Run denials by code")
    for code, count in metrics.run_denials.most_common() or [("(none)", 0)]:
        lines.append(f"- {code}: {count}")

    lines.append("")
    lines.append("### Slot denials by code")
    for code, count in metrics.slot_denials.most_common() or [("(none)", 0)]:
        lines.append(f"- {code}: {count}")

    lines.append("")
    lines.append("### Tool-gate denials by code")
    for code, count in metrics.tool_gate_denials.most_common() or [("(none)", 0)]:
        lines.append(f"- {code}: {count}")

    lines.append("")
    lines.append("## Pressure + Circuit Status Samples")
    lines.append("")
    lines.append(f"- pressure=critical samples: {metrics.critical_status_samples}")
    lines.append(f"- pressure=warn samples: {metrics.warn_status_samples}")
    lines.append(f"- pressure=ok samples: {metrics.ok_status_samples}")
    lines.append(f"- circuit=open samples: {metrics.circuit_open_samples}")
    lines.append(f"- circuit=closed samples: {metrics.circuit_closed_samples}")

    lines.append("")
    lines.append("## Recommendations")
    lines.append("")
    for item in suggestions(metrics):
        lines.append(f"- {item}")

    lines.append("")
    lines.append("## Raw Event Counts")
    lines.append("")
    for kind, count in metrics.event_counts.most_common():
        lines.append(f"- {kind}: {count}")

    return "\n".join(lines) + "\n"


def main() -> None:
    args = parse_args()
    artifact_dir = Path(args.dir).expanduser().resolve()
    out_path = Path(args.out).expanduser().resolve() if args.out else artifact_dir / "soak-report.md"

    events = load_ndjson(artifact_dir / "orchestration-admission.ndjson")
    status_rows = load_ndjson(artifact_dir / "status.ndjson")
    workload_rows = load_ndjson(artifact_dir / "workload.ndjson")

    metrics = compute_metrics(events, status_rows)
    report = generate_report(artifact_dir, events, status_rows, workload_rows, metrics)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(report, encoding="utf-8")
    print(out_path)


if __name__ == "__main__":
    main()
