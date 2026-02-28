#!/usr/bin/env bun
import { mkdir, appendFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { OrchestrationAdmissionController } from "../../extensions/orchestration/admission";

type Severity = "ok" | "warn" | "critical";
type RunKind = "team_run" | "pipeline_run" | "subagent";

type CliOptions = {
  durationMs: number;
  outDir: string;
  snapshotIntervalMs: number;
  loopDelayMs: number;
  pressureCycleMs: number;
  pressureCriticalMs: number;
  pressureWarnMs: number;
};

type WorkloadEvent = {
  ts: number;
  kind: string;
  detail?: Record<string, unknown>;
};

const DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SNAPSHOT_INTERVAL_MS = 15_000;
const DEFAULT_LOOP_DELAY_MS = 800;
const DEFAULT_PRESSURE_CYCLE_MS = 20 * 60_000;
const DEFAULT_PRESSURE_CRITICAL_MS = 2 * 60_000;
const DEFAULT_PRESSURE_WARN_MS = 4 * 60_000;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  const outDir = path.resolve(options.outDir);
  const stateDir = path.join(outDir, "state");
  await mkdir(stateDir, { recursive: true });

  const files = {
    eventLog: path.join(outDir, "orchestration-admission.ndjson"),
    pressureLog: path.join(outDir, "ops-watchdog.ndjson"),
    statusLog: path.join(outDir, "status.ndjson"),
    workloadLog: path.join(outDir, "workload.ndjson"),
    summary: path.join(outDir, "summary.json"),
  };

  let syntheticSeverity: Severity = "ok";
  const pressureProvider = async () => {
    const elapsed = Date.now() - startedAt;
    syntheticSeverity = resolvePressureSeverity(elapsed, options);
    return {
      ts: Date.now(),
      severity: syntheticSeverity,
      nodeCount: syntheticSeverity === "critical" ? 350 : syntheticSeverity === "warn" ? 170 : 80,
      nodeRssMb: syntheticSeverity === "critical" ? 40_000 : syntheticSeverity === "warn" ? 19_000 : 8_000,
      totalProcesses: syntheticSeverity === "critical" ? 1_800 : syntheticSeverity === "warn" ? 900 : 500,
      reasons:
        syntheticSeverity === "critical"
          ? ["synthetic:critical"]
          : syntheticSeverity === "warn"
            ? ["synthetic:warn"]
            : [],
    } as const;
  };

  const controller = new OrchestrationAdmissionController(
    {
      statePath: path.join(stateDir, "admission-state.json"),
      lockPath: path.join(stateDir, "admission-state.lock"),
      eventLogPath: files.eventLog,
      pressureLogPath: files.pressureLog,
      maxInFlightRuns: envInt("PI_SOAK_MAX_RUNS", 6, 1, 128),
      maxInFlightSlots: envInt("PI_SOAK_MAX_SLOTS", 16, 1, 512),
      maxDepth: envInt("PI_SOAK_MAX_DEPTH", 2, 0, 16),
      breakerCooldownMs: envInt("PI_SOAK_BREAKER_COOLDOWN_MS", 30_000, 5_000, 3600_000),
      maxCallResultGap: envInt("PI_SOAK_MAX_CALL_RESULT_GAP", 24, 1, 10_000),
      gapResetQuietMs: envInt("PI_SOAK_GAP_RESET_QUIET_MS", 45_000, 5_000, 12 * 60 * 60_000),
      runLeaseTtlMs: envInt("PI_SOAK_RUN_TTL_MS", 20 * 60_000, 10_000, 12 * 60 * 60_000),
      slotLeaseTtlMs: envInt("PI_SOAK_SLOT_TTL_MS", 8 * 60_000, 10_000, 6 * 60 * 60_000),
      lockWaitMs: envInt("PI_SOAK_LOCK_WAIT_MS", 2_500, 200, 60_000),
      lockStaleMs: envInt("PI_SOAK_LOCK_STALE_MS", 10_000, 1_000, 120_000),
      pressureFreshnessMs: options.snapshotIntervalMs * 4,
      pressureTailBytes: 128 * 1024,
      pressureTailLines: 200,
      eventLogMaxBytes: 64 * 1024 * 1024,
      eventLogMaxBackups: 4,
      eventLogRotateCheckMs: 10_000,
    },
    {
      pressureProvider,
    },
  );

  const counters: Record<string, number> = Object.create(null);
  let iteration = 0;
  let nextSnapshotAt = 0;
  let nextPressureSampleAt = 0;

  await writeWorkload(files.workloadLog, {
    ts: Date.now(),
    kind: "soak_start",
    detail: {
      durationMs: options.durationMs,
      outDir,
      snapshotIntervalMs: options.snapshotIntervalMs,
      loopDelayMs: options.loopDelayMs,
    },
  });

  while (Date.now() - startedAt < options.durationMs) {
    iteration += 1;

    const now = Date.now();
    if (now >= nextPressureSampleAt) {
      nextPressureSampleAt = now + options.snapshotIntervalMs;
      await writeLine(
        files.pressureLog,
        JSON.stringify({
          kind: "sample",
          snapshot: await pressureProvider(),
        }),
      );
    }

    if (now >= nextSnapshotAt) {
      nextSnapshotAt = now + options.snapshotIntervalMs;
      const status = await controller.getStatus();
      await writeLine(
        files.statusLog,
        JSON.stringify({
          ts: Date.now(),
          kind: "status",
          activeRuns: status.activeRuns,
          activeSlots: status.activeSlots,
          maxGap: status.maxGap,
          circuit: status.circuit,
          pressure: status.pressure,
        }),
      );
    }

    const scenario = selectScenario(iteration);
    const scenarioTool = scenarioToolName(scenario);
    await controller.recordToolCall(scenarioTool);
    try {
      await runScenario(controller, scenario, files.workloadLog);
      counters[`scenario:${scenario}`] = (counters[`scenario:${scenario}`] ?? 0) + 1;
    } catch (error) {
      counters["scenario:error"] = (counters["scenario:error"] ?? 0) + 1;
      await writeWorkload(files.workloadLog, {
        ts: Date.now(),
        kind: "scenario_error",
        detail: {
          scenario,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      await controller.recordToolResult(scenarioTool);
    }

    await sleep(options.loopDelayMs);
  }

  const finalStatus = await controller.getStatus();
  await writeWorkload(files.workloadLog, {
    ts: Date.now(),
    kind: "soak_end",
    detail: {
      elapsedMs: Date.now() - startedAt,
      counters,
      finalStatus,
    },
  });

  await writeFile(
    files.summary,
    JSON.stringify(
      {
        startedAt,
        finishedAt: Date.now(),
        elapsedMs: Date.now() - startedAt,
        outDir,
        files,
        counters,
        finalStatus,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`soak complete: ${outDir}`);
  console.log(`summary: ${files.summary}`);
}

function parseArgs(argv: string[]): CliOptions {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:]/g, "-");
  let durationMs = DEFAULT_DURATION_MS;
  let outDir = path.join(process.cwd(), "logs", "soak", stamp);
  let snapshotIntervalMs = DEFAULT_SNAPSHOT_INTERVAL_MS;
  let loopDelayMs = DEFAULT_LOOP_DELAY_MS;
  let pressureCycleMs = DEFAULT_PRESSURE_CYCLE_MS;
  let pressureCriticalMs = DEFAULT_PRESSURE_CRITICAL_MS;
  let pressureWarnMs = DEFAULT_PRESSURE_WARN_MS;

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--duration" && next) {
      durationMs = parseDurationMs(next);
      index += 1;
      continue;
    }
    if (token === "--out" && next) {
      outDir = next;
      index += 1;
      continue;
    }
    if (token === "--snapshot-ms" && next) {
      snapshotIntervalMs = parsePositiveInt(next, DEFAULT_SNAPSHOT_INTERVAL_MS);
      index += 1;
      continue;
    }
    if (token === "--loop-delay-ms" && next) {
      loopDelayMs = parsePositiveInt(next, DEFAULT_LOOP_DELAY_MS);
      index += 1;
      continue;
    }
    if (token === "--pressure-cycle-ms" && next) {
      pressureCycleMs = parsePositiveInt(next, DEFAULT_PRESSURE_CYCLE_MS);
      index += 1;
      continue;
    }
    if (token === "--pressure-critical-ms" && next) {
      pressureCriticalMs = parsePositiveInt(next, DEFAULT_PRESSURE_CRITICAL_MS);
      index += 1;
      continue;
    }
    if (token === "--pressure-warn-ms" && next) {
      pressureWarnMs = parsePositiveInt(next, DEFAULT_PRESSURE_WARN_MS);
      index += 1;
      continue;
    }
  }

  return {
    durationMs,
    outDir,
    snapshotIntervalMs,
    loopDelayMs,
    pressureCycleMs,
    pressureCriticalMs,
    pressureWarnMs,
  };
}

function parseDurationMs(value: string): number {
  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/^(\d+)(ms|s|m|h)?$/);
  if (!match) {
    return DEFAULT_DURATION_MS;
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? "ms";
  if (!Number.isFinite(amount) || amount <= 0) {
    return DEFAULT_DURATION_MS;
  }

  if (unit === "h") return amount * 60 * 60 * 1000;
  if (unit === "m") return amount * 60 * 1000;
  if (unit === "s") return amount * 1000;
  return amount;
}

function parsePositiveInt(raw: string, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function resolvePressureSeverity(elapsedMs: number, options: CliOptions): Severity {
  const phase = elapsedMs % options.pressureCycleMs;
  if (phase < options.pressureCriticalMs) {
    return "critical";
  }
  if (phase < options.pressureCriticalMs + options.pressureWarnMs) {
    return "warn";
  }
  return "ok";
}

function selectScenario(iteration: number):
  | "normal_team"
  | "normal_pipeline"
  | "burst_slots"
  | "depth_probe"
  | "gap_probe" {
  if (iteration > 0 && iteration % 300 === 0) {
    return "gap_probe";
  }

  const lane = iteration % 10;
  if (lane === 0 || lane === 6) return "burst_slots";
  if (lane === 3) return "depth_probe";
  if (lane % 2 === 0) return "normal_pipeline";
  return "normal_team";
}


function scenarioToolName(
  scenario: "normal_team" | "normal_pipeline" | "burst_slots" | "depth_probe" | "gap_probe",
): "team_run" | "pipeline_run" {
  if (scenario === "normal_pipeline") {
    return "pipeline_run";
  }
  return "team_run";
}

async function runScenario(
  controller: OrchestrationAdmissionController,
  scenario: "normal_team" | "normal_pipeline" | "burst_slots" | "depth_probe" | "gap_probe",
  workloadPath: string,
): Promise<void> {
  switch (scenario) {
    case "normal_team":
      await executeRunScenario(controller, {
        kind: "team_run",
        depth: 0,
        requestedParallelism: 3,
        slotAttempts: 3,
      }, workloadPath);
      return;
    case "normal_pipeline":
      await executeRunScenario(controller, {
        kind: "pipeline_run",
        depth: 0,
        requestedParallelism: 1,
        slotAttempts: 1,
      }, workloadPath);
      return;
    case "burst_slots":
      await executeRunScenario(controller, {
        kind: "team_run",
        depth: 0,
        requestedParallelism: 8,
        slotAttempts: 24,
      }, workloadPath);
      return;
    case "depth_probe": {
      const denied = await controller.preflightRun({
        runId: `depth:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        kind: "team_run",
        depth: 5,
        requestedParallelism: 2,
      });
      await writeWorkload(workloadPath, {
        ts: Date.now(),
        kind: "depth_probe",
        detail: {
          ok: denied.ok,
          rejection: denied.ok ? undefined : denied.code,
        },
      });
      return;
    }
    case "gap_probe": {
      const burst = Math.min(64, controller.getPolicy().maxCallResultGap + 2);
      for (let index = 0; index < burst; index++) {
        await controller.recordToolCall("team_run");
      }
      const decision = await controller.preflightRun({
        runId: `gap:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        kind: "team_run",
        depth: 0,
        requestedParallelism: 1,
      });
      for (let index = 0; index < burst; index++) {
        await controller.recordToolResult("team_run");
      }
      await writeWorkload(workloadPath, {
        ts: Date.now(),
        kind: "gap_probe",
        detail: {
          ok: decision.ok,
          rejection: decision.ok ? undefined : decision.code,
          burst,
        },
      });
      return;
    }
  }
}

async function executeRunScenario(
  controller: OrchestrationAdmissionController,
  input: {
    kind: RunKind;
    depth: number;
    requestedParallelism: number;
    slotAttempts: number;
  },
  workloadPath: string,
): Promise<void> {
  const runId = `${input.kind}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const preflight = await controller.preflightRun({
    runId,
    kind: input.kind,
    depth: input.depth,
    requestedParallelism: input.requestedParallelism,
  });

  if (!preflight.ok) {
    await writeWorkload(workloadPath, {
      ts: Date.now(),
      kind: "run_denied",
      detail: {
        runId,
        runKind: input.kind,
        code: preflight.code,
      },
    });
    return;
  }

  const slotDecisions = await Promise.all(
    Array.from({ length: input.slotAttempts }).map((_, index) =>
      controller.acquireSlot({
        runId,
        depth: input.depth + 1,
        agent: `agent-${index}`,
      }),
    ),
  );

  let grantedSlots = 0;
  let deniedSlots = 0;
  let failedRelease = false;

  for (const decision of slotDecisions) {
    if (!decision.ok) {
      deniedSlots += 1;
      continue;
    }

    grantedSlots += 1;
    const status = Math.random() < 0.05 ? "failed" : "ok";
    if (status === "failed") {
      failedRelease = true;
    }
    await controller.releaseSlot(decision.grant, status);
  }

  await controller.endRun(preflight.grant, failedRelease ? "failed" : "ok");

  await writeWorkload(workloadPath, {
    ts: Date.now(),
    kind: "run_completed",
    detail: {
      runId,
      runKind: input.kind,
      grantedSlots,
      deniedSlots,
      failedRelease,
      requestedParallelism: input.requestedParallelism,
      slotAttempts: input.slotAttempts,
    },
  });

}

async function writeWorkload(filePath: string, event: WorkloadEvent): Promise<void> {
  await writeLine(filePath, JSON.stringify(event));
}

async function writeLine(filePath: string, line: string): Promise<void> {
  await appendFile(filePath, `${line}\n`, "utf8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
