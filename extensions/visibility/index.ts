import { existsSync, mkdirSync } from "node:fs";
import { appendFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

interface UsageStats {
  tools: Map<string, number>;
  slashCommands: Map<string, number>;
  skillsRead: Set<string>;
  models: Set<string>;
  totalTurns: number;
  runStartTs: number;
  runTools: Map<string, number>;
  runSkillsRead: Set<string>;
  runSlashCommands: Set<string>;
  inRun: boolean;
}

interface RuntimeInventory {
  extensionCommands: string[];
  promptCommands: string[];
  skillCommands: string[];
  tools: string[];
}

const LOG_FILE_NAME = "primitive-usage.ndjson";
const WIDGET_ID = "visibility";
const STATUS_ID = "visibility";
const MESSAGE_TYPE = "visibility-summary";

export default function visibilityExtension(pi: ExtensionAPI): void {
  const state: UsageStats = {
    tools: new Map(),
    slashCommands: new Map(),
    skillsRead: new Set(),
    models: new Set(),
    totalTurns: 0,
    runStartTs: 0,
    runTools: new Map(),
    runSkillsRead: new Set(),
    runSlashCommands: new Set(),
    inRun: false,
  };

  let inventory: RuntimeInventory = {
    extensionCommands: [],
    promptCommands: [],
    skillCommands: [],
    tools: [],
  };

  let lastModel = "unknown";

  pi.registerMessageRenderer(MESSAGE_TYPE, (message, _options, theme) => {
    const text = typeof message.content === "string" ? message.content : String(message.content ?? "");
    const body = `${theme.fg("toolTitle", theme.bold("primitives "))}${theme.fg("accent", "summary")}` +
      `\n${text}`;
    return new Text(body, 0, 0);
  });

  pi.registerCommand("visibility", {
    description: "Show runtime primitive visibility snapshot",
    handler: async (_args, ctx) => {
      renderVisibilityWidget(ctx, state, inventory, lastModel);
      ctx.ui.notify(buildSnapshotText(state, inventory, lastModel), "info");
    },
  });

  pi.registerCommand("visibility-reset", {
    description: "Reset primitive usage counters for this session",
    handler: async (_args, ctx) => {
      resetSessionState(state);
      renderVisibilityWidget(ctx, state, inventory, lastModel);
      ctx.ui.notify("Primitive visibility counters reset.", "success");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    inventory = collectInventory(pi);
    const model = ctx.model;
    if (model) {
      lastModel = `${model.provider}/${model.id}`;
      state.models.add(lastModel);
    }

    renderVisibilityWidget(ctx, state, inventory, lastModel);
    ctx.ui.setStatus(STATUS_ID, buildStatusLine(state, lastModel));
  });

  pi.on("model_select", async (event, ctx) => {
    lastModel = `${event.model.provider}/${event.model.id}`;
    state.models.add(lastModel);
    renderVisibilityWidget(ctx, state, inventory, lastModel);
    ctx.ui.setStatus(STATUS_ID, buildStatusLine(state, lastModel));
  });

  pi.on("input", async (event, ctx) => {
    const command = parseSlashCommand(event.text);
    if (command) {
      incrementMap(state.slashCommands, command, 1);
      if (state.inRun) {
        state.runSlashCommands.add(command);
      }
      renderVisibilityWidget(ctx, state, inventory, lastModel);
      ctx.ui.setStatus(STATUS_ID, buildStatusLine(state, lastModel));
    }

    return { action: "continue" } as const;
  });

  pi.on("tool_call", async (event, ctx) => {
    incrementMap(state.tools, event.toolName, 1);
    if (state.inRun) {
      incrementMap(state.runTools, event.toolName, 1);
    }

    if (event.toolName === "read") {
      const maybeSkill = detectSkillRead(event.input as { path?: string });
      if (maybeSkill) {
        state.skillsRead.add(maybeSkill);
        if (state.inRun) {
          state.runSkillsRead.add(maybeSkill);
        }
      }
    }

    renderVisibilityWidget(ctx, state, inventory, lastModel);
    ctx.ui.setStatus(STATUS_ID, buildStatusLine(state, lastModel));
    return undefined;
  });

  pi.on("agent_start", async (_event, ctx) => {
    state.inRun = true;
    state.runStartTs = Date.now();
    state.runTools = new Map();
    state.runSkillsRead = new Set();
    state.runSlashCommands = new Set();
    renderVisibilityWidget(ctx, state, inventory, lastModel);
    ctx.ui.setStatus(STATUS_ID, buildStatusLine(state, lastModel));
  });

  pi.on("agent_end", async (_event, ctx) => {
    state.totalTurns += 1;
    const durationMs = Math.max(0, Date.now() - state.runStartTs);
    state.inRun = false;

    const summary = buildRunSummary(state, durationMs, lastModel);

    pi.sendMessage({
      customType: MESSAGE_TYPE,
      content: summary,
      display: true,
      details: {
        durationMs,
        model: lastModel,
        runTools: mapToObject(state.runTools),
        runSkills: Array.from(state.runSkillsRead.values()),
        runSlashCommands: Array.from(state.runSlashCommands.values()),
      },
    });

    await appendPrimitiveUsageLog({
      ts: Date.now(),
      model: lastModel,
      durationMs,
      runTools: mapToObject(state.runTools),
      runSkills: Array.from(state.runSkillsRead.values()),
      runSlashCommands: Array.from(state.runSlashCommands.values()),
      sessionTotals: {
        tools: mapToObject(state.tools),
        slashCommands: mapToObject(state.slashCommands),
        skillsRead: Array.from(state.skillsRead.values()),
        turns: state.totalTurns,
      },
    });

    renderVisibilityWidget(ctx, state, inventory, lastModel);
    ctx.ui.setStatus(STATUS_ID, buildStatusLine(state, lastModel));
  });
}

function collectInventory(pi: ExtensionAPI): RuntimeInventory {
  const allCommands = pi.getCommands();
  const extensionCommands = allCommands
    .filter((item) => item.source === "extension")
    .map((item) => item.name)
    .sort();
  const promptCommands = allCommands
    .filter((item) => item.source === "prompt")
    .map((item) => item.name)
    .sort();
  const skillCommands = allCommands
    .filter((item) => item.source === "skill")
    .map((item) => item.name)
    .sort();

  const tools = pi.getAllTools().map((tool) => tool.name).sort();

  return {
    extensionCommands,
    promptCommands,
    skillCommands,
    tools,
  };
}

function renderVisibilityWidget(
  ctx: ExtensionContext,
  state: UsageStats,
  inventory: RuntimeInventory,
  model: string,
): void {
  const topTools = formatTopEntries(state.tools, 4);
  const topSlash = formatTopEntries(state.slashCommands, 4);
  const runTools = formatTopEntries(state.runTools, 4);
  const runSkills = Array.from(state.runSkillsRead.values()).slice(0, 4).join(", ") || "none";

  const lines = [
    "Visibility Dashboard",
    `- model: ${model}`,
    `- run: ${state.inRun ? "active" : "idle"} | turns=${state.totalTurns}`,
    `- tools(run): ${runTools || "none"}`,
    `- skills(run): ${runSkills}`,
    `- tools(total): ${topTools || "none"}`,
    `- slash(total): ${topSlash || "none"}`,
    `- runtime inventory: ext=${inventory.extensionCommands.length} prompt=${inventory.promptCommands.length} skill=${inventory.skillCommands.length} tool=${inventory.tools.length}`,
  ];

  ctx.ui.setWidget(WIDGET_ID, lines, { placement: "belowEditor" });
}

function buildStatusLine(state: UsageStats, model: string): string {
  const runTools = sumMap(state.runTools);
  const totalTools = sumMap(state.tools);
  return `model=${model} runTools=${runTools} totalTools=${totalTools} skills=${state.skillsRead.size}`;
}

function buildSnapshotText(state: UsageStats, inventory: RuntimeInventory, model: string): string {
  return [
    `model: ${model}`,
    `turns: ${state.totalTurns}`,
    `tools(total): ${formatTopEntries(state.tools, 12) || "none"}`,
    `slash(total): ${formatTopEntries(state.slashCommands, 12) || "none"}`,
    `skills read: ${Array.from(state.skillsRead.values()).join(", ") || "none"}`,
    `models used: ${Array.from(state.models.values()).join(", ") || "none"}`,
    `inventory -> extension commands: ${inventory.extensionCommands.length}, prompts: ${inventory.promptCommands.length}, skills: ${inventory.skillCommands.length}, tools: ${inventory.tools.length}`,
  ].join("\n");
}

function buildRunSummary(state: UsageStats, durationMs: number, model: string): string {
  const runToolText = formatTopEntries(state.runTools, 10) || "none";
  const runSkills = Array.from(state.runSkillsRead.values()).join(", ") || "none";
  const runSlash = Array.from(state.runSlashCommands.values()).join(", ") || "none";

  return [
    `model=${model}`,
    `duration=${Math.round(durationMs / 1000)}s`,
    `tools=${runToolText}`,
    `skills=${runSkills}`,
    `slash=${runSlash}`,
    `session-tools=${formatTopEntries(state.tools, 8) || "none"}`,
  ].join(" | ");
}

function parseSlashCommand(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const match = trimmed.match(/^\/([a-zA-Z0-9:_-]+)/);
  return match?.[1]?.toLowerCase() ?? null;
}

function detectSkillRead(input: { path?: string }): string | null {
  const raw = String(input.path ?? "").replace(/^@/, "").trim();
  if (!raw) {
    return null;
  }

  const normalized = raw.replace(/\\/g, "/");
  if (!normalized.endsWith("SKILL.md")) {
    return null;
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const parent = parts[parts.length - 2];
  return parent || null;
}

function incrementMap(map: Map<string, number>, key: string, delta: number): void {
  map.set(key, (map.get(key) ?? 0) + delta);
}

function formatTopEntries(map: Map<string, number>, limit: number): string {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, value]) => `${key}:${value}`)
    .join(", ");
}

function sumMap(map: Map<string, number>): number {
  let total = 0;
  for (const value of map.values()) {
    total += value;
  }
  return total;
}

function mapToObject(map: Map<string, number>): Record<string, number> {
  return Array.from(map.entries()).reduce<Record<string, number>>((acc, [key, value]) => {
    acc[key] = value;
    return acc;
  }, {});
}

function resetSessionState(state: UsageStats): void {
  state.tools.clear();
  state.slashCommands.clear();
  state.skillsRead.clear();
  state.models.clear();
  state.totalTurns = 0;
  state.runStartTs = 0;
  state.runTools.clear();
  state.runSkillsRead.clear();
  state.runSlashCommands.clear();
  state.inRun = false;
}

async function appendPrimitiveUsageLog(entry: unknown): Promise<void> {
  const configDir = getConfigDir();
  const logsDir = path.join(configDir, "logs");
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }

  const logPath = path.join(logsDir, LOG_FILE_NAME);
  const line = `${JSON.stringify(entry)}\n`;

  try {
    await appendFile(logPath, line, "utf8");
  } catch {
    try {
      await writeFile(logPath, line, "utf8");
    } catch {
      // swallow logging errors
    }
  }
}

function getConfigDir(): string {
  return (
    process.env.PI_CONFIG_DIR ??
    process.env.PI_CODING_AGENT_DIR ??
    path.join(homedir(), ".pi", "agent")
  );
}
