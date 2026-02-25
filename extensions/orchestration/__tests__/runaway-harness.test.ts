import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { OrchestrationAdmissionController } from "../admission";

function createHarness(overrides: {
  maxRuns?: number;
  maxSlots?: number;
  maxDepth?: number;
  cooldownMs?: number;
  gapMax?: number;
  gapQuietMs?: number;
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "orch-runaway-test-"));
  const nowRef = { value: 1_770_000_000_000 };

  const controller = new OrchestrationAdmissionController(
    {
      statePath: path.join(root, "state", "admission.json"),
      lockPath: path.join(root, "state", "admission.lock"),
      eventLogPath: path.join(root, "logs", "events.ndjson"),
      pressureLogPath: path.join(root, "logs", "pressure.ndjson"),
      maxDepth: overrides.maxDepth ?? 2,
      maxInFlightRuns: overrides.maxRuns ?? 4,
      maxInFlightSlots: overrides.maxSlots ?? 3,
      maxCallResultGap: overrides.gapMax ?? 4,
      gapResetQuietMs: overrides.gapQuietMs ?? 2_000,
      breakerCooldownMs: overrides.cooldownMs ?? 1_000,
      runLeaseTtlMs: 60_000,
      slotLeaseTtlMs: 60_000,
      lockWaitMs: 800,
      lockStaleMs: 300,
      pressureFreshnessMs: 60_000,
      pressureTailBytes: 8_192,
      pressureTailLines: 50,
      eventLogMaxBytes: 1_000_000,
      eventLogMaxBackups: 2,
      eventLogRotateCheckMs: 1_000,
    },
    {
      now: () => nowRef.value,
      randomId: () => Math.random().toString(36).slice(2, 10),
      sleep: async () => undefined,
      pressureProvider: async () => null,
    },
  );

  return {
    controller,
    nowRef,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("orchestration runaway harness", () => {
  test("slot admissions stay bounded under burst load", async () => {
    const h = createHarness({ maxRuns: 2, maxSlots: 3 });
    try {
      const runDecision = await h.controller.preflightRun({
        runId: "run-burst",
        kind: "team_run",
        depth: 0,
        requestedParallelism: 3,
      });
      expect(runDecision.ok).toBe(true);
      if (!runDecision.ok) {
        return;
      }

      const attempts = await Promise.all(
        Array.from({ length: 40 }).map((_, index) =>
          h.controller.acquireSlot({
            runId: runDecision.grant.runId,
            depth: 1,
            agent: `agent-${index}`,
          }),
        ),
      );

      const granted = attempts.filter((entry) => entry.ok);
      const denied = attempts.filter((entry) => !entry.ok);

      expect(granted.length).toBeLessThanOrEqual(3);
      expect(denied.length).toBeGreaterThan(0);

      for (const entry of granted) {
        if (entry.ok) {
          await h.controller.releaseSlot(entry.grant, "ok");
        }
      }
      await h.controller.endRun(runDecision.grant, "ok");
    } finally {
      h.cleanup();
    }
  });

  test("gap breaker self-recovers after quiet period", async () => {
    const h = createHarness({ gapMax: 1, gapQuietMs: 1_000, cooldownMs: 500 });
    try {
      await h.controller.recordToolCall("team_run");
      await h.controller.recordToolCall("team_run");

      const denied = await h.controller.preflightRun({
        runId: "gap-open",
        kind: "team_run",
        depth: 0,
        requestedParallelism: 1,
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok) {
        expect(denied.code).toBe("CIRCUIT_OPEN_CALL_RESULT_GAP");
      }

      // No additional call/result updates; advance beyond cooldown + quiet reset threshold.
      h.nowRef.value += 1_200;

      const recovered = await h.controller.preflightRun({
        runId: "gap-recovered",
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
});
