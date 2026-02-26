export type DelegatedHealthClassification = "healthy" | "slow" | "stalled" | "wedged";

export interface DelegatedHealthPolicy {
  pollIntervalMs: number;
  warnNoProgressMs: number;
  abortNoProgressMs: number;
  abortQuickToolMs: number;
  abortActiveToolMs: number;
  warnCooldownMs: number;
  disableAbort: boolean;
}

export interface DelegatedHealthSnapshot {
  label: string;
  now: number;
  startedAt: number;
  lastEventAt: number;
  lastProgressAt: number;
  lastAction: string;
  activeToolName?: string;
  activeToolElapsedMs?: number;
  noEventMs: number;
  noProgressMs: number;
  fingerprintStableMs: number;
  sameFingerprintPolls: number;
  classification: DelegatedHealthClassification;
  abortThresholdMs: number;
  warningCount: number;
  stallEpisodes: number;
}

export interface DelegatedHealthEvaluation {
  snapshot: DelegatedHealthSnapshot;
  warning?: string;
  abortReason?: string;
}

export interface DelegatedHealthSummary {
  status: "ok" | "aborted";
  classification: DelegatedHealthClassification;
  noProgressSeconds: number;
  noEventSeconds: number;
  lastAction: string;
  activeToolName?: string;
  warningCount: number;
  stallEpisodes: number;
}

interface ActiveToolState {
  name: string;
  startedAt: number;
}

const QUICK_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls", "web_search"]);
const LONG_RUNNING_TOOLS = new Set(["bash", "subagent", "team_run", "pipeline_run"]);

const DEFAULT_POLICY: DelegatedHealthPolicy = {
  pollIntervalMs: 5_000,
  warnNoProgressMs: 120_000,
  abortNoProgressMs: 15 * 60_000,
  abortQuickToolMs: 5 * 60_000,
  abortActiveToolMs: 30 * 60_000,
  warnCooldownMs: 60_000,
  disableAbort: false,
};

const MIN_POLL_INTERVAL_MS = 1_000;
const MAX_POLL_INTERVAL_MS = 60_000;
const MIN_WARN_MS = 15_000;
const MAX_WARN_MS = 12 * 60 * 60 * 1_000;
const MIN_ABORT_MS = 30_000;
const MAX_ABORT_MS = 24 * 60 * 60 * 1_000;
const MIN_WARN_COOLDOWN_MS = 5_000;
const MAX_WARN_COOLDOWN_MS = 10 * 60 * 1_000;

export class DelegatedRunHealthMonitor {
  private readonly startedAt: number;
  private lastEventAt: number;
  private lastProgressAt: number;
  private lastAction = "spawned";
  private progressFingerprint = "";
  private lastFingerprintChangeAt: number;
  private sameFingerprintPolls = 0;
  private lastWarnAt = Number.NEGATIVE_INFINITY;
  private warningCount = 0;
  private stallEpisodes = 0;
  private activeTool?: ActiveToolState;
  private classification: DelegatedHealthClassification = "healthy";

  constructor(
    private readonly label: string,
    private readonly policy: DelegatedHealthPolicy,
    private readonly now: () => number = () => Date.now(),
  ) {
    const ts = this.now();
    this.startedAt = ts;
    this.lastEventAt = ts;
    this.lastProgressAt = ts;
    this.lastFingerprintChangeAt = ts;
  }

  noteEvent(action: string): void {
    const ts = this.now();
    this.lastEventAt = ts;
    if (action.trim()) {
      this.lastAction = truncateAction(action);
    }
  }

  noteProgress(action: string, fingerprint?: string): void {
    const ts = this.now();
    this.lastEventAt = ts;
    this.lastProgressAt = ts;
    if (action.trim()) {
      this.lastAction = truncateAction(action);
    }
    if (typeof fingerprint === "string") {
      this.setFingerprint(fingerprint);
    }
  }

  noteToolStart(toolName: string, action?: string): void {
    const ts = this.now();
    this.activeTool = {
      name: sanitizeToolName(toolName),
      startedAt: ts,
    };
    this.noteProgress(action ?? `tool_start:${this.activeTool.name}`);
  }

  noteToolEnd(toolName?: string, action?: string): void {
    const name = toolName ? sanitizeToolName(toolName) : this.activeTool?.name ?? "unknown";
    this.activeTool = undefined;
    this.noteProgress(action ?? `tool_end:${name}`);
  }

  setFingerprint(fingerprint: string): void {
    const normalized = normalizeFingerprint(fingerprint);
    if (normalized === this.progressFingerprint) {
      return;
    }
    this.progressFingerprint = normalized;
    this.lastFingerprintChangeAt = this.now();
    this.sameFingerprintPolls = 0;
  }

  evaluate(): DelegatedHealthEvaluation {
    const ts = this.now();
    const noProgressMs = Math.max(0, ts - this.lastProgressAt);

    if (noProgressMs >= this.policy.warnNoProgressMs) {
      this.sameFingerprintPolls += 1;
    } else {
      this.sameFingerprintPolls = 0;
    }

    const snapshot = this.snapshot(ts);

    if (
      (this.classification === "healthy" || this.classification === "slow") &&
      (snapshot.classification === "stalled" || snapshot.classification === "wedged")
    ) {
      this.stallEpisodes += 1;
    }
    this.classification = snapshot.classification;

    let warning: string | undefined;
    if (
      snapshot.noProgressMs >= this.policy.warnNoProgressMs &&
      ts - this.lastWarnAt >= this.policy.warnCooldownMs
    ) {
      this.lastWarnAt = ts;
      this.warningCount += 1;
      warning = this.warningMessage(snapshot);
    }

    if (!this.policy.disableAbort && snapshot.noProgressMs >= snapshot.abortThresholdMs) {
      if (snapshot.classification === "stalled" || snapshot.classification === "wedged") {
        return {
          snapshot,
          warning,
          abortReason: this.abortReason(snapshot),
        };
      }
    }

    return { snapshot, warning };
  }

  summary(status: "ok" | "aborted"): DelegatedHealthSummary {
    const snapshot = this.snapshot(this.now());
    return {
      status,
      classification: snapshot.classification,
      noProgressSeconds: Math.round(snapshot.noProgressMs / 1_000),
      noEventSeconds: Math.round(snapshot.noEventMs / 1_000),
      lastAction: snapshot.lastAction,
      activeToolName: snapshot.activeToolName,
      warningCount: snapshot.warningCount,
      stallEpisodes: snapshot.stallEpisodes,
    };
  }

  private snapshot(ts: number): DelegatedHealthSnapshot {
    const noEventMs = Math.max(0, ts - this.lastEventAt);
    const noProgressMs = Math.max(0, ts - this.lastProgressAt);
    const fingerprintStableMs = Math.max(0, ts - this.lastFingerprintChangeAt);
    const abortThresholdMs = resolveAbortThresholdMs(this.policy, this.activeTool?.name);

    const classification = classifyState({
      noProgressMs,
      warnNoProgressMs: this.policy.warnNoProgressMs,
      abortThresholdMs,
      sameFingerprintPolls: this.sameFingerprintPolls,
      fingerprintStableMs,
    });

    return {
      label: this.label,
      now: ts,
      startedAt: this.startedAt,
      lastEventAt: this.lastEventAt,
      lastProgressAt: this.lastProgressAt,
      lastAction: this.lastAction,
      activeToolName: this.activeTool?.name,
      activeToolElapsedMs: this.activeTool ? Math.max(0, ts - this.activeTool.startedAt) : undefined,
      noEventMs,
      noProgressMs,
      fingerprintStableMs,
      sameFingerprintPolls: this.sameFingerprintPolls,
      classification,
      abortThresholdMs,
      warningCount: this.warningCount,
      stallEpisodes: this.stallEpisodes,
    };
  }

  private warningMessage(snapshot: DelegatedHealthSnapshot): string {
    const tool = snapshot.activeToolName ? ` tool=${snapshot.activeToolName}` : "";
    return `[delegated-health] label=${snapshot.label} state=${snapshot.classification}${tool} noProgress=${Math.round(snapshot.noProgressMs / 1_000)}s noEvent=${Math.round(snapshot.noEventMs / 1_000)}s lastAction=${snapshot.lastAction}`;
  }

  private abortReason(snapshot: DelegatedHealthSnapshot): string {
    const tool = snapshot.activeToolName ? ` tool=${snapshot.activeToolName}` : "";
    return `[delegated-health] abort label=${snapshot.label} state=${snapshot.classification}${tool} noProgress=${Math.round(snapshot.noProgressMs / 1_000)}s threshold=${Math.round(snapshot.abortThresholdMs / 1_000)}s lastAction=${snapshot.lastAction}`;
  }
}

export function resolveDelegatedHealthPolicy(
  env: Record<string, string | undefined> = process.env,
  overrides: Partial<DelegatedHealthPolicy> = {},
): DelegatedHealthPolicy {
  const disableAbortFromEnv = String(env.PI_DELEGATED_HEALTH_DISABLE_ABORT ?? "")
    .trim()
    .toLowerCase() === "true";

  const warnNoProgressMs = envDuration(
    env.PI_DELEGATED_HEALTH_WARN_NO_PROGRESS_MS,
    DEFAULT_POLICY.warnNoProgressMs,
    MIN_WARN_MS,
    MAX_WARN_MS,
  );

  const abortNoProgressMs = Math.max(
    warnNoProgressMs,
    envDuration(
      env.PI_DELEGATED_HEALTH_ABORT_NO_PROGRESS_MS,
      DEFAULT_POLICY.abortNoProgressMs,
      MIN_ABORT_MS,
      MAX_ABORT_MS,
    ),
  );

  const abortQuickToolMs = Math.max(
    warnNoProgressMs,
    envDuration(
      env.PI_DELEGATED_HEALTH_ABORT_QUICK_TOOL_MS,
      DEFAULT_POLICY.abortQuickToolMs,
      MIN_ABORT_MS,
      MAX_ABORT_MS,
    ),
  );

  const abortActiveToolMs = Math.max(
    abortNoProgressMs,
    envDuration(
      env.PI_DELEGATED_HEALTH_ABORT_ACTIVE_TOOL_MS,
      DEFAULT_POLICY.abortActiveToolMs,
      MIN_ABORT_MS,
      MAX_ABORT_MS,
    ),
  );

  const policy: DelegatedHealthPolicy = {
    pollIntervalMs: envDuration(
      env.PI_DELEGATED_HEALTH_POLL_MS,
      DEFAULT_POLICY.pollIntervalMs,
      MIN_POLL_INTERVAL_MS,
      MAX_POLL_INTERVAL_MS,
    ),
    warnNoProgressMs,
    abortNoProgressMs,
    abortQuickToolMs,
    abortActiveToolMs,
    warnCooldownMs: envDuration(
      env.PI_DELEGATED_HEALTH_WARN_COOLDOWN_MS,
      DEFAULT_POLICY.warnCooldownMs,
      MIN_WARN_COOLDOWN_MS,
      MAX_WARN_COOLDOWN_MS,
    ),
    disableAbort: disableAbortFromEnv,
  };

  return {
    ...policy,
    ...overrides,
  };
}

function resolveAbortThresholdMs(policy: DelegatedHealthPolicy, activeToolName?: string): number {
  if (!activeToolName) {
    return policy.abortNoProgressMs;
  }

  if (QUICK_TOOLS.has(activeToolName)) {
    return policy.abortQuickToolMs;
  }

  if (LONG_RUNNING_TOOLS.has(activeToolName)) {
    return policy.abortActiveToolMs;
  }

  return Math.max(policy.abortNoProgressMs, policy.abortActiveToolMs);
}

function classifyState(input: {
  noProgressMs: number;
  warnNoProgressMs: number;
  abortThresholdMs: number;
  sameFingerprintPolls: number;
  fingerprintStableMs: number;
}): DelegatedHealthClassification {
  if (input.noProgressMs < input.warnNoProgressMs) {
    return "healthy";
  }

  if (input.noProgressMs < input.abortThresholdMs) {
    return "slow";
  }

  if (input.sameFingerprintPolls >= 3 || input.fingerprintStableMs >= input.abortThresholdMs) {
    return "wedged";
  }

  return "stalled";
}

function envDuration(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function sanitizeToolName(value: string): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || "unknown";
}

function truncateAction(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 180) {
    return trimmed;
  }
  return `${trimmed.slice(0, 179).trimEnd()}…`;
}

function normalizeFingerprint(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (trimmed.length <= 512) {
    return trimmed;
  }
  return trimmed.slice(0, 512);
}
