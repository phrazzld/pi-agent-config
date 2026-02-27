import { type DelegatedRunOutcome } from "./delegation-runner";

/**
 * Reasons why a delegated run might need recovery.
 */
export type RecoveryReason =
  | "stall"           // Health classification stalled/wedged
  | "lock_contention"  // Resource locking issues
  | "exit_code"        // Non-zero exit (system error or agent crash)
  | "governor_abort"   // Budget exceeded
  | "health_abort"     // Explicitly aborted by health monitor
  | "budget_abort"     // Runtime limit exceeded
  | "signal_abort"     // External signal
  | "unknown";

/**
 * Decisions the recovery logic can make.
 */
export type RecoveryDecision =
  | { action: "retry"; delayMs: number; reason: string }
  | { action: "fail"; reason: string }
  | { action: "complete"; reason: string }; // Use current output as final result

export interface TaskRecoveryPolicy {
  label: string;
  maxAttempts: number;
  retryOn: RecoveryReason[];
  /**
   * Exponential backoff: base * (multiplier ^ attempt)
   */
  backoff?: {
    baseMs: number;
    multiplier: number;
    maxDelayMs: number;
  };
  /**
   * If true, failures can be "completed" if they produced enough output.
   */
  allowDegraded?: boolean;
  minDegradedOutputLength?: number;
}

export interface TaskRecoveryContext {
  attempt: number;
  outcome: DelegatedRunOutcome;
  reason: RecoveryReason;
  output: string;
}

export const DEFAULT_RECOVERY_POLICY: TaskRecoveryPolicy = {
  label: "default",
  maxAttempts: 3,
  retryOn: ["lock_contention", "health_abort", "stall"],
  backoff: {
    baseMs: 500,
    multiplier: 2,
    maxDelayMs: 10_000,
  },
  allowDegraded: false,
};

export function classifyRecoveryReason(outcome: DelegatedRunOutcome): RecoveryReason {
  if (outcome.abortOrigin === "health") return "health_abort";
  if (outcome.abortOrigin === "budget") return "budget_abort";
  if (outcome.abortOrigin === "policy") return "governor_abort";
  if (outcome.abortOrigin === "signal") return "signal_abort";

  if (outcome.health.classification === "stalled" || outcome.health.classification === "wedged") {
    return "stall";
  }

  const stderr = (outcome.stderr || "").toLowerCase();
  if (stderr.includes("lock") || stderr.includes("eexist") || stderr.includes("busy")) {
    return "lock_contention";
  }

  if (outcome.exitCode !== 0) {
    return "exit_code";
  }

  return "unknown";
}

export function evaluateRecovery(
  ctx: TaskRecoveryContext,
  policy: TaskRecoveryPolicy
): RecoveryDecision {
  const { attempt, outcome, reason, output } = ctx;

  // 1. Success case
  if (outcome.exitCode === 0 && !outcome.aborted) {
    return { action: "complete", reason: "success" };
  }

  // 2. Degraded completion check
  // If the agent produced meaningful output but then failed/stalled, we might want to keep it.
  if (policy.allowDegraded && output.trim().length >= (policy.minDegradedOutputLength ?? 100)) {
    // Only allow degraded completion for certain failure types (e.g. stalls, not budget aborts)
    if (reason === "stall" || reason === "health_abort" || reason === "exit_code") {
      return { action: "complete", reason: `degraded_completion (${reason})` };
    }
  }

  // 3. Retry check
  if (attempt < policy.maxAttempts && policy.retryOn.includes(reason)) {
    const delayMs = calculateBackoff(attempt, policy);
    return { 
      action: "retry", 
      delayMs, 
      reason: `retrying ${reason} (attempt ${attempt}/${policy.maxAttempts})` 
    };
  }

  return { action: "fail", reason: `failed with ${reason} after ${attempt} attempts` };
}

export function calculateBackoff(attempt: number, policy: TaskRecoveryPolicy): number {
  if (!policy.backoff) return 0;
  const { baseMs, multiplier, maxDelayMs } = policy.backoff;
  // Use attempt - 1 so the first retry (attempt 2) uses baseMs * multiplier^0
  const delay = baseMs * Math.pow(multiplier, Math.max(0, attempt - 1));
  const jitter = delay * 0.1 * Math.random();
  return Math.min(delay + jitter, maxDelayMs);
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms));
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export function hasLockIssue(stderr?: string, error?: string, output?: string): boolean {
  const combined = `${stderr ?? ""} ${error ?? ""} ${output ?? ""}`.toLowerCase();
  return combined.includes("lock") || combined.includes("eexist") || combined.includes("busy");
}
