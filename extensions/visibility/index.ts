import { existsSync, mkdirSync } from "node:fs";
import { appendFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

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
const MESSAGE_TYPE = "visibility-summary";
const EMIT_RUN_SUMMARY = false;
const FOOTER_SEP = "  ";

const ICONS = {
  repo: "",
  branch: "",
  provider: "󰒋",
  model: "󰭹",
  thinking: "󰔛",
  io: "󰮍",
  context: "󰾆",
  cost: "󰠓",
  run: "󱦟",
  status: "",
} as const;

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
  let liveWidgetEnabled = false;

  const refreshUi = (ctx: ExtensionContext): void => {
    if (liveWidgetEnabled) {
      renderVisibilityWidget(ctx, state, inventory, lastModel);
    } else {
      ctx.ui.setWidget(WIDGET_ID, undefined);
    }
  };

  const installUnifiedFooter = (ctx: ExtensionContext): void => {
    if (!ctx.hasUI) {
      return;
    }

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsubscribe,
        invalidate() {},
        render(width: number): string[] {
          const line = buildUnifiedFooterLine(width, theme, footerData, ctx, pi, state, lastModel);
          return [line];
        },
      };
    });
  };

  pi.registerMessageRenderer(MESSAGE_TYPE, (message, _options, theme) => {
    const text = typeof message.content === "string" ? message.content : String(message.content ?? "");
    const body = `${theme.fg("toolTitle", theme.bold("primitives "))}${theme.fg("accent", "summary")}` +
      `\n${text}`;
    return new Text(body, 0, 0);
  });

  pi.registerCommand("visibility", {
    description: "Inspect or toggle primitive visibility UI. Usage: /visibility [on|off]",
    handler: async (args, ctx) => {
      const mode = args.trim().toLowerCase();
      if (mode === "on") {
        liveWidgetEnabled = true;
        refreshUi(ctx);
        ctx.ui.notify("Visibility widget enabled.", "info");
        return;
      }

      if (mode === "off") {
        liveWidgetEnabled = false;
        refreshUi(ctx);
        ctx.ui.notify("Visibility widget disabled.", "info");
        return;
      }

      ctx.ui.notify(buildSnapshotText(state, inventory, lastModel), "info");
    },
  });

  pi.registerCommand("visibility-reset", {
    description: "Reset primitive usage counters for this session",
    handler: async (_args, ctx) => {
      resetSessionState(state);
      refreshUi(ctx);
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

    installUnifiedFooter(ctx);
    refreshUi(ctx);
  });

  pi.on("model_select", async (event, ctx) => {
    lastModel = `${event.model.provider}/${event.model.id}`;
    state.models.add(lastModel);
    refreshUi(ctx);
  });

  pi.on("input", async (event, ctx) => {
    const command = parseSlashCommand(event.text);
    if (command) {
      incrementMap(state.slashCommands, command, 1);
      if (state.inRun) {
        state.runSlashCommands.add(command);
      }
      refreshUi(ctx);
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

    refreshUi(ctx);
    return undefined;
  });

  pi.on("agent_start", async (_event, ctx) => {
    state.inRun = true;
    state.runStartTs = Date.now();
    state.runTools = new Map();
    state.runSkillsRead = new Set();
    state.runSlashCommands = new Set();
    refreshUi(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    state.totalTurns += 1;
    const durationMs = Math.max(0, Date.now() - state.runStartTs);
    state.inRun = false;

    const summary = buildRunSummary(state, durationMs, lastModel);

    if (EMIT_RUN_SUMMARY) {
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
    }

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

    refreshUi(ctx);
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
    "Visibility",
    `- model: ${model}`,
    `- run: ${state.inRun ? "active" : "idle"} | turns=${state.totalTurns}`,
    `- tools(run): ${runTools || "none"}`,
    `- skills(run): ${runSkills}`,
    `- tools(total): ${topTools || "none"}`,
    `- slash(total): ${topSlash || "none"}`,
    `- inventory: ext=${inventory.extensionCommands.length} prompt=${inventory.promptCommands.length} skill=${inventory.skillCommands.length} tool=${inventory.tools.length}`,
  ];

  ctx.ui.setWidget(WIDGET_ID, lines, { placement: "aboveEditor" });
}

function buildSnapshotText(state: UsageStats, inventory: RuntimeInventory, model: string): string {
  return [
    `model: ${model}`,
    `run: ${state.inRun ? "active" : "idle"}`,
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

function buildUnifiedFooterLine(
  width: number,
  theme: any,
  footerData: {
    getGitBranch(): string | null;
    getExtensionStatuses(): ReadonlyMap<string, string>;
  },
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  state: UsageStats,
  lastModel: string,
): string {
  const separator = theme.fg("borderMuted", FOOTER_SEP);
  const branch = footerData.getGitBranch();
  const repo = path.basename(ctx.cwd) || ctx.cwd || "~";

  const leftSegments: string[] = [
    `${theme.fg("accent", ICONS.repo)} ${theme.fg("text", repo)}`,
  ];

  if (branch) {
    leftSegments.push(`${theme.fg("accent", ICONS.branch)} ${theme.fg("muted", branch)}`);
  }

  if (state.inRun) {
    leftSegments.push(theme.fg("warning", `${ICONS.run} run`));
  }

  const extensionStatus = summarizeExtensionStatuses(footerData.getExtensionStatuses());
  if (extensionStatus) {
    leftSegments.push(`${theme.fg("accent", ICONS.status)} ${theme.fg("muted", extensionStatus)}`);
  }

  const modelRef = resolveModelRef(ctx, lastModel);
  const thinking = pi.getThinkingLevel();
  const usage = calculateSessionUsage(ctx);
  const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;

  const rightSegments: string[] = [
    `${theme.fg("accent", ICONS.provider)} ${theme.fg("text", modelRef.provider)}`,
    `${theme.fg("accent", ICONS.model)} ${theme.fg("text", modelRef.modelId)}`,
    `${theme.fg("accent", ICONS.thinking)} ${styleThinkingValue(thinking, theme)}`,
  ];

  if (usage.input > 0 || usage.output > 0) {
    rightSegments.push(
      `${theme.fg("accent", ICONS.io)} ${theme.fg("muted", `↑${formatTokens(usage.input)} ↓${formatTokens(usage.output)}`)}`,
    );
  }

  const contextValue = formatContextUsage(ctx, theme);
  if (contextValue) {
    rightSegments.push(`${theme.fg("accent", ICONS.context)} ${contextValue}`);
  }

  rightSegments.push(
    `${theme.fg("accent", ICONS.cost)} ${theme.fg("muted", `$${usage.cost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`)}`,
  );

  const left = leftSegments.join(separator);
  const right = rightSegments.join(separator);

  return mergeFooterColumns(left, right, width, theme);
}

function mergeFooterColumns(left: string, right: string, width: number, theme: any): string {
  if (!left && !right) {
    return "";
  }
  if (!left) {
    return truncateToWidth(right, width, theme.fg("dim", "…"));
  }
  if (!right) {
    return truncateToWidth(left, width, theme.fg("dim", "…"));
  }

  const leftWidth = visibleWidth(left);
  const rightWidth = visibleWidth(right);

  if (leftWidth + 1 + rightWidth <= width) {
    const spacing = " ".repeat(Math.max(1, width - leftWidth - rightWidth));
    return left + spacing + right;
  }

  if (rightWidth + 1 >= width) {
    return truncateToWidth(right, width, theme.fg("dim", "…"));
  }

  const maxLeftWidth = Math.max(10, width - rightWidth - 1);
  const leftTruncated = truncateToWidth(left, maxLeftWidth, theme.fg("dim", "…"));
  const truncatedLeftWidth = visibleWidth(leftTruncated);
  const spacing = " ".repeat(Math.max(1, width - truncatedLeftWidth - rightWidth));

  const line = leftTruncated + spacing + right;
  return truncateToWidth(line, width, theme.fg("dim", "…"));
}

function summarizeExtensionStatuses(statuses: ReadonlyMap<string, string>): string | null {
  const entries = Array.from(statuses.entries())
    .map(([key, value]) => ({ key, value: sanitizeStatusText(value) }))
    .filter((entry) => entry.value.length > 0)
    .sort((a, b) => a.key.localeCompare(b.key));

  if (entries.length === 0) {
    return null;
  }

  const concise = entries
    .slice(0, 2)
    .map((entry) => `${entry.key}:${entry.value}`)
    .join(" • ");

  if (entries.length > 2) {
    return `${concise} +${entries.length - 2}`;
  }

  return concise;
}

function sanitizeStatusText(text: string): string {
  return (text || "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

function resolveModelRef(ctx: ExtensionContext, fallback: string): { provider: string; modelId: string } {
  if (ctx.model) {
    return {
      provider: ctx.model.provider,
      modelId: ctx.model.id,
    };
  }
  return splitModelRef(fallback);
}

function splitModelRef(model: string): { provider: string; modelId: string } {
  const normalized = model.trim();
  if (!normalized || normalized === "unknown") {
    return { provider: "unknown", modelId: "unknown" };
  }

  const slash = normalized.indexOf("/");
  if (slash < 0) {
    return { provider: "unknown", modelId: normalized };
  }

  return {
    provider: normalized.slice(0, slash),
    modelId: normalized.slice(slash + 1) || "unknown",
  };
}

function styleThinkingValue(thinking: string, theme: any): string {
  switch (thinking) {
    case "xhigh":
      return theme.fg("error", thinking);
    case "high":
      return theme.fg("warning", thinking);
    case "medium":
      return theme.fg("accent", thinking);
    case "low":
      return theme.fg("muted", thinking);
    case "minimal":
      return theme.fg("muted", thinking);
    case "off":
      return theme.fg("dim", thinking);
    default:
      return theme.fg("muted", thinking);
  }
}

function calculateSessionUsage(ctx: ExtensionContext): { input: number; output: number; cost: number } {
  let input = 0;
  let output = 0;
  let cost = 0;

  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      input += entry.message.usage.input;
      output += entry.message.usage.output;
      cost += entry.message.usage.cost.total;
    }
  }

  return { input, output, cost };
}

function formatContextUsage(ctx: ExtensionContext, theme: any): string | null {
  const usage = ctx.getContextUsage();
  const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
  if (contextWindow <= 0) {
    return null;
  }

  const percent = usage?.percent;
  const display = percent === null || percent === undefined
    ? `?/${formatTokens(contextWindow)}`
    : `${percent.toFixed(1)}%/${formatTokens(contextWindow)}`;

  if (percent !== null && percent !== undefined) {
    if (percent > 90) {
      return theme.fg("error", display);
    }
    if (percent > 70) {
      return theme.fg("warning", display);
    }
  }

  return theme.fg("muted", display);
}

function formatTokens(value: number): string {
  if (value < 1000) {
    return String(value);
  }
  if (value < 10000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  if (value < 1000000) {
    return `${Math.round(value / 1000)}k`;
  }
  return `${(value / 1000000).toFixed(1)}M`;
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
