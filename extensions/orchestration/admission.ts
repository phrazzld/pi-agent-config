import { existsSync } from "node:fs";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { appendLineWithRotation } from "../shared/log-rotation";

export type OrchestrationGateKind = "team_run" | "pipeline_run" | "subagent" | "agent_spawn";
export type CircuitReason = "host_pressure" | "call_result_gap" | "manual" | "other";

export interface AdmissionPolicy {
  statePath: string;
  lockPath: string;
  eventLogPath: string;
  pressureLogPath: string;
  maxInFlightRuns: number;
  maxInFlightSlots: number;
  maxDepth: number;
  runLeaseTtlMs: number;
  slotLeaseTtlMs: number;
  lockWaitMs: number;
  lockStaleMs: number;
  breakerCooldownMs: number;
  maxCallResultGap: number;
  gapResetQuietMs: number;
  eventLogMaxBytes: number;
  eventLogMaxBackups: number;
  eventLogRotateCheckMs: number;
  pressureFreshnessMs: number;
  pressureTailBytes: number;
  pressureTailLines: number;
}

export interface PressureSnapshot {
  ts: number;
  severity: "ok" | "warn" | "critical";
  nodeCount: number;
  nodeRssMb: number;
  totalProcesses?: number;
  reasons?: string[];
}

export interface AdmissionRunGrant {
  leaseId: string;
  runId: string;
  kind: "team_run" | "pipeline_run" | "subagent";
  depth: number;
  requestedParallelism: number;
  grantedAt: number;
}

export interface AdmissionSlotGrant {
  leaseId: string;
  runId: string;
  depth: number;
  grantedAt: number;
}

export interface AdmissionRejection {
  ok: false;
  code:
    | "DEPTH_EXCEEDED"
    | "CIRCUIT_OPEN"
    | "CIRCUIT_OPEN_HOST_PRESSURE"
    | "CIRCUIT_OPEN_CALL_RESULT_GAP"
    | "RUN_CAP_REACHED"
    | "SLOT_CAP_REACHED"
    | "STATE_ERROR";
  reason: string;
  retryAfterMs?: number;
  details?: Record<string, unknown>;
}

export interface AdmissionAllow<TGrant> {
  ok: true;
  grant: TGrant;
}

export type RunDecision = AdmissionAllow<AdmissionRunGrant> | AdmissionRejection;
export type SlotDecision = AdmissionAllow<AdmissionSlotGrant> | AdmissionRejection;

type CounterKey = "teamRun" | "pipelineRun" | "subagent";

interface CounterPair {
  calls: number;
  results: number;
}

interface AdmissionCounters {
  teamRun: CounterPair;
  pipelineRun: CounterPair;
  subagent: CounterPair;
}

interface RunLease {
  leaseId: string;
  runId: string;
  kind: "team_run" | "pipeline_run" | "subagent";
  depth: number;
  requestedParallelism: number;
  createdAt: number;
  expiresAt: number;
}

interface SlotLease {
  leaseId: string;
  runId: string;
  depth: number;
  createdAt: number;
  expiresAt: number;
}

interface CircuitState {
  status: "closed" | "open";
  reason: CircuitReason | null;
  details: string;
  openedAt: number;
  cooldownUntil: number;
  trips: number;
}

interface AdmissionState {
  version: 1;
  updatedAt: number;
  runs: Record<string, RunLease>;
  slots: Record<string, SlotLease>;
  counters: AdmissionCounters;
  countersLastUpdatedAt: number;
  circuit: CircuitState;
}

interface StatusSnapshot {
  now: number;
  activeRuns: number;
  activeSlots: number;
  maxGap: number;
  circuit: CircuitState;
  pressure: PressureSnapshot | null;
  policy: AdmissionPolicy;
}

interface ControllerDeps {
  now: () => number;
  randomId: () => string;
  sleep: (ms: number) => Promise<void>;
  pressureProvider: () => Promise<PressureSnapshot | null>;
}

const DEFAULT_STATE_PATH = path.join(homedir(), ".pi", "agent", "state", "orchestration-admission-state.json");
const DEFAULT_EVENT_LOG_PATH = path.join(homedir(), ".pi", "agent", "logs", "orchestration-admission.ndjson");
const DEFAULT_PRESSURE_LOG_PATH = path.join(homedir(), ".pi", "agent", "logs", "ops-watchdog.ndjson");

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

function defaultPolicy(): AdmissionPolicy {
  const statePath = process.env.PI_ORCH_ADM_STATE_PATH ?? DEFAULT_STATE_PATH;
  return {
    statePath,
    lockPath: process.env.PI_ORCH_ADM_LOCK_PATH ?? `${statePath}.lock`,
    eventLogPath: process.env.PI_ORCH_ADM_EVENT_LOG_PATH ?? DEFAULT_EVENT_LOG_PATH,
    pressureLogPath: process.env.PI_ORCH_ADM_PRESSURE_LOG_PATH ?? DEFAULT_PRESSURE_LOG_PATH,
    maxInFlightRuns: envInt("PI_ORCH_ADM_MAX_RUNS", 6, 1, 128),
    maxInFlightSlots: envInt("PI_ORCH_ADM_MAX_SLOTS", 16, 1, 512),
    maxDepth: envInt("PI_ORCH_ADM_MAX_DEPTH", 2, 0, 16),
    runLeaseTtlMs: envInt("PI_ORCH_ADM_RUN_TTL_MS", 30 * 60 * 1000, 10_000, 12 * 60 * 60 * 1000),
    slotLeaseTtlMs: envInt("PI_ORCH_ADM_SLOT_TTL_MS", 10 * 60 * 1000, 10_000, 6 * 60 * 60 * 1000),
    lockWaitMs: envInt("PI_ORCH_ADM_LOCK_WAIT_MS", 2_500, 200, 60_000),
    lockStaleMs: envInt("PI_ORCH_ADM_LOCK_STALE_MS", 10_000, 1_000, 120_000),
    breakerCooldownMs: envInt("PI_ORCH_ADM_BREAKER_COOLDOWN_MS", 120_000, 5_000, 12 * 60 * 60 * 1000),
    maxCallResultGap: envInt("PI_ORCH_ADM_GAP_MAX", 24, 1, 10_000),
    gapResetQuietMs: envInt("PI_ORCH_ADM_GAP_RESET_QUIET_MS", 180_000, 5_000, 12 * 60 * 60 * 1000),
    eventLogMaxBytes: envInt("PI_ORCH_ADM_EVENT_LOG_MAX_BYTES", 10 * 1024 * 1024, 128 * 1024, 512 * 1024 * 1024),
    eventLogMaxBackups: envInt("PI_ORCH_ADM_EVENT_LOG_MAX_BACKUPS", 5, 1, 20),
    eventLogRotateCheckMs: envInt("PI_ORCH_ADM_EVENT_LOG_ROTATE_CHECK_MS", 15_000, 1_000, 10 * 60 * 1000),
    pressureFreshnessMs: envInt("PI_ORCH_ADM_PRESSURE_FRESHNESS_MS", 30_000, 1_000, 10 * 60 * 1000),
    pressureTailBytes: envInt("PI_ORCH_ADM_PRESSURE_TAIL_BYTES", 128 * 1024, 1024, 5 * 1024 * 1024),
    pressureTailLines: envInt("PI_ORCH_ADM_PRESSURE_TAIL_LINES", 200, 1, 10_000),
  };
}

function initialState(now: number): AdmissionState {
  return {
    version: 1,
    updatedAt: now,
    runs: {},
    slots: {},
    counters: emptyCounters(),
    countersLastUpdatedAt: now,
    circuit: {
      status: "closed",
      reason: null,
      details: "",
      openedAt: 0,
      cooldownUntil: 0,
      trips: 0,
    },
  };
}

function parseState(raw: string, now: number): AdmissionState {
  try {
    const parsed = JSON.parse(raw) as Partial<AdmissionState>;
    if (parsed.version !== 1) {
      return initialState(now);
    }
    return {
      version: 1,
      updatedAt: Number(parsed.updatedAt ?? now),
      runs: parsed.runs ?? {},
      slots: parsed.slots ?? {},
      counters: normalizeCounters(parsed.counters),
      countersLastUpdatedAt: sanitizeTimestamp(parsed.countersLastUpdatedAt ?? parsed.updatedAt ?? now, now),
      circuit: {
        status: parsed.circuit?.status === "open" ? "open" : "closed",
        reason: parsed.circuit?.reason ?? null,
        details: parsed.circuit?.details ?? "",
        openedAt: Number(parsed.circuit?.openedAt ?? 0),
        cooldownUntil: Number(parsed.circuit?.cooldownUntil ?? 0),
        trips: Number(parsed.circuit?.trips ?? 0),
      },
    };
  } catch {
    return initialState(now);
  }
}

function asCounterKey(toolName: string): CounterKey | null {
  if (toolName === "team_run") {
    return "teamRun";
  }
  if (toolName === "pipeline_run") {
    return "pipelineRun";
  }
  if (toolName === "subagent") {
    return "subagent";
  }
  return null;
}

function maxCounterGap(counters: AdmissionCounters): number {
  return Math.max(
    counters.teamRun.calls - counters.teamRun.results,
    counters.pipelineRun.calls - counters.pipelineRun.results,
    counters.subagent.calls - counters.subagent.results,
  );
}

function emptyCounters(): AdmissionCounters {
  return {
    teamRun: { calls: 0, results: 0 },
    pipelineRun: { calls: 0, results: 0 },
    subagent: { calls: 0, results: 0 },
  };
}

function normalizeCounters(counters: Partial<AdmissionCounters> | undefined): AdmissionCounters {
  const normalizePair = (pair: Partial<CounterPair> | undefined): CounterPair => ({
    calls: Number.isFinite(pair?.calls) ? Math.max(0, Math.floor(pair?.calls ?? 0)) : 0,
    results: Number.isFinite(pair?.results) ? Math.max(0, Math.floor(pair?.results ?? 0)) : 0,
  });

  return {
    teamRun: normalizePair(counters?.teamRun),
    pipelineRun: normalizePair(counters?.pipelineRun),
    subagent: normalizePair(counters?.subagent),
  };
}

function sanitizeTimestamp(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function sanitizeParallelism(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

export function currentOrchestrationDepth(): number {
  const raw = Number(process.env.PI_ORCH_DEPTH ?? 0);
  if (!Number.isFinite(raw) || raw < 0) {
    return 0;
  }
  return Math.floor(raw);
}

export class OrchestrationAdmissionController {
  private readonly policy: AdmissionPolicy;
  private readonly deps: ControllerDeps;

  constructor(
    policyOverrides: Partial<AdmissionPolicy> = {},
    depOverrides: Partial<ControllerDeps> = {},
  ) {
    const policy = {
      ...defaultPolicy(),
      ...policyOverrides,
    };
    this.policy = policy;
    this.deps = {
      now: depOverrides.now ?? (() => Date.now()),
      randomId: depOverrides.randomId ?? (() => Math.random().toString(36).slice(2, 10)),
      sleep:
        depOverrides.sleep ??
        ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)))),
      pressureProvider:
        depOverrides.pressureProvider ??
        (() =>
          readRecentPressureFromLog(
            policy.pressureLogPath,
            policy.pressureTailBytes,
            policy.pressureTailLines,
            policy.pressureFreshnessMs,
            this.deps.now(),
          )),
    };
  }

  getPolicy(): AdmissionPolicy {
    return this.policy;
  }

  async getStatus(): Promise<StatusSnapshot> {
    const pressure = await this.safePressureSnapshot();
    const state = await this.withStateLock(async (current, now) => {
      this.pruneLeases(current, now);
      this.tryCloseCircuit(current, now);
      return current;
    });

    const snapshot: StatusSnapshot = {
      now: this.deps.now(),
      activeRuns: Object.keys(state.runs).length,
      activeSlots: Object.keys(state.slots).length,
      maxGap: maxCounterGap(state.counters),
      circuit: state.circuit,
      pressure,
      policy: this.policy,
    };
    return snapshot;
  }

  async preflightRun(input: {
    runId: string;
    kind: "team_run" | "pipeline_run" | "subagent";
    depth: number;
    requestedParallelism: number;
  }): Promise<RunDecision> {
    const now = this.deps.now();
    const pressure = await this.safePressureSnapshot();
    const requestedParallelism = sanitizeParallelism(input.requestedParallelism);

    try {
      const decision = await this.withStateLock(async (state, lockedNow) => {
        this.pruneLeases(state, lockedNow);
        this.tryCloseCircuit(state, lockedNow);

        const immediate = this.evaluateImmediateGuards(state, lockedNow, input.depth, pressure);
        if (immediate) {
          return immediate;
        }

        if (Object.keys(state.runs).length >= this.policy.maxInFlightRuns) {
          return this.reject(
            "RUN_CAP_REACHED",
            `active orchestration runs reached cap (${this.policy.maxInFlightRuns})`,
            {
              activeRuns: Object.keys(state.runs).length,
              maxInFlightRuns: this.policy.maxInFlightRuns,
            },
            300,
          );
        }

        if (requestedParallelism > this.policy.maxInFlightSlots) {
          return this.reject(
            "SLOT_CAP_REACHED",
            `requested parallelism (${requestedParallelism}) exceeds global slot cap (${this.policy.maxInFlightSlots})`,
            {
              requestedParallelism,
              maxInFlightSlots: this.policy.maxInFlightSlots,
            },
          );
        }

        const existing = state.runs[input.runId];
        if (existing) {
          existing.expiresAt = lockedNow + this.policy.runLeaseTtlMs;
          const grant: AdmissionRunGrant = {
            leaseId: existing.leaseId,
            runId: existing.runId,
            kind: existing.kind,
            depth: existing.depth,
            requestedParallelism: existing.requestedParallelism,
            grantedAt: lockedNow,
          };
          return { ok: true, grant } as const;
        }

        const leaseId = `run_${input.kind}_${lockedNow}_${this.deps.randomId()}`;
        state.runs[input.runId] = {
          leaseId,
          runId: input.runId,
          kind: input.kind,
          depth: input.depth,
          requestedParallelism,
          createdAt: lockedNow,
          expiresAt: lockedNow + this.policy.runLeaseTtlMs,
        };

        const grant: AdmissionRunGrant = {
          leaseId,
          runId: input.runId,
          kind: input.kind,
          depth: input.depth,
          requestedParallelism,
          grantedAt: lockedNow,
        };
        return { ok: true, grant } as const;
      });

      if (!decision.ok) {
        await this.logEvent({
          ts: now,
          kind: "run_denied",
          gateKind: input.kind,
          runId: input.runId,
          depth: input.depth,
          requestedParallelism,
          code: decision.code,
          reason: decision.reason,
          retryAfterMs: decision.retryAfterMs ?? 0,
        });
        return decision;
      }

      await this.logEvent({
        ts: now,
        kind: "run_allowed",
        gateKind: input.kind,
        runId: input.runId,
        depth: input.depth,
        requestedParallelism,
        leaseId: decision.grant.leaseId,
      });
      return decision;
    } catch (error) {
      const message = toErrorMessage(error);
      await this.logEvent({
        ts: now,
        kind: "state_error",
        gateKind: input.kind,
        runId: input.runId,
        code: "STATE_ERROR",
        reason: message,
      });
      return this.reject("STATE_ERROR", `admission state error: ${message}`);
    }
  }

  async endRun(grant: AdmissionRunGrant, status: "ok" | "failed"): Promise<void> {
    const now = this.deps.now();
    try {
      await this.withStateLock(async (state) => {
        const existing = state.runs[grant.runId];
        if (existing && existing.leaseId === grant.leaseId) {
          delete state.runs[grant.runId];
        }
      });
      await this.logEvent({
        ts: now,
        kind: "run_end",
        gateKind: grant.kind,
        runId: grant.runId,
        leaseId: grant.leaseId,
        status,
      });
    } catch {
      // no-op
    }
  }

  async acquireSlot(input: {
    runId: string;
    depth: number;
    agent: string;
  }): Promise<SlotDecision> {
    const now = this.deps.now();
    const pressure = await this.safePressureSnapshot();
    try {
      const decision = await this.withStateLock(async (state, lockedNow) => {
        this.pruneLeases(state, lockedNow);
        this.tryCloseCircuit(state, lockedNow);

        const immediate = this.evaluateImmediateGuards(state, lockedNow, input.depth, pressure);
        if (immediate) {
          return immediate;
        }

        const slotCount = Object.keys(state.slots).length;
        if (slotCount >= this.policy.maxInFlightSlots) {
          return this.reject(
            "SLOT_CAP_REACHED",
            `active orchestration slots reached cap (${this.policy.maxInFlightSlots})`,
            {
              activeSlots: slotCount,
              maxInFlightSlots: this.policy.maxInFlightSlots,
            },
            200,
          );
        }

        const run = state.runs[input.runId];
        if (run) {
          run.expiresAt = lockedNow + this.policy.runLeaseTtlMs;
        }

        const leaseId = `slot_${lockedNow}_${this.deps.randomId()}`;
        state.slots[leaseId] = {
          leaseId,
          runId: input.runId,
          depth: input.depth,
          createdAt: lockedNow,
          expiresAt: lockedNow + this.policy.slotLeaseTtlMs,
        };

        const grant: AdmissionSlotGrant = {
          leaseId,
          runId: input.runId,
          depth: input.depth,
          grantedAt: lockedNow,
        };
        return { ok: true, grant } as const;
      });

      if (!decision.ok) {
        await this.logEvent({
          ts: now,
          kind: "slot_denied",
          gateKind: "agent_spawn",
          runId: input.runId,
          depth: input.depth,
          code: decision.code,
          reason: decision.reason,
          agent: input.agent,
          retryAfterMs: decision.retryAfterMs ?? 0,
        });
        return decision;
      }

      await this.logEvent({
        ts: now,
        kind: "slot_allowed",
        gateKind: "agent_spawn",
        runId: input.runId,
        depth: input.depth,
        leaseId: decision.grant.leaseId,
        agent: input.agent,
      });

      return decision;
    } catch (error) {
      return this.reject("STATE_ERROR", `admission state error: ${toErrorMessage(error)}`);
    }
  }

  async releaseSlot(grant: AdmissionSlotGrant, status: "ok" | "failed"): Promise<void> {
    const now = this.deps.now();
    try {
      await this.withStateLock(async (state) => {
        const existing = state.slots[grant.leaseId];
        if (existing) {
          delete state.slots[grant.leaseId];
        }
      });
      await this.logEvent({
        ts: now,
        kind: "slot_release",
        gateKind: "agent_spawn",
        runId: grant.runId,
        leaseId: grant.leaseId,
        status,
      });
    } catch {
      // no-op
    }
  }

  async evaluateToolGate(kind: "subagent", depth: number): Promise<true | AdmissionRejection> {
    const now = this.deps.now();
    const pressure = await this.safePressureSnapshot();
    try {
      return await this.withStateLock(async (state, lockedNow) => {
        this.pruneLeases(state, lockedNow);
        this.tryCloseCircuit(state, lockedNow);
        const rejection = this.evaluateImmediateGuards(state, lockedNow, depth, pressure);
        if (!rejection) {
          return true;
        }
        void this.logEvent({
          ts: now,
          kind: "tool_gate_denied",
          gateKind: kind,
          depth,
          code: rejection.code,
          reason: rejection.reason,
          retryAfterMs: rejection.retryAfterMs ?? 0,
        });
        return rejection;
      });
    } catch (error) {
      return this.reject("STATE_ERROR", `admission state error: ${toErrorMessage(error)}`);
    }
  }

  async recordToolCall(toolName: string): Promise<void> {
    const key = asCounterKey(toolName);
    if (!key) {
      return;
    }
    const now = this.deps.now();
    try {
      await this.withStateLock(async (state, lockedNow) => {
        this.pruneLeases(state, lockedNow);
        state.counters[key].calls += 1;
        state.countersLastUpdatedAt = lockedNow;
        this.tryOpenCircuitForGap(state, lockedNow);
      });
      await this.logEvent({
        ts: now,
        kind: "counter_call",
        gateKind: toolName,
      });
    } catch {
      // no-op
    }
  }

  async recordToolResult(toolName: string): Promise<void> {
    const key = asCounterKey(toolName);
    if (!key) {
      return;
    }
    const now = this.deps.now();
    try {
      await this.withStateLock(async (state, lockedNow) => {
        this.pruneLeases(state, lockedNow);
        state.counters[key].results += 1;
        state.countersLastUpdatedAt = lockedNow;
        this.tryCloseCircuit(state, lockedNow);
      });
      await this.logEvent({
        ts: now,
        kind: "counter_result",
        gateKind: toolName,
      });
    } catch {
      // no-op
    }
  }

  private async withStateLock<T>(fn: (state: AdmissionState, now: number) => Promise<T> | T): Promise<T> {
    await this.ensureParentDirs();
    const lockHandle = await this.acquireLock();
    try {
      const now = this.deps.now();
      const state = await this.readState(now);
      const result = await fn(state, now);
      state.updatedAt = this.deps.now();
      await writeFile(this.policy.statePath, JSON.stringify(state), "utf8");
      return result;
    } finally {
      try {
        await lockHandle.close();
      } catch {
        // no-op
      }
      try {
        await rm(this.policy.lockPath, { force: true });
      } catch {
        // no-op
      }
    }
  }

  private async readState(now: number): Promise<AdmissionState> {
    if (!existsSync(this.policy.statePath)) {
      return initialState(now);
    }
    const raw = await readFile(this.policy.statePath, "utf8");
    return parseState(raw, now);
  }

  private async ensureParentDirs(): Promise<void> {
    await mkdir(path.dirname(this.policy.statePath), { recursive: true });
    await mkdir(path.dirname(this.policy.eventLogPath), { recursive: true });
  }

  private async acquireLock() {
    const deadline = this.deps.now() + this.policy.lockWaitMs;
    while (this.deps.now() < deadline) {
      try {
        return await open(this.policy.lockPath, "wx");
      } catch (error) {
        const message = toErrorMessage(error);
        if (!/EEXIST|already exists/i.test(message)) {
          throw error;
        }

        const stale = await this.isLockStale();
        if (stale) {
          try {
            await rm(this.policy.lockPath, { force: true });
          } catch {
            // ignore
          }
          continue;
        }

        await this.deps.sleep(25);
      }
    }
    throw new Error(`orchestration admission lock timeout after ${this.policy.lockWaitMs}ms`);
  }

  private async isLockStale(): Promise<boolean> {
    try {
      const info = await stat(this.policy.lockPath);
      const age = this.deps.now() - info.mtimeMs;
      return age >= this.policy.lockStaleMs;
    } catch {
      return false;
    }
  }

  private pruneLeases(state: AdmissionState, now: number): void {
    for (const [runId, lease] of Object.entries(state.runs)) {
      if (lease.expiresAt <= now) {
        delete state.runs[runId];
      }
    }
    for (const [leaseId, lease] of Object.entries(state.slots)) {
      if (lease.expiresAt <= now) {
        delete state.slots[leaseId];
      }
    }
  }

  private evaluateImmediateGuards(
    state: AdmissionState,
    now: number,
    depth: number,
    pressure: PressureSnapshot | null,
  ): AdmissionRejection | null {
    if (depth > this.policy.maxDepth) {
      return this.reject(
        "DEPTH_EXCEEDED",
        `orchestration depth ${depth} exceeds max depth ${this.policy.maxDepth}`,
        {
          depth,
          maxDepth: this.policy.maxDepth,
        },
      );
    }

    if (pressure?.severity === "critical") {
      this.openCircuit(state, now, "host_pressure", this.describePressure(pressure));
      const retryAfterMs = Math.max(0, state.circuit.cooldownUntil - now);
      return this.reject(
        "CIRCUIT_OPEN_HOST_PRESSURE",
        `orchestration circuit open due to host pressure (${this.describePressure(pressure)})`,
        {
          pressure,
          cooldownUntil: state.circuit.cooldownUntil,
        },
        retryAfterMs,
      );
    }

    this.maybeResetGapCounters(state, now);
    this.tryOpenCircuitForGap(state, now);

    if (state.circuit.status === "open") {
      const retryAfterMs = Math.max(0, state.circuit.cooldownUntil - now);
      if (state.circuit.reason === "call_result_gap") {
        return this.reject(
          "CIRCUIT_OPEN_CALL_RESULT_GAP",
          `orchestration circuit open due to tool call/result gap (${maxCounterGap(state.counters)} > ${this.policy.maxCallResultGap})`,
          {
            maxGap: maxCounterGap(state.counters),
            maxCallResultGap: this.policy.maxCallResultGap,
            cooldownUntil: state.circuit.cooldownUntil,
          },
          retryAfterMs,
        );
      }
      return this.reject(
        "CIRCUIT_OPEN",
        `orchestration circuit open: ${state.circuit.details || state.circuit.reason || "cooldown active"}`,
        {
          reason: state.circuit.reason,
          cooldownUntil: state.circuit.cooldownUntil,
        },
        retryAfterMs,
      );
    }

    return null;
  }

  private maybeResetGapCounters(state: AdmissionState, now: number): void {
    const gap = maxCounterGap(state.counters);
    if (gap <= this.policy.maxCallResultGap) {
      return;
    }

    const quietMs = Math.max(0, now - state.countersLastUpdatedAt);
    if (quietMs < this.policy.gapResetQuietMs) {
      return;
    }

    state.counters = emptyCounters();
    state.countersLastUpdatedAt = now;

    void this.logEvent({
      ts: now,
      kind: "counter_reset",
      reason: "quiet_period",
      previousGap: gap,
      quietMs,
      quietThresholdMs: this.policy.gapResetQuietMs,
    });
  }

  private tryOpenCircuitForGap(state: AdmissionState, now: number): void {
    const gap = maxCounterGap(state.counters);
    if (gap > this.policy.maxCallResultGap) {
      this.openCircuit(
        state,
        now,
        "call_result_gap",
        `gap=${gap} threshold=${this.policy.maxCallResultGap}`,
      );
    }
  }

  private tryCloseCircuit(state: AdmissionState, now: number): void {
    if (state.circuit.status !== "open") {
      return;
    }
    if (now < state.circuit.cooldownUntil) {
      return;
    }
    state.circuit.status = "closed";
    state.circuit.reason = null;
    state.circuit.details = "";
    state.circuit.openedAt = 0;
    state.circuit.cooldownUntil = 0;
  }

  private openCircuit(
    state: AdmissionState,
    now: number,
    reason: CircuitReason,
    details: string,
  ): void {
    const alreadyOpen = state.circuit.status === "open";
    state.circuit.status = "open";
    state.circuit.reason = reason;
    state.circuit.details = details;
    state.circuit.openedAt = now;
    state.circuit.cooldownUntil = now + this.policy.breakerCooldownMs;
    if (!alreadyOpen) {
      state.circuit.trips += 1;
      void this.logEvent({
        ts: now,
        kind: "circuit_open",
        reason,
        details,
        cooldownUntil: state.circuit.cooldownUntil,
      });
    }
  }

  private describePressure(pressure: PressureSnapshot): string {
    return `severity=${pressure.severity} node=${pressure.nodeCount} rss=${pressure.nodeRssMb}MB`;
  }

  private reject(
    code: AdmissionRejection["code"],
    reason: string,
    details?: Record<string, unknown>,
    retryAfterMs?: number,
  ): AdmissionRejection {
    return {
      ok: false,
      code,
      reason,
      details,
      retryAfterMs: retryAfterMs && retryAfterMs > 0 ? retryAfterMs : undefined,
    };
  }

  private async safePressureSnapshot(): Promise<PressureSnapshot | null> {
    try {
      return await this.deps.pressureProvider();
    } catch {
      return null;
    }
  }

  private async logEvent(event: Record<string, unknown>): Promise<void> {
    try {
      const line = `${JSON.stringify(event)}\n`;
      await appendLineWithRotation(this.policy.eventLogPath, line, {
        maxBytes: this.policy.eventLogMaxBytes,
        maxBackups: this.policy.eventLogMaxBackups,
        checkIntervalMs: this.policy.eventLogRotateCheckMs,
      });
    } catch {
      // no-op
    }
  }
}

async function readRecentPressureFromLog(
  filePath: string,
  maxBytes: number,
  maxLines: number,
  freshnessMs: number,
  now: number,
): Promise<PressureSnapshot | null> {
  if (!existsSync(filePath)) {
    return null;
  }

  const fd = await open(filePath, "r");
  try {
    const info = await fd.stat();
    const start = Math.max(0, info.size - maxBytes);
    const readBytes = Math.max(0, info.size - start);
    if (readBytes <= 0) {
      return null;
    }

    const buffer = Buffer.alloc(readBytes);
    await fd.read(buffer, 0, readBytes, start);
    const text = buffer.toString("utf8");
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-maxLines);

    for (let index = lines.length - 1; index >= 0; index--) {
      const raw = lines[index];
      try {
        const parsed = JSON.parse(raw) as {
          kind?: string;
          snapshot?: {
            ts?: number;
            severity?: string;
            nodeCount?: number;
            nodeRssMb?: number;
            totalProcesses?: number;
            reasons?: string[];
          };
        };
        if (parsed.kind !== "sample" || !parsed.snapshot) {
          continue;
        }
        const ts = Number(parsed.snapshot.ts ?? 0);
        if (!Number.isFinite(ts) || ts <= 0) {
          continue;
        }
        if (now - ts > freshnessMs) {
          continue;
        }

        const severityRaw = String(parsed.snapshot.severity ?? "ok").toLowerCase();
        const severity = severityRaw === "critical"
          ? "critical"
          : severityRaw === "warn"
            ? "warn"
            : "ok";

        return {
          ts,
          severity,
          nodeCount: Number(parsed.snapshot.nodeCount ?? 0),
          nodeRssMb: Number(parsed.snapshot.nodeRssMb ?? 0),
          totalProcesses: Number(parsed.snapshot.totalProcesses ?? 0),
          reasons: parsed.snapshot.reasons ?? [],
        };
      } catch {
        continue;
      }
    }

    return null;
  } finally {
    await fd.close();
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}
