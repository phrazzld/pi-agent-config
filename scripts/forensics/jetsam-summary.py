#!/usr/bin/env python3
"""Quick summary for macOS JetsamEvent .ips reports.

Usage:
  python scripts/forensics/jetsam-summary.py /Library/Logs/DiagnosticReports/JetsamEvent-....ips
"""

from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path
from typing import Any


def load_jetsam_report(path: Path) -> dict[str, Any]:
    text = path.read_text(errors="ignore")
    start = text.find("\n{\n  \"build\"")
    if start == -1:
        start = text.find('{\n  "build"')
    if start == -1:
        raise ValueError("unable to locate report JSON payload")

    payload = text[start + 1 :] if text[start] == "\n" else text[start:]
    return json.loads(payload)


def mb_from_pages(pages: int, page_size: int) -> float:
    return pages * page_size / 1024 / 1024


def summarize(path: Path) -> None:
    report = load_jetsam_report(path)
    page_size = int(report.get("memoryStatus", {}).get("pageSize", 16_384))
    processes = report.get("processes", [])

    print(f"\n=== {path.name} ===")
    print(f"date: {report.get('date')}")
    print(f"largestProcess: {report.get('largestProcess')}")

    memory_pages = report.get("memoryStatus", {}).get("memoryPages", {})
    print(
        "memoryPages: "
        + ", ".join(f"{k}={v}" for k, v in memory_pages.items())
    )

    by_name: dict[str, dict[str, float]] = {}
    for proc in processes:
        name = str(proc.get("name", "?"))
        rpages = int(proc.get("rpages", 0))
        entry = by_name.setdefault(name, {"count": 0, "rpages": 0, "max": 0})
        entry["count"] += 1
        entry["rpages"] += rpages
        entry["max"] = max(entry["max"], rpages)

    print("top names by aggregate footprint:")
    top_names = sorted(by_name.items(), key=lambda item: item[1]["rpages"], reverse=True)[:20]
    for name, data in top_names:
        total_mb = mb_from_pages(int(data["rpages"]), page_size)
        max_mb = mb_from_pages(int(data["max"]), page_size)
        print(
            f"  {name[:42]:42} count={int(data['count']):4d} "
            f"total={total_mb:9.1f}MB max={max_mb:7.1f}MB"
        )

    nodes = [proc for proc in processes if str(proc.get("name")) == "node"]
    if nodes:
        rpages = [int(proc.get("rpages", 0)) for proc in nodes]
        p95 = statistics.quantiles(rpages, n=100)[94] if len(rpages) >= 100 else max(rpages)
        print(
            "node stats: "
            f"count={len(nodes)} "
            f"total={mb_from_pages(sum(rpages), page_size):.1f}MB "
            f"median={mb_from_pages(int(statistics.median(rpages)), page_size):.1f}MB "
            f"p95={mb_from_pages(int(p95), page_size):.1f}MB "
            f"max={mb_from_pages(max(rpages), page_size):.1f}MB"
        )

        age_seconds = [int(proc.get("age", 0)) / 1e9 for proc in nodes]
        younger_than_10s = sum(1 for age in age_seconds if age < 10)
        print(f"node age bucket: <10s={younger_than_10s}/{len(nodes)}")

        print("top node processes:")
        top_nodes = sorted(nodes, key=lambda proc: int(proc.get("rpages", 0)), reverse=True)[:15]
        for proc in top_nodes:
            rss_mb = mb_from_pages(int(proc.get("rpages", 0)), page_size)
            print(
                f"  pid={int(proc.get('pid', 0)):6d} "
                f"rss={rss_mb:7.1f}MB "
                f"age={int(proc.get('age', 0))/1e9:8.1f}s "
                f"fds={int(proc.get('fds', 0)):4d}"
            )

    reason_counts: dict[str, int] = {}
    for proc in processes:
        reason = str(proc.get("reason", "(none)"))
        reason_counts[reason] = reason_counts.get(reason, 0) + 1

    print("reason counts:")
    for reason, count in sorted(reason_counts.items(), key=lambda item: item[1], reverse=True):
        print(f"  {reason:28} {count}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Summarize macOS JetsamEvent report(s)")
    parser.add_argument("paths", nargs="+", help="path(s) to JetsamEvent .ips files")
    args = parser.parse_args()

    for raw in args.paths:
        path = Path(raw)
        if not path.exists():
            print(f"missing: {path}")
            continue
        try:
            summarize(path)
        except Exception as error:  # noqa: BLE001
            print(f"failed: {path} ({error})")


if __name__ == "__main__":
    main()
