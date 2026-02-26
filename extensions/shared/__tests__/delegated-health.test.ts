import { describe, expect, test } from "bun:test";

import {
  DelegatedRunHealthMonitor,
  resolveDelegatedHealthPolicy,
  type DelegatedHealthPolicy,
} from "../delegated-health";

function createMonitor(
  nowRef: { value: number },
  policyOverrides: Partial<DelegatedHealthPolicy> = {},
): DelegatedRunHealthMonitor {
  const policy = {
    ...resolveDelegatedHealthPolicy({}, {
      pollIntervalMs: 1_000,
      warnNoProgressMs: 60_000,
      abortNoProgressMs: 10 * 60_000,
      abortQuickToolMs: 2 * 60_000,
      abortActiveToolMs: 20 * 60_000,
      warnCooldownMs: 30_000,
      disableAbort: false,
    }),
    ...policyOverrides,
  };
  return new DelegatedRunHealthMonitor("test-run", policy, () => nowRef.value);
}

describe("delegated run health monitor", () => {
  test("does not abort long productive runs with periodic progress", () => {
    const nowRef = { value: 0 };
    const monitor = createMonitor(nowRef);

    monitor.noteProgress("start", "fp:0");

    for (let i = 1; i <= 12; i += 1) {
      nowRef.value += 10 * 60_000;
      monitor.noteProgress(`tick:${i}`, `fp:${i}`);
      const evaluation = monitor.evaluate();
      expect(evaluation.abortReason).toBeUndefined();
      expect(evaluation.snapshot.classification).toBe("healthy");
    }

    const summary = monitor.summary("ok");
    expect(summary.status).toBe("ok");
    expect(summary.classification).toBe("healthy");
  });

  test("aborts stalled quick tools quickly", () => {
    const nowRef = { value: 0 };
    const monitor = createMonitor(nowRef, {
      warnNoProgressMs: 30_000,
      abortQuickToolMs: 90_000,
      abortNoProgressMs: 10 * 60_000,
      abortActiveToolMs: 20 * 60_000,
    });

    monitor.noteToolStart("read");

    nowRef.value += 45_000;
    let evaluation = monitor.evaluate();
    expect(evaluation.abortReason).toBeUndefined();
    expect(evaluation.snapshot.classification).toBe("slow");

    nowRef.value += 50_000;
    evaluation = monitor.evaluate();
    expect(evaluation.abortReason).toBeDefined();
    expect(evaluation.abortReason).toContain("tool=read");
    expect(evaluation.snapshot.classification === "stalled" || evaluation.snapshot.classification === "wedged").toBe(true);
  });

  test("uses larger no-progress window for active bash tools", () => {
    const nowRef = { value: 0 };
    const monitor = createMonitor(nowRef, {
      warnNoProgressMs: 30_000,
      abortQuickToolMs: 90_000,
      abortNoProgressMs: 5 * 60_000,
      abortActiveToolMs: 15 * 60_000,
    });

    monitor.noteToolStart("bash");

    nowRef.value += 6 * 60_000;
    let evaluation = monitor.evaluate();
    expect(evaluation.abortReason).toBeUndefined();
    expect(evaluation.snapshot.classification).toBe("slow");

    nowRef.value += 10 * 60_000;
    evaluation = monitor.evaluate();
    expect(evaluation.abortReason).toBeDefined();
    expect(evaluation.abortReason).toContain("tool=bash");
  });

  test("supports warnings-only mode without aborting", () => {
    const nowRef = { value: 0 };
    const monitor = createMonitor(nowRef, {
      disableAbort: true,
      warnNoProgressMs: 20_000,
      abortQuickToolMs: 40_000,
    });

    monitor.noteToolStart("read");
    nowRef.value += 25_000;
    const evaluationA = monitor.evaluate();
    expect(evaluationA.warning).toContain("[delegated-health]");
    expect(evaluationA.abortReason).toBeUndefined();

    nowRef.value += 60_000;
    const evaluationB = monitor.evaluate();
    expect(evaluationB.abortReason).toBeUndefined();
    expect(evaluationB.snapshot.classification === "stalled" || evaluationB.snapshot.classification === "wedged").toBe(true);
  });
});
