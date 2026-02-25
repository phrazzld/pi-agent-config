import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { appendLineWithRotation } from "../log-rotation";

describe("log rotation", () => {
  test("rotates ndjson log when size limit is exceeded", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "log-rotation-test-"));
    const logPath = path.join(root, "events.ndjson");

    try {
      for (let i = 0; i < 20; i += 1) {
        await appendLineWithRotation(logPath, JSON.stringify({ i, payload: "x".repeat(12000) }), {
          maxBytes: 70_000,
          maxBackups: 3,
          checkIntervalMs: 0,
        });
      }
      // one extra append guarantees a pre-write rotation check after threshold crossing
      await appendLineWithRotation(logPath, JSON.stringify({ i: 999, payload: "x".repeat(12000) }), {
        maxBytes: 70_000,
        maxBackups: 3,
        checkIntervalMs: 0,
      });

      expect(existsSync(logPath)).toBe(true);
      expect(existsSync(`${logPath}.1`)).toBe(true);
      expect(existsSync(`${logPath}.2`)).toBe(true);

      const current = statSync(logPath).size;
      expect(current).toBeLessThanOrEqual(90_000);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("keeps only configured backup count", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "log-rotation-cap-test-"));
    const logPath = path.join(root, "audit.ndjson");

    try {
      for (let i = 0; i < 40; i += 1) {
        await appendLineWithRotation(logPath, JSON.stringify({ i, payload: "abc".repeat(6000) }), {
          maxBytes: 68_000,
          maxBackups: 2,
          checkIntervalMs: 0,
        });
      }
      await appendLineWithRotation(logPath, JSON.stringify({ i: 1000, payload: "abc".repeat(6000) }), {
        maxBytes: 68_000,
        maxBackups: 2,
        checkIntervalMs: 0,
      });

      expect(existsSync(`${logPath}.1`)).toBe(true);
      expect(existsSync(`${logPath}.2`)).toBe(true);
      expect(existsSync(`${logPath}.3`)).toBe(false);

      const oldest = readFileSync(`${logPath}.2`, "utf8");
      expect(oldest.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
