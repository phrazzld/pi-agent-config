export type GovernorMode = "observe" | "warn" | "enforce";

export type GovernorReason =
  | "low_progress"
  | "loop_detected"
  | "retry_churn"
  | "budget_cost_exceeded"
  | "budget_tokens_exceeded"
  | "emergency_fuse_exceeded";

export interface GovernorOverrides {
  mode?: GovernorMode;
  maxCostUsd?: number;
  maxTokens?: number;
  emergencyFuseSeconds?: number;
}

export interface GovernorPolicy {
  mode: GovernorMode;
  checkIntervalMs: number;
  windowMs: number;
  emergencyFuseMs: number;
  maxCostUsd?: number;
  maxTokens?: number;
}

export interface GovernorUsageSnapshot {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface GovernorDecision {
  action: "none" | "warn" | "abort";
  reason?: GovernorReason;
  message?: string;
  snapshot: GovernorSnapshot;
}

export interface GovernorSummary {
  mode: GovernorMode;
  status: "ok" | "warned" | "aborted";
  reason?: GovernorReason;
  elapsedSeconds: number;
  checks: number;
  strikes: number;
  strikeBudget: number;
  windowScore: number;
  minScore: number;
  lastSignalAgeSeconds: number;
  warnings: string[];
}

export interface GovernorSnapshot {
  elapsedMs: number;
  windowScore: number;
  minScore: number;
  strikeBudget: number;
  strikes: number;
  lastSignalAgeMs: number;
  loopDetected: boolean;
  retryChurn: boolean;
}

interface GovernorEvent {
  at: number;
  kind: "tool_start" | "tool_end_success" | "tool_end_error" | "assistant";
  signature?: string;
  novel?: boolean;
  verification?: boolean;
  chars?: number;
}

const DEFAULT_MODE: GovernorMode = "warn";
const DEFAULT_CHECK_INTERVAL_MS = 75_000;
const DEFAULT_WINDOW_MS = 180_000;
const DEFAULT_EMERGENCY_FUSE_MS = 14_400_000;

const SCORE_MIN = -4;
const SCORE_MAX = 6;

export function resolveGovernorPolicy(
  overrides: GovernorOverrides | undefined,
  env: Record<string, string | undefined> = process.env,
): GovernorPolicy {
  const mode = normalizeMode(overrides?.mode ?? env.PI_ORCH_GOV_MODE) ?? DEFAULT_MODE;

  const checkIntervalMs = Math.max(
    15_000,
    resolveNumber(env.PI_ORCH_GOV_CHECK_SECONDS, DEFAULT_CHECK_INTERVAL_MS / 1000) * 1000,
  );
  const windowMs = Math.max(
    checkIntervalMs,
    resolveNumber(env.PI_ORCH_GOV_WINDOW_SECONDS, DEFAULT_WINDOW_MS / 1000) * 1000,
  );

  const emergencyFuseSeconds =
    overrides?.emergencyFuseSeconds ??
    resolveNumber(env.PI_ORCH_GOV_EMERGENCY_FUSE_SECONDS, DEFAULT_EMERGENCY_FUSE_MS / 1000);

  const maxCostUsd =
    sanitizePositiveNumber(overrides?.maxCostUsd) ?? sanitizePositiveNumber(resolveOptionalNumber(env.PI_ORCH_GOV_MAX_COST_USD));

  const maxTokens =
    sanitizePositiveInteger(overrides?.maxTokens) ?? sanitizePositiveInteger(resolveOptionalNumber(env.PI_ORCH_GOV_MAX_TOKENS));

  return {
    mode,
    checkIntervalMs,
    windowMs,
    emergencyFuseMs: Math.max(60_000, emergencyFuseSeconds * 1000),
    maxCostUsd,
    maxTokens,
  };
}

export class AdaptiveGovernor {
  private readonly events: GovernorEvent[] = [];
  private readonly callSignatures = new Map<string, string>();
  private readonly seenSignatures = new Set<string>();
  private readonly signatureHistory: string[] = [];
  private readonly warnings: string[] = [];
  private readonly warnedReasonKinds = new Set<string>();
  private readonly startedAtMs: number;

  private checks = 0;
  private strikes = 0;
  private failureStreak = 0;
  private lastFailureSignature: string | null = null;
  private lastSignalAtMs: number;
  private lastReason: GovernorReason | undefined;
  private abortedReason: GovernorReason | undefined;

  constructor(readonly policy: GovernorPolicy, startedAtMs = Date.now()) {
    this.startedAtMs = startedAtMs;
    this.lastSignalAtMs = startedAtMs;
  }

  recordToolStart(toolCallId: string, toolName: string, args: unknown, at = Date.now()): void {
    const signature = buildToolSignature(toolName, args);
    const novel = !this.seenSignatures.has(signature);
    if (novel) {
      this.seenSignatures.add(signature);
    }

    const verification = isVerificationToolInvocation(toolName, args);

    this.callSignatures.set(toolCallId, signature);
    this.signatureHistory.push(signature);
    if (this.signatureHistory.length > 12) {
      this.signatureHistory.splice(0, this.signatureHistory.length - 12);
    }

    this.events.push({
      at,
      kind: "tool_start",
      signature,
      novel,
      verification,
    });
    this.lastSignalAtMs = at;
    this.prune(at);
  }

  recordToolEnd(toolCallId: string, toolName: string, isError: boolean, at = Date.now()): void {
    const signature = this.callSignatures.get(toolCallId) ?? buildToolSignature(toolName, {});
    this.callSignatures.delete(toolCallId);

    if (isError) {
      if (this.lastFailureSignature === signature) {
        this.failureStreak += 1;
      } else {
        this.failureStreak = 1;
        this.lastFailureSignature = signature;
      }
    } else {
      this.failureStreak = 0;
      this.lastFailureSignature = null;
    }

    this.events.push({
      at,
      kind: isError ? "tool_end_error" : "tool_end_success",
      signature,
    });
    this.lastSignalAtMs = at;
    this.prune(at);
  }

  recordAssistantMessage(text: string, at = Date.now()): void {
    const chars = text.trim().length;
    if (chars <= 0) {
      return;
    }

    this.events.push({
      at,
      kind: "assistant",
      chars,
    });
    this.lastSignalAtMs = at;
    this.prune(at);
  }

  evaluate(nowMs: number, usage: GovernorUsageSnapshot): GovernorDecision {
    const snapshot = this.computeSnapshot(nowMs, usage);
    this.checks += 1;

    const directReason = this.resolveDirectReason(snapshot, usage);
    if (directReason) {
      return this.buildReasonDecision(directReason, snapshot);
    }

    if (snapshot.windowScore < snapshot.minScore) {
      this.strikes += 1;
    } else {
      this.strikes = Math.max(0, this.strikes - 1);
    }

    snapshot.strikes = this.strikes;

    if (this.strikes > snapshot.strikeBudget) {
      return this.buildReasonDecision("low_progress", snapshot);
    }

    if (snapshot.windowScore < snapshot.minScore && this.policy.mode !== "observe") {
      const message = `governor warning: score ${snapshot.windowScore.toFixed(2)} < min ${snapshot.minScore.toFixed(2)} (strike ${this.strikes}/${snapshot.strikeBudget})`;
      this.addWarning("low_progress", message);
      this.lastReason = "low_progress";
      return {
        action: "warn",
        reason: "low_progress",
        message,
        snapshot,
      };
    }

    return {
      action: "none",
      snapshot,
    };
  }

  summarize(nowMs: number, usage: GovernorUsageSnapshot, aborted: boolean): GovernorSummary {
    const snapshot = this.computeSnapshot(nowMs, usage);
    const reason = aborted ? this.abortedReason ?? this.lastReason : this.lastReason;

    let status: GovernorSummary["status"] = "ok";
    if (aborted) {
      status = "aborted";
    } else if (this.warnings.length > 0 || this.strikes > 0) {
      status = "warned";
    }

    return {
      mode: this.policy.mode,
      status,
      reason,
      elapsedSeconds: Math.round(snapshot.elapsedMs / 1000),
      checks: this.checks,
      strikes: this.strikes,
      strikeBudget: snapshot.strikeBudget,
      windowScore: Number(snapshot.windowScore.toFixed(3)),
      minScore: snapshot.minScore,
      lastSignalAgeSeconds: Math.round(snapshot.lastSignalAgeMs / 1000),
      warnings: [...this.warnings],
    };
  }

  private resolveDirectReason(snapshot: GovernorSnapshot, usage: GovernorUsageSnapshot): GovernorReason | null {
    if (snapshot.elapsedMs > this.policy.emergencyFuseMs) {
      return "emergency_fuse_exceeded";
    }

    if (this.policy.maxCostUsd !== undefined && usage.cost > this.policy.maxCostUsd) {
      return "budget_cost_exceeded";
    }

    const totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    if (this.policy.maxTokens !== undefined && totalTokens > this.policy.maxTokens) {
      return "budget_tokens_exceeded";
    }

    if (snapshot.loopDetected) {
      return "loop_detected";
    }

    if (snapshot.retryChurn) {
      return "retry_churn";
    }

    return null;
  }

  private buildReasonDecision(reason: GovernorReason, snapshot: GovernorSnapshot): GovernorDecision {
    this.lastReason = reason;

    const message = reasonMessage(reason, snapshot);
    const action = this.resolveAction();

    this.addWarning(reason, message);

    if (action === "abort") {
      this.abortedReason = reason;
    }

    return {
      action,
      reason,
      message,
      snapshot,
    };
  }

  private resolveAction(): GovernorDecision["action"] {
    if (this.policy.mode === "enforce") {
      return "abort";
    }

    if (this.policy.mode === "warn") {
      return "warn";
    }

    // observe mode never interrupts execution
    return "none";
  }

  private addWarning(reason: string, message: string): void {
    const key = `${reason}:${message}`;
    if (this.warnedReasonKinds.has(key)) {
      return;
    }
    this.warnedReasonKinds.add(key);
    this.warnings.push(message);
  }

  private computeSnapshot(nowMs: number, _usage: GovernorUsageSnapshot): GovernorSnapshot {
    const elapsedMs = Math.max(0, nowMs - this.startedAtMs);
    const threshold = thresholdsForElapsed(elapsedMs);
    const minWindowTs = nowMs - this.policy.windowMs;
    const windowEvents = this.events.filter((event) => event.at >= minWindowTs);

    let toolStarts = 0;
    let toolStartNovel = 0;
    let toolStartVerification = 0;
    let toolEndOk = 0;
    let toolEndError = 0;
    let assistantChars = 0;

    for (const event of windowEvents) {
      switch (event.kind) {
        case "tool_start":
          toolStarts += 1;
          if (event.novel) {
            toolStartNovel += 1;
          }
          if (event.verification) {
            toolStartVerification += 1;
          }
          break;
        case "tool_end_success":
          toolEndOk += 1;
          break;
        case "tool_end_error":
          toolEndError += 1;
          break;
        case "assistant":
          assistantChars += event.chars ?? 0;
          break;
      }
    }

    const loopSoft = hasRepeatedTail(this.signatureHistory, 3) && assistantChars < 250;
    const loopHard =
      elapsedMs >= 10 * 60 * 1000 &&
      hasRepeatedTail(this.signatureHistory, 4) &&
      assistantChars < 120 &&
      toolStartNovel === 0;

    let score = 0;
    score += Math.min(0.8, toolStarts * 0.2);
    score += Math.min(2.4, toolEndOk * 0.8);
    score += Math.min(1.2, toolStartNovel * 0.4);

    if (assistantChars >= 900) {
      score += 0.9;
    } else if (assistantChars >= 250) {
      score += 0.4;
    }

    if (toolStartVerification > 0) {
      score += 0.8;
    }

    if (toolEndError > 0 && toolEndOk > 0 && toolEndOk >= toolEndError) {
      score += 0.4;
    }

    score -= Math.min(2.7, toolEndError * 0.9);

    if (loopSoft) {
      score -= 1.2;
    }

    if (this.failureStreak >= 2) {
      score -= 0.6;
    }

    const idleMs = Math.max(0, nowMs - this.lastSignalAtMs);
    if (idleMs > 90_000) {
      const idlePenaltyMinutes = Math.ceil((idleMs - 90_000) / 60_000);
      score -= idlePenaltyMinutes * 0.35;
    }

    score = clamp(score, SCORE_MIN, SCORE_MAX);

    return {
      elapsedMs,
      windowScore: score,
      minScore: threshold.minScore,
      strikeBudget: threshold.strikeBudget,
      strikes: this.strikes,
      lastSignalAgeMs: idleMs,
      loopDetected: loopHard,
      retryChurn: this.failureStreak >= 3,
    };
  }

  private prune(nowMs: number): void {
    const retainSince = nowMs - Math.max(this.policy.windowMs * 4, 15 * 60 * 1000);
    let removeCount = 0;
    for (const event of this.events) {
      if (event.at < retainSince) {
        removeCount += 1;
      } else {
        break;
      }
    }

    if (removeCount > 0) {
      this.events.splice(0, removeCount);
    }
  }
}

function normalizeMode(value: unknown): GovernorMode | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "observe" || normalized === "warn" || normalized === "enforce") {
    return normalized as GovernorMode;
  }
  return null;
}

function resolveNumber(raw: unknown, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function resolveOptionalNumber(raw: unknown): number | undefined {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function sanitizePositiveNumber(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function sanitizePositiveInteger(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function thresholdsForElapsed(elapsedMs: number): { minScore: number; strikeBudget: number } {
  const minutes = elapsedMs / 60_000;

  if (minutes < 5) {
    return { minScore: -0.25, strikeBudget: 4 };
  }

  if (minutes < 15) {
    return { minScore: 0.35, strikeBudget: 3 };
  }

  if (minutes < 45) {
    return { minScore: 0.85, strikeBudget: 2 };
  }

  return { minScore: 1.1, strikeBudget: 2 };
}

function hasRepeatedTail(values: string[], length: number): boolean {
  if (values.length < length) {
    return false;
  }

  const tail = values.slice(values.length - length);
  const first = tail[0];
  if (!first) {
    return false;
  }

  return tail.every((value) => value === first);
}

function buildToolSignature(toolName: string, args: unknown): string {
  const normalized = stableJson(args);
  const hash = shortHash(`${toolName}:${normalized}`);
  return `${toolName}:${hash}`;
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isVerificationToolInvocation(toolName: string, args: unknown): boolean {
  if (toolName !== "bash") {
    return false;
  }

  if (!args || typeof args !== "object") {
    return false;
  }

  const command = String((args as { command?: string }).command ?? "").toLowerCase();
  if (!command) {
    return false;
  }

  return /\b(test|lint|typecheck|type-check|build|go test|cargo test|vitest|jest|pytest|pnpm test|npm test|bun test)\b/.test(command);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function reasonMessage(reason: GovernorReason, snapshot: GovernorSnapshot): string {
  switch (reason) {
    case "low_progress":
      return `governor low-progress cutoff: score ${snapshot.windowScore.toFixed(2)} < min ${snapshot.minScore.toFixed(2)} (strikes ${snapshot.strikes}/${snapshot.strikeBudget})`;
    case "loop_detected":
      return "governor loop detection triggered (repeated tool signatures with low novelty)";
    case "retry_churn":
      return "governor retry churn triggered (repeated failures without recovery)";
    case "budget_cost_exceeded":
      return "governor cost budget exceeded";
    case "budget_tokens_exceeded":
      return "governor token budget exceeded";
    case "emergency_fuse_exceeded":
      return "governor emergency fuse exceeded";
    default:
      return "governor policy triggered";
  }
}
