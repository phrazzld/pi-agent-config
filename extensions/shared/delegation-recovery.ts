import { type DelegatedRunOutcome } from "./delegation-runner";

export type RecoveryReason =
  | "stall"
  | "lock_contention"
  | "exit_code"
  | "governor_abort"
  | "health_abort"
  | "budget_abort"
  | "signal_abort"
  | "unknown";

export type RecoveryDecision =
  | { action: "retry"; delayMs: number; reason: string }
  | { action: "fail"; reason: string }
  | { action: "complete"; reason: string };

export interface QuorumPolicy {
  enabled: boolean;
  minSuccesses: number;
  maxAttempts: number;
  minOutputLength: number;
}

export interface TaskRecoveryPolicy {
  label: string;
  maxAttempts: number;
  retryOn: RecoveryReason[];
  backoff?: {
    baseMs: number;
    multiplier: number;
    maxDelayMs: number;
  };
  allowDegraded?: boolean;
  minDegradedOutputLength?: number;
  quorum?: QuorumPolicy;
}

export interface TaskRecoveryContext {
  attempt: number;
  outcome: DelegatedRunOutcome;
  reason: RecoveryReason;
  output: string;
}

interface QuorumBucket {
  count: number;
  sampleOutput: string;
}

export interface QuorumState {
  policy: QuorumPolicy;
  votes: Map<string, QuorumBucket>;
  totalVotes: number;
  winnerFingerprint?: string;
}

export interface QuorumDecision {
  action: "continue" | "complete" | "fail";
  reason: string;
  output?: string;
}

const DEFAULT_RETRY_ON: RecoveryReason[] = ["lock_contention", "health_abort", "stall"];

export const DEFAULT_RECOVERY_POLICY: TaskRecoveryPolicy = {
  label: "default",
  maxAttempts: 3,
  retryOn: DEFAULT_RETRY_ON,
  backoff: {
    baseMs: 500,
    multiplier: 2,
    maxDelayMs: 10_000,
  },
  allowDegraded: false,
  minDegradedOutputLength: 120,
  quorum: {
    enabled: false,
    minSuccesses: 2,
    maxAttempts: 3,
    minOutputLength: 80,
  },
};

export function resolveTaskRecoveryPolicy(
  env: Record<string, string | undefined> = process.env,
  overrides: Partial<TaskRecoveryPolicy> = {},
): TaskRecoveryPolicy {
  const base: TaskRecoveryPolicy = {
    ...DEFAULT_RECOVERY_POLICY,
    retryOn: [...DEFAULT_RECOVERY_POLICY.retryOn],
    backoff: DEFAULT_RECOVERY_POLICY.backoff ? { ...DEFAULT_RECOVERY_POLICY.backoff } : undefined,
    quorum: DEFAULT_RECOVERY_POLICY.quorum ? { ...DEFAULT_RECOVERY_POLICY.quorum } : undefined,
  };

  const envRetryOn = parseRetryOn(env.PI_DELEGATED_RECOVERY_RETRY_ON);
  const envQuorumEnabled = parseBoolean(env.PI_DELEGATED_RECOVERY_QUORUM_ENABLED, base.quorum?.enabled ?? false);

  const envPolicy: Partial<TaskRecoveryPolicy> = {
    maxAttempts: envInt(env.PI_DELEGATED_RECOVERY_MAX_ATTEMPTS, base.maxAttempts, 1, 20),
    retryOn: envRetryOn,
    allowDegraded: parseBoolean(env.PI_DELEGATED_RECOVERY_ALLOW_DEGRADED, base.allowDegraded ?? false),
    minDegradedOutputLength: envInt(
      env.PI_DELEGATED_RECOVERY_MIN_DEGRADED_OUTPUT_CHARS,
      base.minDegradedOutputLength ?? 120,
      1,
      20_000,
    ),
    backoff: {
      baseMs: envInt(env.PI_DELEGATED_RECOVERY_BACKOFF_BASE_MS, base.backoff?.baseMs ?? 500, 0, 60_000),
      multiplier: envFloat(env.PI_DELEGATED_RECOVERY_BACKOFF_MULTIPLIER, base.backoff?.multiplier ?? 2, 1, 8),
      maxDelayMs: envInt(env.PI_DELEGATED_RECOVERY_BACKOFF_MAX_MS, base.backoff?.maxDelayMs ?? 10_000, 0, 300_000),
    },
    quorum: {
      enabled: envQuorumEnabled,
      minSuccesses: envInt(
        env.PI_DELEGATED_RECOVERY_QUORUM_MIN_SUCCESSES,
        base.quorum?.minSuccesses ?? 2,
        1,
        10,
      ),
      maxAttempts: envInt(
        env.PI_DELEGATED_RECOVERY_QUORUM_MAX_ATTEMPTS,
        base.quorum?.maxAttempts ?? Math.max(base.maxAttempts, 3),
        1,
        20,
      ),
      minOutputLength: envInt(
        env.PI_DELEGATED_RECOVERY_QUORUM_MIN_OUTPUT_CHARS,
        base.quorum?.minOutputLength ?? 80,
        1,
        20_000,
      ),
    },
  };

  const merged: TaskRecoveryPolicy = {
    ...base,
    ...envPolicy,
    ...overrides,
    retryOn: [...(overrides.retryOn ?? envPolicy.retryOn ?? base.retryOn)],
    backoff: {
      ...base.backoff,
      ...envPolicy.backoff,
      ...overrides.backoff,
    },
    quorum: {
      ...base.quorum,
      ...envPolicy.quorum,
      ...overrides.quorum,
    } as QuorumPolicy,
  };

  merged.maxAttempts = Math.max(1, Math.floor(merged.maxAttempts));
  merged.retryOn = dedupeRetryReasons(merged.retryOn);
  merged.minDegradedOutputLength = Math.max(1, Math.floor(merged.minDegradedOutputLength ?? 120));

  if (merged.backoff) {
    merged.backoff.baseMs = Math.max(0, Math.floor(merged.backoff.baseMs));
    merged.backoff.multiplier = Math.max(1, merged.backoff.multiplier);
    merged.backoff.maxDelayMs = Math.max(0, Math.floor(merged.backoff.maxDelayMs));
  }

  if (merged.quorum) {
    merged.quorum.enabled = Boolean(merged.quorum.enabled);
    merged.quorum.minSuccesses = Math.max(1, Math.floor(merged.quorum.minSuccesses));
    merged.quorum.maxAttempts = Math.max(1, Math.floor(merged.quorum.maxAttempts));
    merged.quorum.minOutputLength = Math.max(1, Math.floor(merged.quorum.minOutputLength));
  }

  return merged;
}

export function totalAllowedAttempts(policy: TaskRecoveryPolicy): number {
  const quorumMax = policy.quorum?.enabled ? policy.quorum.maxAttempts : 0;
  return Math.max(1, policy.maxAttempts, quorumMax);
}

export function classifyRecoveryReason(outcome: DelegatedRunOutcome): RecoveryReason {
  if (outcome.abortOrigin === "health") return "health_abort";
  if (outcome.abortOrigin === "budget") return "budget_abort";
  if (outcome.abortOrigin === "policy") return "governor_abort";
  if (outcome.abortOrigin === "signal") return "signal_abort";

  if (outcome.health.classification === "stalled" || outcome.health.classification === "wedged") {
    return "stall";
  }

  if (hasLockIssue(outcome.stderr)) {
    return "lock_contention";
  }

  if (outcome.exitCode !== 0) {
    return "exit_code";
  }

  return "unknown";
}

export function isSuccessfulOutcome(outcome: DelegatedRunOutcome): boolean {
  return outcome.exitCode === 0 && !outcome.aborted;
}

export function evaluateRecovery(
  ctx: TaskRecoveryContext,
  policy: TaskRecoveryPolicy,
): RecoveryDecision {
  const { attempt, outcome, reason, output } = ctx;

  if (isSuccessfulOutcome(outcome)) {
    return { action: "complete", reason: "success" };
  }

  if (policy.allowDegraded && output.trim().length >= (policy.minDegradedOutputLength ?? 120)) {
    if (reason === "stall" || reason === "health_abort" || reason === "exit_code") {
      return { action: "complete", reason: `degraded_completion (${reason})` };
    }
  }

  if (attempt < policy.maxAttempts && policy.retryOn.includes(reason)) {
    return {
      action: "retry",
      delayMs: calculateBackoff(attempt, policy),
      reason: `retrying ${reason} (attempt ${attempt}/${policy.maxAttempts})`,
    };
  }

  return { action: "fail", reason: `failed with ${reason} after ${attempt} attempts` };
}

export function createQuorumState(policy: TaskRecoveryPolicy): QuorumState | null {
  if (!policy.quorum?.enabled) {
    return null;
  }

  return {
    policy: policy.quorum,
    votes: new Map<string, QuorumBucket>(),
    totalVotes: 0,
  };
}

export function evaluateQuorum(
  state: QuorumState | null,
  output: string,
  attempt: number,
): QuorumDecision {
  if (!state) {
    return { action: "complete", reason: "quorum_disabled", output };
  }

  const fingerprint = quorumFingerprint(output, state.policy.minOutputLength);
  if (fingerprint) {
    const existing = state.votes.get(fingerprint) ?? { count: 0, sampleOutput: output };
    existing.count += 1;
    if (!existing.sampleOutput && output) {
      existing.sampleOutput = output;
    }
    state.votes.set(fingerprint, existing);
    state.totalVotes += 1;

    const currentWinner = state.winnerFingerprint ? state.votes.get(state.winnerFingerprint) : undefined;
    if (!currentWinner || existing.count > currentWinner.count) {
      state.winnerFingerprint = fingerprint;
    }

    if (existing.count >= state.policy.minSuccesses) {
      return {
        action: "complete",
        reason: `quorum_satisfied (${existing.count}/${state.policy.minSuccesses})`,
        output: existing.sampleOutput,
      };
    }
  }

  if (attempt < state.policy.maxAttempts) {
    return {
      action: "continue",
      reason: `quorum_pending (${state.totalVotes}/${state.policy.minSuccesses})`,
    };
  }

  if (state.winnerFingerprint) {
    const winner = state.votes.get(state.winnerFingerprint);
    if (winner?.sampleOutput) {
      return {
        action: "complete",
        reason: `quorum_soft_miss (winner=${winner.count}/${state.policy.minSuccesses})`,
        output: winner.sampleOutput,
      };
    }
  }

  return {
    action: "fail",
    reason: `quorum_failed after ${attempt} attempts`,
  };
}

export function syntheticFailedOutcome(reason: string, stderr = ""): DelegatedRunOutcome {
  return {
    exitCode: 1,
    stderr,
    aborted: true,
    abortOrigin: "external",
    abortReason: reason,
    health: {
      status: "aborted",
      classification: "healthy",
      noProgressSeconds: 0,
      noEventSeconds: 0,
      lastAction: reason,
      warningCount: 0,
      stallEpisodes: 0,
    },
  };
}

export function calculateBackoff(attempt: number, policy: TaskRecoveryPolicy): number {
  if (!policy.backoff) {
    return 0;
  }

  const exp = Math.max(0, attempt - 1);
  const delay = policy.backoff.baseMs * Math.pow(policy.backoff.multiplier, exp);
  const jitter = delay * 0.1 * Math.random();
  return Math.min(delay + jitter, policy.backoff.maxDelayMs);
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function hasLockIssue(...values: Array<string | undefined>): boolean {
  const combined = values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .toLowerCase();

  if (!combined) {
    return false;
  }

  return /lock file is already being held|elocked|\block\b|eexist|busy/.test(combined);
}

function parseRetryOn(raw: string | undefined): RecoveryReason[] | undefined {
  if (!raw || !raw.trim()) {
    return undefined;
  }

  const parsed = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .filter(isRecoveryReason);

  return parsed.length > 0 ? dedupeRetryReasons(parsed) : undefined;
}

function isRecoveryReason(value: string): value is RecoveryReason {
  return [
    "stall",
    "lock_contention",
    "exit_code",
    "governor_abort",
    "health_abort",
    "budget_abort",
    "signal_abort",
    "unknown",
  ].includes(value);
}

function dedupeRetryReasons(reasons: RecoveryReason[]): RecoveryReason[] {
  const seen = new Set<RecoveryReason>();
  const out: RecoveryReason[] = [];
  for (const reason of reasons) {
    if (seen.has(reason)) {
      continue;
    }
    seen.add(reason);
    out.push(reason);
  }

  if (out.length === 0) {
    return [...DEFAULT_RETRY_ON];
  }

  return out;
}

function quorumFingerprint(output: string, minOutputLength: number): string {
  const normalized = output
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

  if (normalized.length < minOutputLength) {
    return "";
  }

  return normalized.slice(0, 2_000);
}

function envInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function envFloat(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (typeof raw !== "string") {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}
