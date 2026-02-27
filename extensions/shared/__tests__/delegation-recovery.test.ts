import { describe, expect, test } from "bun:test";

import {
  classifyRecoveryReason,
  createQuorumState,
  DEFAULT_RECOVERY_POLICY,
  evaluateQuorum,
  evaluateRecovery,
  hasLockIssue,
  resolveTaskRecoveryPolicy,
  totalAllowedAttempts,
  type TaskRecoveryPolicy,
} from "../delegation-recovery";
import { type DelegatedRunOutcome } from "../delegation-runner";

function outcome(overrides: Partial<DelegatedRunOutcome> = {}): DelegatedRunOutcome {
  return {
    exitCode: 0,
    stderr: "",
    aborted: false,
    health: {
      status: "ok",
      classification: "healthy",
      noProgressSeconds: 0,
      noEventSeconds: 0,
      lastAction: "assistant:message",
      warningCount: 0,
      stallEpisodes: 0,
    },
    ...overrides,
  };
}

describe("delegation recovery", () => {
  test("classifies health abort and lock contention", () => {
    expect(classifyRecoveryReason(outcome({ aborted: true, abortOrigin: "health" }))).toBe("health_abort");
    expect(classifyRecoveryReason(outcome({ exitCode: 1, stderr: "ELocked: lock file is already being held" }))).toBe("lock_contention");
  });

  test("evaluates retry decision for retryable failures", () => {
    const policy: TaskRecoveryPolicy = {
      ...DEFAULT_RECOVERY_POLICY,
      maxAttempts: 3,
      retryOn: ["lock_contention"],
      allowDegraded: false,
    };

    const decision = evaluateRecovery(
      {
        attempt: 1,
        reason: "lock_contention",
        output: "",
        outcome: outcome({ exitCode: 1, stderr: "lock busy" }),
      },
      policy,
    );

    expect(decision.action).toBe("retry");
  });

  test("allows degraded completion when output is substantive", () => {
    const decision = evaluateRecovery(
      {
        attempt: 1,
        reason: "stall",
        output: "x".repeat(160),
        outcome: outcome({
          exitCode: 1,
          aborted: true,
          abortOrigin: "health",
          health: {
            status: "aborted",
            classification: "stalled",
            noProgressSeconds: 120,
            noEventSeconds: 120,
            lastAction: "assistant:message",
            warningCount: 1,
            stallEpisodes: 1,
          },
        }),
      },
      {
        ...DEFAULT_RECOVERY_POLICY,
        allowDegraded: true,
        minDegradedOutputLength: 100,
      },
    );

    expect(decision.action).toBe("complete");
  });

  test("resolves policy overrides from env", () => {
    const policy = resolveTaskRecoveryPolicy(
      {
        PI_DELEGATED_RECOVERY_MAX_ATTEMPTS: "5",
        PI_DELEGATED_RECOVERY_ALLOW_DEGRADED: "true",
        PI_DELEGATED_RECOVERY_RETRY_ON: "stall,health_abort",
      },
      { label: "test" },
    );

    expect(policy.maxAttempts).toBe(5);
    expect(policy.allowDegraded).toBe(true);
    expect(policy.retryOn).toEqual(["stall", "health_abort"]);
  });

  test("quorum reaches completion after agreement", () => {
    const policy = resolveTaskRecoveryPolicy(
      {},
      {
        ...DEFAULT_RECOVERY_POLICY,
        quorum: {
          enabled: true,
          minSuccesses: 2,
          maxAttempts: 3,
          minOutputLength: 10,
        },
      },
    );

    const quorum = createQuorumState(policy);
    expect(quorum).not.toBeNull();

    const first = evaluateQuorum(quorum, "Result: use strategy A", 1);
    expect(first.action).toBe("continue");

    const second = evaluateQuorum(quorum, "Result: use strategy A", 2);
    expect(second.action).toBe("complete");
  });

  test("total attempts honors quorum max attempts", () => {
    const policy = resolveTaskRecoveryPolicy({}, {
      ...DEFAULT_RECOVERY_POLICY,
      maxAttempts: 2,
      quorum: {
        enabled: true,
        minSuccesses: 2,
        maxAttempts: 4,
        minOutputLength: 20,
      },
    });

    expect(totalAllowedAttempts(policy)).toBe(4);
  });

  test("detects lock issues from combined text", () => {
    expect(hasLockIssue("some", "ELocked", "output")).toBe(true);
    expect(hasLockIssue("clean", "", "")).toBe(false);
  });
});
