import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { OrchestrationAdmissionController } from "../admission";

type DenialCode =
  | "DEPTH_EXCEEDED"
  | "CIRCUIT_OPEN"
  | "CIRCUIT_OPEN_HOST_PRESSURE"
  | "CIRCUIT_OPEN_CALL_RESULT_GAP"
  | "RUN_CAP_REACHED"
  | "SLOT_CAP_REACHED"
  | "STATE_ERROR";

interface StressStats {
  runAllowed: number;
  runDenied: number;
  slotAllowed: number;
  slotDenied: number;
  denials: Record<string, number>;
}

function createStressHarness() {
  const root = mkdtempSync(path.join(tmpdir(), "orch-ci-fanout-"));
  const eventLogPath = path.join(root, "logs", "events.ndjson");

  const controller = new OrchestrationAdmissionController({
    statePath: path.join(root, "state", "admission.json"),
    lockPath: path.join(root, "state", "admission.lock"),
    eventLogPath,
    pressureLogPath: path.join(root, "logs", "pressure.ndjson"),
    maxDepth: 2,
    maxInFlightRuns: 4,
    maxInFlightSlots: 8,
    maxCallResultGap: 2_000,
    breakerCooldownMs: 1_000,
    runLeaseTtlMs: 60_000,
    slotLeaseTtlMs: 60_000,
    lockWaitMs: 4_000,
    lockStaleMs: 1_000,
    pressureFreshnessMs: 1_000,
    pressureTailBytes: 8_192,
    pressureTailLines: 50,
    eventLogMaxBytes: 4_000_000,
    eventLogMaxBackups: 2,
    eventLogRotateCheckMs: 1_000,
  });

  return {
    controller,
    eventLogPath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function bump(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

async function runRecursiveFanout(
  controller: OrchestrationAdmissionController,
  stats: StressStats,
  input: {
    depth: number;
    width: number;
    lineage: string;
  },
): Promise<void> {
  const kind = input.depth % 2 === 0 ? "team_run" : "pipeline_run";
  const runId = `${input.lineage}:d${input.depth}:${Math.random().toString(36).slice(2, 8)}`;

  const runDecision = await controller.preflightRun({
    runId,
    kind,
    depth: input.depth,
    requestedParallelism: Math.max(1, input.width),
  });

  if (!runDecision.ok) {
    stats.runDenied += 1;
    bump(stats.denials, runDecision.code);
    return;
  }

  stats.runAllowed += 1;

  const slotAttempts = Math.max(1, input.width * 2);
  const slotDecisions = await Promise.all(
    Array.from({ length: slotAttempts }).map((_, index) =>
      controller.acquireSlot({
        runId,
        depth: input.depth + 1,
        agent: `${runId}:agent-${index}`,
      }),
    ),
  );

  const childJobs: Promise<void>[] = [];

  for (let index = 0; index < slotDecisions.length; index++) {
    const slotDecision = slotDecisions[index];
    if (!slotDecision.ok) {
      stats.slotDenied += 1;
      bump(stats.denials, slotDecision.code);
      continue;
    }

    stats.slotAllowed += 1;

    childJobs.push(
      (async () => {
        try {
          if (input.depth < 3) {
            await runRecursiveFanout(controller, stats, {
              depth: input.depth + 1,
              width: Math.max(1, input.width - 1),
              lineage: `${input.lineage}.${index}`,
            });
          }
        } finally {
          await controller.releaseSlot(slotDecision.grant, "ok");
        }
      })(),
    );
  }

  await Promise.all(childJobs);
  await controller.endRun(runDecision.grant, "ok");
}

describe("orchestration ci fanout stress", () => {
  test("recursive team/pipeline fanout stays bounded and recovers", async () => {
    const h = createStressHarness();
    const stats: StressStats = {
      runAllowed: 0,
      runDenied: 0,
      slotAllowed: 0,
      slotDenied: 0,
      denials: {},
    };

    try {
      await Promise.all(
        Array.from({ length: 10 }).map((_, index) =>
          runRecursiveFanout(h.controller, stats, {
            depth: 0,
            width: 4,
            lineage: `root-${index}`,
          }),
        ),
      );

      const finalStatus = await h.controller.getStatus();

      expect(stats.runAllowed).toBeGreaterThan(0);
      expect(stats.runDenied).toBeGreaterThan(0);
      expect(stats.slotAllowed).toBeGreaterThan(0);
      expect(stats.slotDenied).toBeGreaterThan(0);

      expect(stats.denials.DEPTH_EXCEEDED ?? 0).toBeGreaterThan(0);
      expect((stats.denials.RUN_CAP_REACHED ?? 0) + (stats.denials.SLOT_CAP_REACHED ?? 0)).toBeGreaterThan(0);

      expect(finalStatus.activeRuns).toBe(0);
      expect(finalStatus.activeSlots).toBe(0);
      expect(finalStatus.maxGap).toBeLessThan(100);

      const eventLines = readFileSync(h.eventLogPath, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line) as { kind?: string; code?: string };
          } catch {
            return { kind: "malformed" };
          }
        });

      const stateErrors = eventLines.filter((entry) => entry.kind === "state_error");
      expect(stateErrors.length).toBe(0);

      const runDeniedCodes = eventLines
        .filter((entry) => entry.kind === "run_denied")
        .map((entry) => entry.code)
        .filter(Boolean);
      expect(runDeniedCodes.length).toBeGreaterThan(0);
    } finally {
      h.cleanup();
    }
  });
});
