import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { appendLineWithRotation } from "../shared/log-rotation";

const HANDOFF_DIR = path.join(".pi", "state");
const SNAPSHOT_FILE = "session-handoff.json";
const EVENT_LOG_FILE = "session-handoff.ndjson";
const WRITE_DEBOUNCE_MS = 400;
const MAX_PENDING_TOOLS = 40;
const MAX_RECENT_TOOLS = 40;
const MAX_INPUT_CHARS = 400;
const EVENT_LOG_MAX_BYTES = clampNumber(
  Number(process.env.PI_HANDOFF_EVENT_LOG_MAX_BYTES ?? 5 * 1024 * 1024),
  128 * 1024,
  512 * 1024 * 1024,
);
const EVENT_LOG_MAX_BACKUPS = clampNumber(
  Number(process.env.PI_HANDOFF_EVENT_LOG_MAX_BACKUPS ?? 3),
  1,
  20,
);
const EVENT_LOG_ROTATE_CHECK_MS = clampNumber(
  Number(process.env.PI_HANDOFF_EVENT_LOG_ROTATE_CHECK_MS ?? 10_000),
  1_000,
  10 * 60 * 1000,
);
const ENABLE_NESTED_HANDOFF =
  process.env.PI_HANDOFF_ENABLE_NESTED?.toLowerCase() === "true";

type ToolStatus = "running" | "ok" | "error";

interface ToolRecord {
  id: string;
  tool: string;
  summary: string;
  status: ToolStatus;
  startedAt: string;
  finishedAt?: string;
}

interface HandoffSnapshot {
  version: number;
  cwd: string;
  updatedAt: string;
  sessionStartedAt: string;
  activeRun: boolean;
  gitBranch: string | null;
  lastUserInput: string;
  pendingTools: ToolRecord[];
  recentTools: ToolRecord[];
  notes: string[];
}

interface RuntimeState {
  cwd: string;
  snapshotPath: string;
  eventPath: string;
  snapshot: HandoffSnapshot;
  pendingById: Map<string, ToolRecord>;
  writeTimer?: ReturnType<typeof setTimeout>;
  writing: boolean;
  queued: boolean;
  enabled: boolean;
}

export default function handoffExtension(pi: ExtensionAPI): void {
  let state: RuntimeState | null = null;

  pi.registerCommand("handoff", {
    description: "Show or persist workspace handoff state. Usage: /handoff [write]",
    handler: async (args, ctx) => {
      const mode = args.trim().toLowerCase();
      if (!state || !state.enabled) {
        ctx.ui.notify("Handoff is unavailable for this workspace.", "warning");
        return;
      }

      if (mode === "write") {
        await persistSnapshot(state);
        ctx.ui.notify(`Handoff snapshot updated: ${state.snapshotPath}`, "success");
        return;
      }

      const summaryLines = summarizeSnapshot(state.snapshot, state.snapshotPath);
      ctx.ui.notify(summaryLines.join("\n"), "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    state = await initializeState(pi, ctx);
    if (!state?.enabled) {
      const depth = currentOrchestrationDepth();
      if (ctx.hasUI && depth > 0 && !ENABLE_NESTED_HANDOFF) {
        ctx.ui.setStatus("handoff", `disabled depth=${depth}`);
      }
      return;
    }

    ctx.ui.setStatus("handoff", `tracking ${state.snapshotPath}`);
    appendEvent(state, {
      kind: "session_start",
      ts: Date.now(),
      cwd: ctx.cwd,
    });

    scheduleWrite(state);
  });

  pi.on("input", async (event) => {
    if (!state?.enabled) {
      return { action: "continue" } as const;
    }

    if (event.source !== "extension") {
      state.snapshot.lastUserInput = truncate(event.text.trim(), MAX_INPUT_CHARS);
      appendNote(state.snapshot, `input: ${state.snapshot.lastUserInput}`);
      appendEvent(state, {
        kind: "input",
        ts: Date.now(),
        text: state.snapshot.lastUserInput,
      });
      scheduleWrite(state);
    }

    return { action: "continue" } as const;
  });

  pi.on("agent_start", async () => {
    if (!state?.enabled) {
      return;
    }

    state.snapshot.activeRun = true;
    appendEvent(state, {
      kind: "agent_start",
      ts: Date.now(),
    });
    scheduleWrite(state);
  });

  pi.on("agent_end", async () => {
    if (!state?.enabled) {
      return;
    }

    state.snapshot.activeRun = false;
    appendEvent(state, {
      kind: "agent_end",
      ts: Date.now(),
    });
    scheduleWrite(state);
  });

  pi.on("tool_call", async (event) => {
    if (!state?.enabled) {
      return undefined;
    }

    const toolCallId = String((event as { toolCallId?: string }).toolCallId ?? "").trim();
    const id = toolCallId || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const record: ToolRecord = {
      id,
      tool: event.toolName,
      summary: summarizeToolInput(event.toolName, toInputRecord(event.input)),
      status: "running",
      startedAt: new Date().toISOString(),
    };

    state.pendingById.set(id, record);

    appendEvent(state, {
      kind: "tool_call",
      ts: Date.now(),
      tool: event.toolName,
      id,
      summary: record.summary,
    });

    scheduleWrite(state);
    return undefined;
  });

  pi.on("tool_result", async (event) => {
    if (!state?.enabled) {
      return undefined;
    }

    const toolCallId = String((event as { toolCallId?: string }).toolCallId ?? "").trim();
    const record =
      (toolCallId ? state.pendingById.get(toolCallId) : undefined) ??
      ({
        id: toolCallId || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        tool: event.toolName,
        summary: summarizeToolInput(event.toolName, toInputRecord(event.input)),
        status: "running",
        startedAt: new Date().toISOString(),
      } as ToolRecord);

    record.status = event.isError ? "error" : "ok";
    record.finishedAt = new Date().toISOString();

    if (toolCallId) {
      state.pendingById.delete(toolCallId);
    }

    state.snapshot.recentTools.unshift(record);
    if (state.snapshot.recentTools.length > MAX_RECENT_TOOLS) {
      state.snapshot.recentTools = state.snapshot.recentTools.slice(0, MAX_RECENT_TOOLS);
    }

    appendEvent(state, {
      kind: "tool_result",
      ts: Date.now(),
      tool: event.toolName,
      id: record.id,
      status: record.status,
      isError: event.isError,
    });

    scheduleWrite(state);
    return undefined;
  });
}

async function initializeState(
  pi: ExtensionAPI,
  ctx: ExtensionContext
): Promise<RuntimeState | null> {
  const depth = currentOrchestrationDepth();
  if (depth > 0 && !ENABLE_NESTED_HANDOFF) {
    return null;
  }

  const baseDir = path.join(ctx.cwd, HANDOFF_DIR);
  const snapshotPath = path.join(baseDir, SNAPSHOT_FILE);
  const eventPath = path.join(baseDir, EVENT_LOG_FILE);

  try {
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }
  } catch (error) {
    if (ctx.hasUI) {
      ctx.ui.notify(`Handoff: cannot create ${baseDir} (${toErrorMessage(error)})`, "warning");
    }
    return null;
  }

  let snapshot = defaultSnapshot(ctx.cwd);

  try {
    if (existsSync(snapshotPath)) {
      const raw = await readFile(snapshotPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<HandoffSnapshot>;
      if (parsed && parsed.cwd === ctx.cwd) {
        snapshot = {
          ...snapshot,
          ...parsed,
          cwd: ctx.cwd,
          pendingTools: [],
          recentTools: Array.isArray(parsed.recentTools)
            ? parsed.recentTools.slice(0, MAX_RECENT_TOOLS)
            : [],
          notes: Array.isArray(parsed.notes) ? parsed.notes.slice(0, 20) : [],
        };
      }
    }
  } catch {
    // Ignore malformed snapshot file and start fresh.
  }

  const now = new Date().toISOString();
  if (snapshot.activeRun) {
    appendNote(
      snapshot,
      "Recovered from unclean shutdown: previous session was still marked active."
    );
  }
  snapshot.sessionStartedAt = now;
  snapshot.updatedAt = now;
  snapshot.activeRun = false;
  snapshot.gitBranch = await detectGitBranch(pi, ctx.cwd);

  return {
    cwd: ctx.cwd,
    snapshotPath,
    eventPath,
    snapshot,
    pendingById: new Map<string, ToolRecord>(),
    writing: false,
    queued: false,
    enabled: true,
  };
}

async function detectGitBranch(pi: ExtensionAPI, cwd: string): Promise<string | null> {
  try {
    const result = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      timeout: 10_000,
    });
    if (result.code !== 0) {
      return null;
    }
    const branch = result.stdout.trim();
    return branch || null;
  } catch {
    return null;
  }
}

function scheduleWrite(state: RuntimeState): void {
  if (state.writeTimer) {
    clearTimeout(state.writeTimer);
  }

  state.writeTimer = setTimeout(() => {
    void persistSnapshot(state);
  }, WRITE_DEBOUNCE_MS);
}

async function persistSnapshot(state: RuntimeState): Promise<void> {
  if (!state.enabled) {
    return;
  }

  if (state.writing) {
    state.queued = true;
    return;
  }

  state.writing = true;
  state.snapshot.updatedAt = new Date().toISOString();
  state.snapshot.pendingTools = Array.from(state.pendingById.values())
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .slice(-MAX_PENDING_TOOLS);

  try {
    await writeFile(state.snapshotPath, `${JSON.stringify(state.snapshot, null, 2)}\n`, "utf8");
  } catch {
    state.enabled = false;
  } finally {
    state.writing = false;
  }

  if (state.queued) {
    state.queued = false;
    await persistSnapshot(state);
  }
}

function appendEvent(state: RuntimeState, payload: Record<string, unknown>): void {
  const line = `${JSON.stringify(payload)}\n`;
  void appendLineWithRotation(state.eventPath, line, {
    maxBytes: EVENT_LOG_MAX_BYTES,
    maxBackups: EVENT_LOG_MAX_BACKUPS,
    checkIntervalMs: EVENT_LOG_ROTATE_CHECK_MS,
  }).catch(() => undefined);
}

function toInputRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object") {
    return input as Record<string, unknown>;
  }
  return {};
}

function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "bash") {
    return truncate(String(input.command ?? ""), 180);
  }
  if (typeof input.path === "string") {
    return truncate(String(input.path), 180);
  }
  if (toolName === "team_run") {
    return `team=${String(input.team ?? "")}`;
  }
  if (toolName === "pipeline_run") {
    return `pipeline=${String(input.pipeline ?? "")}`;
  }
  if (toolName === "subagent") {
    const hasTask = Boolean(input.agent ?? input.task ?? input.tasks ?? input.chain);
    return truncate(hasTask ? "subagent task" : "subagent", 180);
  }

  return truncate(JSON.stringify(input), 180);
}

function appendNote(snapshot: HandoffSnapshot, note: string): void {
  snapshot.notes.unshift(`${new Date().toISOString()} ${truncate(note, 220)}`);
  if (snapshot.notes.length > 20) {
    snapshot.notes = snapshot.notes.slice(0, 20);
  }
}

function summarizeSnapshot(snapshot: HandoffSnapshot, snapshotPath: string): string[] {
  const pendingPreview = snapshot.pendingTools
    .slice(0, 5)
    .map((tool) => `  - ${tool.tool} (${tool.status}) ${tool.summary}`);

  const recentPreview = snapshot.recentTools
    .slice(0, 5)
    .map((tool) => `  - ${tool.tool} (${tool.status}) ${tool.summary}`);

  return [
    "Workspace handoff snapshot",
    `- file: ${snapshotPath}`,
    `- updatedAt: ${snapshot.updatedAt}`,
    `- sessionStartedAt: ${snapshot.sessionStartedAt}`,
    `- branch: ${snapshot.gitBranch ?? "(not a git repo)"}`,
    `- activeRun: ${snapshot.activeRun}`,
    `- pendingTools: ${snapshot.pendingTools.length}`,
    `- lastUserInput: ${snapshot.lastUserInput || "(none)"}`,
    "",
    "Pending tools (latest):",
    ...(pendingPreview.length > 0 ? pendingPreview : ["  - (none)"]),
    "",
    "Recent tools (latest):",
    ...(recentPreview.length > 0 ? recentPreview : ["  - (none)"]),
  ];
}

function defaultSnapshot(cwd: string): HandoffSnapshot {
  const now = new Date().toISOString();
  return {
    version: 1,
    cwd,
    updatedAt: now,
    sessionStartedAt: now,
    activeRun: false,
    gitBranch: null,
    lastUserInput: "",
    pendingTools: [],
    recentTools: [],
    notes: [],
  };
}

function truncate(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function currentOrchestrationDepth(): number {
  const raw = Number(process.env.PI_ORCH_DEPTH ?? 0);
  if (!Number.isFinite(raw) || raw < 0) {
    return 0;
  }
  return Math.floor(raw);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
