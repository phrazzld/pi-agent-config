import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { OrchestrationAdmissionController } from "../admission";

function createHarness(overrides: {
  maxDepth?: number;
  maxRuns?: number;
  maxSlots?: number;
  gapMax?: number;
  cooldownMs?: number;
  pressure?: (nowMs: number) => Promise<{
    ts: number;
    severity: "ok" | "warn" | "critical";
    nodeCount: number;
    nodeRssMb: number;
  } | null>;
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "orch-adm-test-"));
  const nowRef = { value: 1_770_000_000_000 };

  const controller = new OrchestrationAdmissionController(
    {
      statePath: path.join(root, "state", "admission.json"),
      lockPath: path.join(root, "state", "admission.lock"),
      eventLogPath: path.join(root, "logs", "events.ndjson"),
      pressureLogPath: path.join(root, "logs", "pressure.ndjson"),
      maxDepth: overrides.maxDepth ?? 2,
      maxInFlightRuns: overrides.maxRuns ?? 6,
      maxInFlightSlots: overrides.maxSlots ?? 16,
      maxCallResultGap: overrides.gapMax ?? 24,
      breakerCooldownMs: overrides.cooldownMs ?? 2_000,
      lockWaitMs: 800,
      lockStaleMs: 400,
      runLeaseTtlMs: 60_000,
      slotLeaseTtlMs: 60_000,
      pressureFreshnessMs: 60_000,
      pressureTailBytes: 16_384,
      pressureTailLines: 100,
    },
    {
      now: () => nowRef.value,
      randomId: () => "fixed",
      sleep: async () => undefined,
      pressureProvider: overrides.pressure
        ? async () => overrides.pressure?.(nowRef.value) ?? null
        : async () => null,
    },
  );

  return {
    controller,
    nowRef,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("orchestration admission controller", () => {
  test("rejects run preflight when depth exceeds cap", async () => {
    const h = createHarness({ maxDepth: 1 });
    try {
      const decision = await h.controller.preflightRun({
        runId: "run-depth",
        kind: "team_run",
        depth: 2,
        requestedParallelism: 1,
      });
      expect(decision.ok).toBe(false);
      if (!decision.ok) {
        expect(decision.code).toBe("DEPTH_EXCEEDED");
      }
    } finally {
      h.cleanup();
    }
  });

  test("enforces run and slot caps", async () => {
    const h = createHarness({ maxRuns: 1, maxSlots: 1 });
    try {
      const runA = await h.controller.preflightRun({
        runId: "run-a",
        kind: "team_run",
        depth: 0,
        requestedParallelism: 1,
      });
      expect(runA.ok).toBe(true);

      const runB = await h.controller.preflightRun({
        runId: "run-b",
        kind: "pipeline_run",
        depth: 0,
        requestedParallelism: 1,
      });
      expect(runB.ok).toBe(false);
      if (!runB.ok) {
        expect(runB.code).toBe("RUN_CAP_REACHED");
      }

      if (runA.ok) {
        const slotA = await h.controller.acquireSlot({
          runId: runA.grant.runId,
          depth: 1,
          agent: "worker",
        });
        expect(slotA.ok).toBe(true);

        const slotB = await h.controller.acquireSlot({
          runId: runA.grant.runId,
          depth: 1,
          agent: "reviewer",
        });
        expect(slotB.ok).toBe(false);
        if (!slotB.ok) {
          expect(slotB.code).toBe("SLOT_CAP_REACHED");
        }

        if (slotA.ok) {
          await h.controller.releaseSlot(slotA.grant, "ok");
        }
        await h.controller.endRun(runA.grant, "ok");
      }
    } finally {
      h.cleanup();
    }
  });


  test("dedupes concurrent runs via idempotency key", async () => {
    const h = createHarness({ maxRuns: 1 });
    try {
      const runA = await h.controller.preflightRun({
        runId: "run-a",
        idempotencyKey: "team:core:same-goal",
        kind: "team_run",
        depth: 0,
        requestedParallelism: 1,
      });
      expect(runA.ok).toBe(true);
      if (!runA.ok) {
        return;
      }

      const runB = await h.controller.preflightRun({
        runId: "run-b",
        idempotencyKey: "team:core:same-goal",
        kind: "team_run",
        depth: 0,
        requestedParallelism: 1,
      });
      expect(runB.ok).toBe(true);
      if (!runB.ok) {
        return;
      }

      expect(runB.grant.runId).toBe(runA.grant.runId);
      expect(runB.grant.leaseId).toBe(runA.grant.leaseId);
      expect(runB.grant.idempotencyKey).toBe("team:core:same-goal");

      const status = await h.controller.getStatus();
      expect(status.activeRuns).toBe(1);

      await h.controller.endRun(runA.grant, "ok");

      const runC = await h.controller.preflightRun({
        runId: "run-c",
        idempotencyKey: "team:core:same-goal",
        kind: "team_run",
        depth: 0,
        requestedParallelism: 1,
      });
      expect(runC.ok).toBe(true);
      if (runC.ok) {
        expect(runC.grant.runId).toBe("run-c");
        await h.controller.endRun(runC.grant, "ok");
      }
    } finally {
      h.cleanup();
    }
  });

  test("opens breaker on critical pressure and recovers after cooldown", async () => {
    const pressureRef = {
      severity: "critical" as "ok" | "warn" | "critical",
      nodeCount: 400,
      nodeRssMb: 24_000,
    };
    const h = createHarness({
      cooldownMs: 1_000,
      pressure: async (nowMs) => ({
        ts: nowMs,
        severity: pressureRef.severity,
        nodeCount: pressureRef.nodeCount,
        nodeRssMb: pressureRef.nodeRssMb,
      }),
    });

    try {
      const first = await h.controller.preflightRun({
        runId: "pressure-a",
        kind: "team_run",
        depth: 0,
        requestedParallelism: 1,
      });
      expect(first.ok).toBe(false);
      if (!first.ok) {
        expect(first.code).toBe("CIRCUIT_OPEN_HOST_PRESSURE");
      }

      pressureRef.severity = "ok";
      pressureRef.nodeCount = 10;
      pressureRef.nodeRssMb = 600;

      const stillCooling = await h.controller.preflightRun({
        runId: "pressure-b",
        kind: "team_run",
        depth: 0,
        requestedParallelism: 1,
      });
      expect(stillCooling.ok).toBe(false);

      h.nowRef.value += 1_200;

      const recovered = await h.controller.preflightRun({
        runId: "pressure-c",
        kind: "team_run",
        depth: 0,
        requestedParallelism: 1,
      });
      expect(recovered.ok).toBe(true);
      if (recovered.ok) {
        await h.controller.endRun(recovered.grant, "ok");
      }
    } finally {
      h.cleanup();
    }
  });

  test("opens breaker when call-result gap exceeds threshold", async () => {
    const h = createHarness({ gapMax: 2, cooldownMs: 1_000 });
    try {
      await h.controller.recordToolCall("team_run");
      await h.controller.recordToolCall("team_run");
      await h.controller.recordToolCall("team_run");

      const denied = await h.controller.preflightRun({
        runId: "gap-run",
        kind: "team_run",
        depth: 0,
        requestedParallelism: 1,
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok) {
        expect(denied.code).toBe("CIRCUIT_OPEN_CALL_RESULT_GAP");
      }

      await h.controller.recordToolResult("team_run");
      h.nowRef.value += 1_200;

      const allowed = await h.controller.preflightRun({
        runId: "gap-recovered",
        kind: "team_run",
        depth: 0,
        requestedParallelism: 1,
      });
      expect(allowed.ok).toBe(true);
      if (allowed.ok) {
        await h.controller.endRun(allowed.grant, "ok");
      }
    } finally {
      h.cleanup();
    }
  });
});
