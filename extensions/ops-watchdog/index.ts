import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { appendLineWithRotation } from "../shared/log-rotation";

const LOG_FILE_NAME = "ops-watchdog.ndjson";
const STATUS_KEY = "ops-watchdog";

const SAMPLE_INTERVAL_MS = clampNumber(
  Number(process.env.PI_OPS_WATCHDOG_INTERVAL_MS ?? 15_000),
  5_000,
  120_000
);
const LOG_INTERVAL_MS = clampNumber(
  Number(process.env.PI_OPS_WATCHDOG_LOG_INTERVAL_MS ?? 60_000),
  5_000,
  600_000
);
const WARN_NODE_COUNT = clampNumber(
  Number(process.env.PI_OPS_WATCHDOG_WARN_NODE_COUNT ?? 120),
  20,
  2_000
);
const CRITICAL_NODE_COUNT = clampNumber(
  Number(process.env.PI_OPS_WATCHDOG_CRITICAL_NODE_COUNT ?? 260),
  WARN_NODE_COUNT,
  5_000
);
const WARN_NODE_RSS_MB = clampNumber(
  Number(process.env.PI_OPS_WATCHDOG_WARN_NODE_RSS_MB ?? 16_384),
  512,
  200_000
);
const CRITICAL_NODE_RSS_MB = clampNumber(
  Number(process.env.PI_OPS_WATCHDOG_CRITICAL_NODE_RSS_MB ?? 32_768),
  WARN_NODE_RSS_MB,
  400_000
);
const ENFORCE_GUARDRAILS =
  process.env.PI_OPS_WATCHDOG_ENFORCE?.toLowerCase() === "true";
const WARNING_COOLDOWN_MS = 45_000;
const LOG_MAX_BYTES = clampNumber(
  Number(process.env.PI_OPS_WATCHDOG_LOG_MAX_BYTES ?? 10 * 1024 * 1024),
  256 * 1024,
  512 * 1024 * 1024
);
const LOG_MAX_BACKUPS = clampNumber(
  Number(process.env.PI_OPS_WATCHDOG_LOG_MAX_BACKUPS ?? 5),
  1,
  20
);
const LOG_ROTATE_CHECK_MS = clampNumber(
  Number(process.env.PI_OPS_WATCHDOG_LOG_ROTATE_CHECK_MS ?? 15_000),
  1_000,
  10 * 60 * 1000
);
const ENABLE_NESTED_WATCHDOG =
  process.env.PI_OPS_WATCHDOG_ENABLE_NESTED?.toLowerCase() === "true";

type Severity = "ok" | "warn" | "critical";

interface NodeProcessSample {
  pid: number;
  rssMb: number;
}

interface SystemSnapshot {
  ts: number;
  severity: Severity;
  reasons: string[];
  nodeCount: number;
  nodeRssMb: number;
  totalProcesses: number;
  topNodes: NodeProcessSample[];
}

interface CommandRisk {
  label: string;
  needsWorkerCap: boolean;
}

interface WatchdogState {
  interval?: ReturnType<typeof setInterval>;
  sampling: boolean;
  lastSnapshot: SystemSnapshot | null;
  lastSeverity: Severity;
  lastLogAtMs: number;
  lastWarningAtMs: number;
  enabled: boolean;
}

export default function opsWatchdogExtension(pi: ExtensionAPI): void {
  const state: WatchdogState = {
    sampling: false,
    lastSnapshot: null,
    lastSeverity: "ok",
    lastLogAtMs: 0,
    lastWarningAtMs: 0,
    enabled: true,
  };

  pi.registerCommand("ops-status", {
    description: "Show latest system watchdog snapshot",
    handler: async (_args, ctx) => {
      if (!state.enabled) {
        ctx.ui.notify("ops-watchdog: disabled for nested orchestration session.", "info");
        return;
      }

      const snapshot = state.lastSnapshot;
      if (!snapshot) {
        ctx.ui.notify("ops-watchdog: no snapshot captured yet.", "info");
        return;
      }

      const lines = [
        `ops-watchdog snapshot @ ${new Date(snapshot.ts).toISOString()}`,
        `- severity: ${snapshot.severity}`,
        `- nodeCount: ${snapshot.nodeCount}`,
        `- nodeRssMb: ${snapshot.nodeRssMb}`,
        `- totalProcesses: ${snapshot.totalProcesses}`,
        `- reasons: ${snapshot.reasons.length > 0 ? snapshot.reasons.join(", ") : "(none)"}`,
        `- topNodes: ${snapshot.topNodes.map((entry) => `${entry.pid}:${entry.rssMb}MB`).join(", ") || "(none)"}`,
        `- log: ${getLogPath()}`,
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("ops-policy", {
    description: "Show ops-watchdog thresholds and guardrail mode",
    handler: async (_args, ctx) => {
      const lines = [
        "ops-watchdog policy",
        `- sampleIntervalMs: ${SAMPLE_INTERVAL_MS}`,
        `- logIntervalMs: ${LOG_INTERVAL_MS}`,
        `- warn node count: ${WARN_NODE_COUNT}`,
        `- critical node count: ${CRITICAL_NODE_COUNT}`,
        `- warn node rss (MB): ${WARN_NODE_RSS_MB}`,
        `- critical node rss (MB): ${CRITICAL_NODE_RSS_MB}`,
        `- guardrailEnforce: ${ENFORCE_GUARDRAILS}`,
        `- nested sessions enabled: ${ENABLE_NESTED_WATCHDOG}`,
        `- log max bytes: ${LOG_MAX_BYTES}`,
        `- log backups: ${LOG_MAX_BACKUPS}`,
        "- critical pressure always enforces timeout + worker-cap guards",
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("ops-tail", {
    description: "Tail local watchdog log. Usage: /ops-tail [limit]",
    handler: async (args, ctx) => {
      const requested = Number(args.trim() || "20");
      const limit = clampNumber(Number.isFinite(requested) ? requested : 20, 5, 200);
      const logPath = getLogPath();
      if (!existsSync(logPath)) {
        ctx.ui.notify(`ops-watchdog: no log yet (${logPath}).`, "info");
        return;
      }

      const raw = await readFile(logPath, "utf8").catch(() => "");
      if (!raw.trim()) {
        ctx.ui.notify(`ops-watchdog: empty log (${logPath}).`, "info");
        return;
      }

      const lines = raw
        .trim()
        .split("\n")
        .slice(-limit)
        .map((line) => truncate(line, 220));

      ctx.ui.notify([`ops-watchdog tail (${lines.length})`, ...lines].join("\n"), "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const depth = currentOrchestrationDepth();
    state.enabled = depth === 0 || ENABLE_NESTED_WATCHDOG;
    if (!state.enabled) {
      if (ctx.hasUI) {
        ctx.ui.setStatus(STATUS_KEY, `disabled depth=${depth}`);
      }
      return;
    }

    await sampleAndReport(pi, ctx, state, true);

    if (!state.interval) {
      state.interval = setInterval(() => {
        void sampleAndReport(pi, ctx, state, false);
      }, SAMPLE_INTERVAL_MS);
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!state.enabled || event.toolName !== "bash") {
      return undefined;
    }

    const input = toInputRecord(event.input);
    const command = String(input.command ?? "").trim();
    if (!command) {
      return undefined;
    }

    const risk = classifyRisk(command);
    if (!risk) {
      return undefined;
    }

    const timeoutValue = Number(input.timeout ?? 0);
    const hasTimeout = Number.isFinite(timeoutValue) && timeoutValue > 0;
    const hasWorkerCap = hasBoundedWorkerFlag(command);

    const currentSeverity = state.lastSnapshot?.severity ?? "ok";
    const enforce = ENFORCE_GUARDRAILS || currentSeverity === "critical";

    if (enforce) {
      if (!hasTimeout) {
        return {
          block: true,
          reason:
            `Blocked by ops-watchdog: ${risk.label} command needs an explicit timeout in bash tool arguments to avoid runaway execution. ` +
            "Retry with `timeout` set on the bash tool call.",
        };
      }

      if (risk.needsWorkerCap && !hasWorkerCap) {
        return {
          block: true,
          reason:
            `Blocked by ops-watchdog: ${risk.label} command needs worker bounds under enforced mode ` +
            "(use `--maxWorkers`, `--runInBand`, or equivalent).",
        };
      }
    } else if (currentSeverity !== "ok" && Date.now() - state.lastWarningAtMs > WARNING_COOLDOWN_MS) {
      state.lastWarningAtMs = Date.now();
      if (ctx.hasUI) {
        ctx.ui.notify(
          `ops-watchdog: pressure=${currentSeverity}. Consider adding timeout + worker bounds before running ${risk.label} commands.`,
          "warning"
        );
      }
    }

    return undefined;
  });
}

async function sampleAndReport(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  state: WatchdogState,
  forceLog: boolean
): Promise<void> {
  if (state.sampling) {
    return;
  }

  state.sampling = true;
  try {
    const snapshot = await collectSnapshot(pi, ctx.cwd);
    if (!snapshot) {
      return;
    }

    state.lastSnapshot = snapshot;
    if (ctx.hasUI) {
      const suffix = snapshot.reasons.length > 0 ? ` (${snapshot.reasons.join("; ")})` : "";
      ctx.ui.setStatus(
        STATUS_KEY,
        `node=${snapshot.nodeCount} rss=${snapshot.nodeRssMb}MB severity=${snapshot.severity}${suffix}`
      );
    }

    if (isSeverityWorse(snapshot.severity, state.lastSeverity) && snapshot.severity !== "ok" && ctx.hasUI) {
      ctx.ui.notify(
        `ops-watchdog: ${snapshot.severity.toUpperCase()} node=${snapshot.nodeCount}, rss=${snapshot.nodeRssMb}MB`,
        snapshot.severity === "critical" ? "warning" : "info"
      );
    }
    state.lastSeverity = snapshot.severity;

    const shouldLog =
      forceLog ||
      snapshot.severity !== "ok" ||
      Date.now() - state.lastLogAtMs >= LOG_INTERVAL_MS;

    if (shouldLog) {
      state.lastLogAtMs = Date.now();
      await appendLog({ kind: "sample", snapshot });
    }
  } finally {
    state.sampling = false;
  }
}

async function collectSnapshot(pi: ExtensionAPI, cwd: string): Promise<SystemSnapshot | null> {
  let psOutput = "";
  try {
    const ps = await pi.exec("ps", ["-axo", "pid=,ppid=,rss=,comm="], {
      cwd,
      timeout: 8_000,
    });
    if (ps.code !== 0) {
      return null;
    }
    psOutput = ps.stdout;
  } catch {
    return null;
  }

  const nodeSamples: NodeProcessSample[] = [];
  let nodeCount = 0;
  let nodeRssKb = 0;
  let totalProcesses = 0;

  for (const line of psOutput.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) {
      continue;
    }

    totalProcesses += 1;

    const pid = Number(match[1]);
    const rssKb = Number(match[3]);
    const comm = path.basename(match[4].trim());
    if (!Number.isFinite(pid) || !Number.isFinite(rssKb)) {
      continue;
    }

    if (comm === "node") {
      nodeCount += 1;
      nodeRssKb += rssKb;
      nodeSamples.push({
        pid,
        rssMb: Math.round(rssKb / 1024),
      });
    }
  }

  nodeSamples.sort((a, b) => b.rssMb - a.rssMb);
  const nodeRssMb = Math.round(nodeRssKb / 1024);

  const reasons: string[] = [];
  let severity: Severity = "ok";

  if (nodeCount >= CRITICAL_NODE_COUNT) {
    severity = "critical";
    reasons.push(`nodeCount>=${CRITICAL_NODE_COUNT}`);
  } else if (nodeCount >= WARN_NODE_COUNT) {
    severity = "warn";
    reasons.push(`nodeCount>=${WARN_NODE_COUNT}`);
  }

  if (nodeRssMb >= CRITICAL_NODE_RSS_MB) {
    severity = "critical";
    reasons.push(`nodeRssMb>=${CRITICAL_NODE_RSS_MB}`);
  } else if (nodeRssMb >= WARN_NODE_RSS_MB && severity !== "critical") {
    severity = "warn";
    reasons.push(`nodeRssMb>=${WARN_NODE_RSS_MB}`);
  }

  return {
    ts: Date.now(),
    severity,
    reasons,
    nodeCount,
    nodeRssMb,
    totalProcesses,
    topNodes: nodeSamples.slice(0, 6),
  };
}

function classifyRisk(command: string): CommandRisk | null {
  const text = command.trim();

  if (/\b(vitest|jest)\b/i.test(text)) {
    return {
      label: "JS test runner",
      needsWorkerCap: true,
    };
  }

  if (
    /\b(pnpm|npm|bun)\s+test\b/i.test(text) ||
    /\bpytest\b/i.test(text) ||
    /\bswift\s+test\b/i.test(text) ||
    /\bgo\s+test\b/i.test(text) ||
    /\bcargo\s+test\b/i.test(text) ||
    /\btsx\s+--test\b/i.test(text)
  ) {
    return {
      label: "test",
      needsWorkerCap: false,
    };
  }

  if (
    /\bnext\s+build\b/i.test(text) ||
    /\b(pnpm|npm|bun)\s+(run\s+)?build\b/i.test(text)
  ) {
    return {
      label: "build",
      needsWorkerCap: false,
    };
  }

  return null;
}

function hasBoundedWorkerFlag(command: string): boolean {
  return /(--maxWorkers\b|--runInBand\b|--workers?\b|--pool\b|--threads?\b|--concurrency\b)/i.test(
    command
  );
}

function isSeverityWorse(next: Severity, previous: Severity): boolean {
  return severityRank(next) > severityRank(previous);
}

function severityRank(value: Severity): number {
  switch (value) {
    case "critical":
      return 3;
    case "warn":
      return 2;
    default:
      return 1;
  }
}

async function appendLog(entry: unknown): Promise<void> {
  const logPath = getLogPath();
  await appendLineWithRotation(logPath, `${JSON.stringify(entry)}\n`, {
    maxBytes: LOG_MAX_BYTES,
    maxBackups: LOG_MAX_BACKUPS,
    checkIntervalMs: LOG_ROTATE_CHECK_MS,
  }).catch(() => undefined);
}

function getLogPath(): string {
  const configDir =
    process.env.PI_CONFIG_DIR ??
    process.env.PI_CODING_AGENT_DIR ??
    path.join(homedir(), ".pi", "agent");
  return path.join(configDir, "logs", LOG_FILE_NAME);
}

function currentOrchestrationDepth(): number {
  const raw = Number(process.env.PI_ORCH_DEPTH ?? 0);
  if (!Number.isFinite(raw) || raw < 0) {
    return 0;
  }
  return Math.floor(raw);
}

function toInputRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object") {
    return input as Record<string, unknown>;
  }
  return {};
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}
