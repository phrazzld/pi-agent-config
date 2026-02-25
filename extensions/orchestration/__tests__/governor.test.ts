import { describe, expect, test } from "bun:test";

import {
  AdaptiveGovernor,
  resolveGovernorPolicy,
  type GovernorPolicy,
  type GovernorUsageSnapshot,
} from "../governor";

function usageSnapshot(overrides?: Partial<GovernorUsageSnapshot>): GovernorUsageSnapshot {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    ...overrides,
  };
}

function withPolicyOverrides(policy: GovernorPolicy, overrides: Partial<GovernorPolicy>): GovernorPolicy {
  return {
    ...policy,
    ...overrides,
  };
}

describe("orchestration adaptive governor", () => {
  test("resolves defaults and override knobs", () => {
    const defaultPolicy = resolveGovernorPolicy(undefined, {});
    expect(defaultPolicy.mode).toBe("warn");
    expect(defaultPolicy.checkIntervalMs).toBe(75_000);
    expect(defaultPolicy.windowMs).toBe(180_000);
    expect(defaultPolicy.emergencyFuseMs).toBe(14_400_000);

    const overridden = resolveGovernorPolicy(
      {
        mode: "enforce",
        maxCostUsd: 1.25,
        maxTokens: 250_000,
        emergencyFuseSeconds: 3_600,
      },
      {
        PI_ORCH_GOV_CHECK_SECONDS: "30",
        PI_ORCH_GOV_WINDOW_SECONDS: "120",
      },
    );

    expect(overridden.mode).toBe("enforce");
    expect(overridden.maxCostUsd).toBe(1.25);
    expect(overridden.maxTokens).toBe(250_000);
    expect(overridden.emergencyFuseMs).toBe(3_600_000);
    expect(overridden.checkIntervalMs).toBe(30_000);
    expect(overridden.windowMs).toBe(120_000);
  });

  test("keeps productive long-running execution alive in enforce mode", () => {
    const policy = withPolicyOverrides(resolveGovernorPolicy({ mode: "enforce" }, {}), {
      checkIntervalMs: 60_000,
      windowMs: 180_000,
      emergencyFuseMs: 6 * 60 * 60 * 1000,
    });

    const governor = new AdaptiveGovernor(policy, 0);
    const usage = usageSnapshot();

    let now = 0;
    let lastAction: "none" | "warn" | "abort" = "none";

    for (let index = 0; index < 30; index++) {
      const callId = `call-${index}`;
      governor.recordToolStart(callId, "read", { path: `src/file-${index}.ts` }, now + 1_000);
      governor.recordToolEnd(callId, "read", false, now + 2_000);
      governor.recordAssistantMessage("x".repeat(420), now + 3_000);

      usage.input += 300;
      usage.output += 220;
      usage.cost += 0.005;

      const decision = governor.evaluate(now + 60_000, usage);
      lastAction = decision.action;
      expect(decision.action).not.toBe("abort");

      now += 60_000;
    }

    expect(lastAction).toBe("none");
    const summary = governor.summarize(now, usage, false);
    expect(summary.status).toBe("ok");
  });

  test("aborts clear loop patterns in enforce mode", () => {
    const policy = withPolicyOverrides(resolveGovernorPolicy({ mode: "enforce" }, {}), {
      checkIntervalMs: 20_000,
      windowMs: 180_000,
      emergencyFuseMs: 6 * 60 * 60 * 1000,
    });

    const governor = new AdaptiveGovernor(policy, 0);
    const usage = usageSnapshot();

    governor.recordToolStart("seed", "grep", { pattern: "TODO", path: "src" }, 0);
    governor.recordToolEnd("seed", "grep", false, 1_000);

    let now = 10 * 60 * 1000;
    let decision = governor.evaluate(now, usage);
    expect(decision.action).not.toBe("abort");

    for (let index = 0; index < 4; index++) {
      const callId = `loop-${index}`;
      const at = now + index * 10_000;
      governor.recordToolStart(callId, "grep", { pattern: "TODO", path: "src" }, at);
      governor.recordToolEnd(callId, "grep", false, at + 2_000);
    }

    decision = governor.evaluate(now + 45_000, usage);
    expect(decision.action).toBe("abort");
    expect(decision.reason).toBe("loop_detected");
  });

  test("warn mode emits warnings for budget overruns without aborting", () => {
    const policy = resolveGovernorPolicy({ mode: "warn", maxCostUsd: 0.5 }, {});
    const governor = new AdaptiveGovernor(policy, 0);

    const decision = governor.evaluate(5_000, usageSnapshot({ cost: 0.8 }));
    expect(decision.action).toBe("warn");
    expect(decision.reason).toBe("budget_cost_exceeded");

    const summary = governor.summarize(5_000, usageSnapshot({ cost: 0.8 }), false);
    expect(summary.status).toBe("warned");
  });

  test("observe mode never aborts, even on prolonged low progress", () => {
    const policy = withPolicyOverrides(resolveGovernorPolicy({ mode: "observe" }, {}), {
      checkIntervalMs: 30_000,
      windowMs: 120_000,
      emergencyFuseMs: 2 * 60 * 60 * 1000,
    });

    const governor = new AdaptiveGovernor(policy, 0);
    const usage = usageSnapshot();

    let action: "none" | "warn" | "abort" = "none";
    for (let step = 1; step <= 12; step++) {
      const decision = governor.evaluate(step * 180_000, usage);
      action = decision.action;
      expect(decision.action).not.toBe("abort");
    }

    expect(action).toBe("none");
    const summary = governor.summarize(12 * 180_000, usage, false);
    expect(summary.mode).toBe("observe");
  });
});
