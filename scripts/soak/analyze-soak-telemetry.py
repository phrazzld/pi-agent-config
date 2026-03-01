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


def admission_event_paths(artifact_dir: Path) -> list[Path]:
    """Return base + rotated admission event logs."""

    def sort_key(path: Path) -> tuple[int, str]:
        # base file (no numeric suffix) first, then numeric suffix order.
        if path.name == "orchestration-admission.ndjson":
            return (0, path.name)
        suffix = path.name.rsplit(".", 1)[-1]
        if suffix.isdigit():
            return (int(suffix), path.name)
        return (9_999_999, path.name)

    return sorted(
        [p for p in artifact_dir.glob("orchestration-admission.ndjson*") if p.is_file()],
        key=sort_key,
    )


def load_ndjson_many(paths: list[Path]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in paths:
        rows.extend(load_ndjson(path))
    return rows


@dataclass
class WorkloadMetrics:
    event_counts: Counter
    run_denials: Counter
    run_completed: Counter
    depth_probe_rejections: Counter
    gap_probe_rejections: Counter
    total_run_completed: int
    total_run_denied: int
    total_depth_probe: int
    burst_slot_granted: int
    burst_slot_denied: int


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


def compute_workload_metrics(workload_rows: list[dict[str, Any]]) -> WorkloadMetrics:
    event_counts: Counter = Counter()
    run_denials: Counter = Counter()
    run_completed: Counter = Counter()
    depth_probe_rejections: Counter = Counter()
    gap_probe_rejections: Counter = Counter()

    total_run_completed = 0
    total_run_denied = 0
    total_depth_probe = 0
    burst_slot_granted = 0
    burst_slot_denied = 0

    for row in workload_rows:
        kind = str(row.get("kind", "unknown"))
        event_counts[kind] += 1
        detail = row.get("detail") or {}

        if kind == "run_denied":
            total_run_denied += 1
            run_denials[str(detail.get("code", "UNKNOWN"))] += 1
        elif kind == "run_completed":
            total_run_completed += 1
            run_completed[str(detail.get("runKind", "unknown"))] += 1
            slot_attempts = int(detail.get("slotAttempts") or 0)
            requested_parallelism = int(detail.get("requestedParallelism") or 0)
            if slot_attempts > requested_parallelism:
                burst_slot_granted += int(detail.get("grantedSlots") or 0)
                burst_slot_denied += int(detail.get("deniedSlots") or 0)
        elif kind == "depth_probe":
            total_depth_probe += 1
            if detail.get("ok"):
                depth_probe_rejections["ok"] += 1
            else:
                depth_probe_rejections[str(detail.get("rejection", "UNKNOWN"))] += 1
        elif kind == "gap_probe":
            if detail.get("ok"):
                gap_probe_rejections["ok"] += 1
            else:
                gap_probe_rejections[str(detail.get("rejection", "UNKNOWN"))] += 1

    return WorkloadMetrics(
        event_counts=event_counts,
        run_denials=run_denials,
        run_completed=run_completed,
        depth_probe_rejections=depth_probe_rejections,
        gap_probe_rejections=gap_probe_rejections,
        total_run_completed=total_run_completed,
        total_run_denied=total_run_denied,
        total_depth_probe=total_depth_probe,
        burst_slot_granted=burst_slot_granted,
        burst_slot_denied=burst_slot_denied,
    )


def ratio(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return numerator / denominator


def suggestions(metrics: SoakMetrics, workload: WorkloadMetrics) -> list[str]:
    out: list[str] = []

    run_total = metrics.total_run_allowed + metrics.total_run_denied
    slot_total = metrics.total_slot_allowed + metrics.total_slot_denied
    operational_total = workload.total_run_completed + workload.total_run_denied

    run_denial_ratio = ratio(metrics.total_run_denied, run_total)
    slot_denial_ratio = ratio(metrics.total_slot_denied, slot_total)
    operational_denial_ratio = ratio(workload.total_run_denied, operational_total)

    critical_ratio = ratio(
        metrics.critical_status_samples,
        metrics.critical_status_samples + metrics.warn_status_samples + metrics.ok_status_samples,
    )

    if metrics.run_denials.get("RUN_CAP_REACHED", 0) > 0:
        out.append("RUN_CAP_REACHED denials observed. Consider raising PI_ORCH_ADM_MAX_RUNS if latency is user-visible.")
    else:
        out.append("No RUN_CAP_REACHED denials observed; no evidence to raise PI_ORCH_ADM_MAX_RUNS from this soak.")

    if metrics.slot_denials.get("SLOT_CAP_REACHED", 0) > 0:
        if workload.burst_slot_denied > 0 and workload.burst_slot_granted > 0:
            burst_ratio = ratio(workload.burst_slot_denied, workload.burst_slot_denied + workload.burst_slot_granted)
            out.append(
                f"SLOT_CAP_REACHED denials were concentrated in burst scenarios (burst deny ratio {burst_ratio:.1%}); keep PI_ORCH_ADM_MAX_SLOTS unless interactive lanes starve."
            )
        elif slot_denial_ratio > 0.30 and critical_ratio < 0.1:
            out.append("High slot denial ratio outside critical pressure. Consider tuning PI_ORCH_ADM_MAX_SLOTS or team concurrency defaults.")

    gap_trips = metrics.breaker_trips.get("call_result_gap", 0)
    if gap_trips >= 3:
        out.append(
            "call_result_gap breaker dominated trips; tighten recovery latency (recommend PI_ORCH_ADM_BREAKER_COOLDOWN_MS=30000, PI_ORCH_ADM_GAP_RESET_QUIET_MS=45000)."
        )

    if workload.total_depth_probe > 0 and workload.depth_probe_rejections.get("DEPTH_EXCEEDED", 0) == workload.total_depth_probe:
        out.append("Depth guard behaved as expected: 100% of synthetic depth probes were rejected with DEPTH_EXCEEDED.")

    if run_denial_ratio > 0.20 and operational_denial_ratio < run_denial_ratio:
        out.append(
            "Aggregate run denial ratio is inflated by synthetic probes/cooldowns; use workload operational ratio for capacity tuning decisions."
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


def load_summary(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def generate_report(
    artifact_dir: Path,
    event_files: list[Path],
    events: list[dict[str, Any]],
    status_rows: list[dict[str, Any]],
    workload_rows: list[dict[str, Any]],
    metrics: SoakMetrics,
    workload: WorkloadMetrics,
    summary: dict[str, Any],
) -> str:
    ts_values = [int(row.get("ts", 0)) for row in workload_rows if int(row.get("ts", 0)) > 0]
    first_ts = min(ts_values) if ts_values else 0
    last_ts = max(ts_values) if ts_values else 0

    run_total = metrics.total_run_allowed + metrics.total_run_denied
    slot_total = metrics.total_slot_allowed + metrics.total_slot_denied

    run_denial_ratio = ratio(metrics.total_run_denied, run_total)
    slot_denial_ratio = ratio(metrics.total_slot_denied, slot_total)

    operational_total = workload.total_run_completed + workload.total_run_denied
    operational_run_denial_ratio = ratio(workload.total_run_denied, operational_total)

    probe_inclusive_total = workload.total_run_completed + workload.total_run_denied + workload.total_depth_probe
    probe_inclusive_denial_ratio = ratio(workload.total_run_denied + workload.total_depth_probe, probe_inclusive_total)

    lines: list[str] = []
    lines.append("# Mixed-Workload Soak Report")
    lines.append("")
    lines.append(f"- artifact dir: `{artifact_dir}`")
    lines.append(f"- workload start (UTC): {to_iso(first_ts if first_ts > 0 else None)}")
    lines.append(f"- workload end (UTC): {to_iso(last_ts if last_ts > 0 else None)}")
    lines.append(f"- admission event files: {len(event_files)} ({', '.join(path.name for path in event_files)})")
    lines.append(f"- admission events: {len(events)}")
    lines.append(f"- status samples: {len(status_rows)}")
    lines.append(f"- workload events: {len(workload_rows)}")
    lines.append("")

    policy = ((summary.get("finalStatus") or {}).get("policy") or {}) if summary else {}
    if policy:
        lines.append("## Policy Snapshot (run-end)")
        lines.append("")
        lines.append(f"- maxInFlightRuns: {policy.get('maxInFlightRuns')}")
        lines.append(f"- maxInFlightSlots: {policy.get('maxInFlightSlots')}")
        lines.append(f"- maxDepth: {policy.get('maxDepth')}")
        lines.append(f"- breakerCooldownMs: {policy.get('breakerCooldownMs')}")
        lines.append(f"- maxCallResultGap: {policy.get('maxCallResultGap')}")
        lines.append(f"- gapResetQuietMs: {policy.get('gapResetQuietMs')}")
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

    lines.append("## Workload-normalized View")
    lines.append("")
    lines.append(f"- run completed (workload): {workload.total_run_completed}")
    lines.append(f"- run denied (workload): {workload.total_run_denied}")
    lines.append(f"- depth probes: {workload.total_depth_probe} (all expected denials by design)")
    lines.append(f"- operational run denial ratio (completed vs denied): {operational_run_denial_ratio:.1%}")
    lines.append(f"- probe-inclusive denial ratio: {probe_inclusive_denial_ratio:.1%}")
    if workload.burst_slot_granted + workload.burst_slot_denied > 0:
        burst_ratio = ratio(workload.burst_slot_denied, workload.burst_slot_granted + workload.burst_slot_denied)
        lines.append(
            f"- burst slot denial ratio: {burst_ratio:.1%} (expected from synthetic over-cap slot attempts)"
        )
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
    lines.append("### Workload denials by code")
    for code, count in workload.run_denials.most_common() or [("(none)", 0)]:
        lines.append(f"- {code}: {count}")

    lines.append("")
    lines.append("### Gap-probe outcomes")
    for code, count in workload.gap_probe_rejections.most_common() or [("(none)", 0)]:
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
    for item in suggestions(metrics, workload):
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

    event_files = admission_event_paths(artifact_dir)
    events = load_ndjson_many(event_files)
    status_rows = load_ndjson(artifact_dir / "status.ndjson")
    workload_rows = load_ndjson(artifact_dir / "workload.ndjson")
    summary = load_summary(artifact_dir / "summary.json")

    metrics = compute_metrics(events, status_rows)
    workload = compute_workload_metrics(workload_rows)
    report = generate_report(artifact_dir, event_files, events, status_rows, workload_rows, metrics, workload, summary)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(report, encoding="utf-8")
    print(out_path)


if __name__ == "__main__":
    main()
