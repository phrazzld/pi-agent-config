import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { StringEnum, type Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

import { discoverAgents, type AgentConfig, type AgentScope } from "../subagent/agents";
import { loadOrchestrationConfig, type PipelineSpec, type TeamMap, type PipelineMap } from "./config";
import {
  AdaptiveGovernor,
  resolveGovernorPolicy,
  type GovernorMode,
  type GovernorOverrides,
  type GovernorSummary,
} from "./governor";

const ORCHESTRATION_MESSAGE_TYPE = "orchestration";
const ORCHESTRATION_SYNTHESIS_MESSAGE_TYPE = "orchestration-synthesis";
const ORCHESTRATION_WIDGET_PLACEMENT = "aboveEditor" as const;
const ORCHESTRATION_DASHBOARD_AUTO_CLEAR_MS = 8_000;
const LOCK_RETRY_MAX_ATTEMPTS = 4;
const LOCK_RETRY_BASE_DELAY_MS = 120;
const SYNTHESIS_MAX_OUTPUT_CHARS_PER_MEMBER = 4_000;
const SYNTHESIS_MAX_TOTAL_CHARS = 28_000;

const GOVERNOR_MODE_ENUM = StringEnum(["observe", "warn", "enforce"] as const);

const TEAM_TOOL_PARAMS = Type.Object({
  team: Type.String({ description: "Team name from agents/teams.yaml" }),
  goal: Type.String({ description: "Goal/task to execute with the team" }),
  agentScope: Type.Optional(
    StringEnum(["user", "project", "both"] as const, {
      description: "Agent discovery scope",
      default: "both",
    }),
  ),
  concurrency: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
  governorMode: Type.Optional(GOVERNOR_MODE_ENUM),
  governorMaxCostUsd: Type.Optional(Type.Number({ minimum: 0.000001 })),
  governorMaxTokens: Type.Optional(Type.Integer({ minimum: 1 })),
  governorFuseSeconds: Type.Optional(Type.Integer({ minimum: 60 })),
});

const PIPELINE_TOOL_PARAMS = Type.Object({
  pipeline: Type.String({ description: "Pipeline name from agents/pipelines.yaml" }),
  goal: Type.String({ description: "Goal/task to execute through the pipeline" }),
  agentScope: Type.Optional(
    StringEnum(["user", "project", "both"] as const, {
      description: "Agent discovery scope",
      default: "both",
    }),
  ),
  governorMode: Type.Optional(GOVERNOR_MODE_ENUM),
  governorMaxCostUsd: Type.Optional(Type.Number({ minimum: 0.000001 })),
  governorMaxTokens: Type.Optional(Type.Integer({ minimum: 1 })),
  governorFuseSeconds: Type.Optional(Type.Integer({ minimum: 60 })),
});

interface AgentUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
  toolCalls: number;
}

interface AgentRunResult {
  agent: string;
  source: "user" | "project" | "unknown";
  status: "pending" | "running" | "ok" | "failed";
  output: string;
  error?: string;
  usage: AgentUsage;
  governor?: GovernorSummary;
  stepIndex?: number;
}

interface DashboardState {
  mode: "team" | "pipeline";
  name: string;
  goal: string;
  startedAt: number;
  cards: AgentRunResult[];
  graph?: string;
}

interface TeamExecutionResult {
  mode: "team";
  team: string;
  goal: string;
  results: AgentRunResult[];
}

interface PipelineExecutionResult {
  mode: "pipeline";
  pipeline: string;
  goal: string;
  checkpoints: string[];
  results: AgentRunResult[];
}

export default function orchestrationExtension(pi: ExtensionAPI): void {
  const dashboardKey = "orchestration-dashboard";
  let lastDashboard: DashboardState | null = null;
  let dashboardClearTimer: ReturnType<typeof setTimeout> | null = null;

  pi.registerMessageRenderer(ORCHESTRATION_MESSAGE_TYPE, (message, _options, theme) => {
    const content = typeof message.content === "string" ? message.content : String(message.content ?? "");
    const title = `${theme.fg("toolTitle", theme.bold("orchestration "))}${theme.fg("accent", "result")}`;
    return new Text(`${title}\n${content}`, 0, 0);
  });

  pi.registerMessageRenderer(ORCHESTRATION_SYNTHESIS_MESSAGE_TYPE, (message, _options, theme) => {
    const content = typeof message.content === "string" ? message.content : String(message.content ?? "");
    const title = `${theme.fg("toolTitle", theme.bold("orchestration "))}${theme.fg("accent", "synthesis")}`;
    return new Text(`${title}\n${content}`, 0, 0);
  });

  pi.registerCommand("teams", {
    description: "List configured teams from agents/teams.yaml",
    handler: async (_args, ctx) => {
      const { teams, warnings, source, baseDir } = loadConfig(ctx.cwd);
      const lines = formatTeams(teams);
      const out = [`Teams (source=${source}, base=${baseDir}):`, ...lines];
      if (warnings.length > 0) {
        out.push("", "Warnings:", ...warnings.map((warning) => `- ${warning}`));
      }
      ctx.ui.notify(out.join("\n"), "info");
    },
  });

  pi.registerCommand("pipelines", {
    description: "List configured pipelines from agents/pipelines.yaml",
    handler: async (_args, ctx) => {
      const { pipelines, warnings, source, baseDir } = loadConfig(ctx.cwd);
      const lines = formatPipelines(pipelines);
      const out = [`Pipelines (source=${source}, base=${baseDir}):`, ...lines];
      if (warnings.length > 0) {
        out.push("", "Warnings:", ...warnings.map((warning) => `- ${warning}`));
      }
      ctx.ui.notify(out.join("\n"), "info");
    },
  });

  pi.registerCommand("team", {
    description: "Run a team in parallel. Usage: /team <name> <goal> [--concurrency N] [--gov-mode observe|warn|enforce]",
    handler: async (args, ctx) => {
      const parsed = parseNamedGoalArgs(args);
      if (!parsed.name) {
        ctx.ui.notify("Usage: /team <name> <goal>", "warning");
        return;
      }

      const goal = parsed.goal || (await promptForGoal(ctx, `Goal for team ${parsed.name}`));
      if (!goal) {
        ctx.ui.notify("Canceled: no goal provided.", "info");
        return;
      }

      const result = await runTeam(pi, ctx, parsed.name, goal, {
        agentScope: parsed.scope,
        concurrency: parsed.concurrency,
        governor: parsed.governor,
        onDashboardUpdate: (dashboard) => onDashboardUpdate(ctx, dashboard),
      });

      if (!result) {
        return;
      }

      const summary = formatTeamSummary(result);
      pi.sendMessage({
        customType: ORCHESTRATION_MESSAGE_TYPE,
        content: summary,
        display: true,
        details: result,
      });

      scheduleDashboardAutoClear(ctx);

      const synthesis = await synthesizeTeamExecution(ctx, result, parsed.scope);
      if (synthesis) {
        pi.sendMessage({
          customType: ORCHESTRATION_SYNTHESIS_MESSAGE_TYPE,
          content: synthesis.output,
          display: true,
          details: {
            team: result.team,
            goal: result.goal,
            synthesizer: synthesis.agent,
            usage: synthesis.usage,
          },
        });
      }
    },
  });

  pi.registerCommand("pipeline", {
    description: "Run a pipeline. Usage: /pipeline <name> <goal> [--gov-mode observe|warn|enforce]",
    handler: async (args, ctx) => {
      const parsed = parseNamedGoalArgs(args);
      if (!parsed.name) {
        ctx.ui.notify("Usage: /pipeline <name> <goal>", "warning");
        return;
      }

      const goal = parsed.goal || (await promptForGoal(ctx, `Goal for pipeline ${parsed.name}`));
      if (!goal) {
        ctx.ui.notify("Canceled: no goal provided.", "info");
        return;
      }

      const result = await runPipeline(pi, ctx, parsed.name, goal, {
        agentScope: parsed.scope,
        governor: parsed.governor,
        onDashboardUpdate: (dashboard) => onDashboardUpdate(ctx, dashboard),
      });

      if (!result) {
        return;
      }

      const summary = formatPipelineSummary(result);
      pi.sendMessage({
        customType: ORCHESTRATION_MESSAGE_TYPE,
        content: summary,
        display: true,
        details: result,
      });

      scheduleDashboardAutoClear(ctx);
    },
  });

  pi.registerCommand("orchestration", {
    description: "Show current orchestration dashboard snapshot",
    handler: async (_args, ctx) => {
      if (!lastDashboard) {
        ctx.ui.notify("No orchestration run yet in this session.", "info");
        return;
      }

      clearDashboardTimer();
      renderDashboard(ctx, dashboardKey, lastDashboard);
      ctx.ui.notify("Refreshed orchestration dashboard.", "info");
    },
  });

  pi.registerCommand("orchestration-clear", {
    description: "Clear orchestration dashboard widget/status",
    handler: async (_args, ctx) => {
      clearDashboardTimer();
      clearDashboard(ctx, dashboardKey);
      ctx.ui.notify("Cleared orchestration dashboard.", "info");
    },
  });

  function clearDashboardTimer(): void {
    if (dashboardClearTimer) {
      clearTimeout(dashboardClearTimer);
      dashboardClearTimer = null;
    }
  }

  function scheduleDashboardAutoClear(ctx: ExtensionContext): void {
    clearDashboardTimer();
    dashboardClearTimer = setTimeout(() => {
      clearDashboard(ctx, dashboardKey);
      dashboardClearTimer = null;
    }, ORCHESTRATION_DASHBOARD_AUTO_CLEAR_MS);
  }

  function onDashboardUpdate(ctx: ExtensionContext, dashboard: DashboardState): void {
    clearDashboardTimer();
    lastDashboard = dashboard;
    renderDashboard(ctx, dashboardKey, dashboard);
  }

  pi.registerTool({
    name: "team_run",
    label: "Team Run",
    description: "Execute a configured team in parallel and return member outputs.",
    parameters: TEAM_TOOL_PARAMS,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const result = await runTeam(pi, ctx, params.team, params.goal, {
        agentScope: (params.agentScope ?? "both") as AgentScope,
        concurrency: params.concurrency ?? 4,
        governor: toGovernorOverrides(params),
        signal,
        onDashboardUpdate: (dashboard) => {
          onDashboardUpdate(ctx, dashboard);
          onUpdate?.({
            content: [{ type: "text", text: summarizeDashboardProgress(dashboard) }],
            details: dashboard,
          });
        },
      });

      if (!result) {
        return {
          content: [{ type: "text", text: `Failed to run team ${params.team}.` }],
          details: { ok: false, team: params.team },
          isError: true,
        };
      }

      scheduleDashboardAutoClear(ctx);

      return {
        content: [{ type: "text", text: formatTeamSummary(result) }],
        details: result,
        isError: result.results.some((entry) => entry.status === "failed"),
      };
    },
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("team_run "))}${theme.fg("accent", String(args.team))}`,
        0,
        0,
      );
    },
  });

  pi.registerTool({
    name: "pipeline_run",
    label: "Pipeline Run",
    description: "Execute a configured pipeline sequentially and return step outputs.",
    parameters: PIPELINE_TOOL_PARAMS,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const result = await runPipeline(pi, ctx, params.pipeline, params.goal, {
        agentScope: (params.agentScope ?? "both") as AgentScope,
        governor: toGovernorOverrides(params),
        signal,
        onDashboardUpdate: (dashboard) => {
          onDashboardUpdate(ctx, dashboard);
          onUpdate?.({
            content: [{ type: "text", text: summarizeDashboardProgress(dashboard) }],
            details: dashboard,
          });
        },
      });

      if (!result) {
        return {
          content: [{ type: "text", text: `Failed to run pipeline ${params.pipeline}.` }],
          details: { ok: false, pipeline: params.pipeline },
          isError: true,
        };
      }

      scheduleDashboardAutoClear(ctx);

      return {
        content: [{ type: "text", text: formatPipelineSummary(result) }],
        details: result,
        isError: result.results.some((entry) => entry.status === "failed"),
      };
    },
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("pipeline_run "))}${theme.fg("accent", String(args.pipeline))}`,
        0,
        0,
      );
    },
  });

}

function clearDashboard(ctx: ExtensionContext, widgetKey: string): void {
  ctx.ui.setWidget(widgetKey, undefined);
  ctx.ui.setStatus("orchestration", undefined);
}

function loadConfig(cwd: string): {
  teams: TeamMap;
  pipelines: PipelineMap;
  warnings: string[];
  source: "project" | "global";
  baseDir: string;
} {
  const projectAgentsDir = findNearestProjectAgentsDir(cwd);
  if (projectAgentsDir) {
    const loaded = loadOrchestrationConfig({
      teamsPath: path.join(projectAgentsDir, "teams.yaml"),
      pipelinesPath: path.join(projectAgentsDir, "pipelines.yaml"),
    });
    return {
      ...loaded,
      source: "project",
      baseDir: projectAgentsDir,
    };
  }

  const configDir = getConfigDir();
  const baseDir = path.join(configDir, "agents");
  const loaded = loadOrchestrationConfig({
    teamsPath: path.join(baseDir, "teams.yaml"),
    pipelinesPath: path.join(baseDir, "pipelines.yaml"),
  });
  return {
    ...loaded,
    source: "global",
    baseDir,
  };
}

async function runTeam(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  teamName: string,
  goal: string,
  options: {
    agentScope: AgentScope;
    concurrency: number;
    governor?: GovernorOverrides;
    signal?: AbortSignal;
    onDashboardUpdate: (state: DashboardState) => void;
  },
): Promise<TeamExecutionResult | null> {
  const { teams, warnings, source, baseDir } = loadConfig(ctx.cwd);
  if (warnings.length > 0 && ctx.hasUI) {
    ctx.ui.notify(warnings.join("\n"), "warning");
  }
  if (ctx.hasUI) {
    ctx.ui.notify(`Orchestration config source: ${source} (${baseDir})`, "info");
  }

  const members = teams[teamName];
  if (!members || members.length === 0) {
    ctx.ui.notify(`Unknown or empty team: ${teamName}`, "warning");
    return null;
  }

  const discovery = discoverAgents(ctx.cwd, options.agentScope);
  if (discovery.agents.length === 0) {
    ctx.ui.notify("No agents discovered for team execution.", "warning");
    return null;
  }

  const cards: AgentRunResult[] = members.map((name) => ({
    agent: name,
    source: "unknown",
    status: "running",
    output: "starting...",
    usage: emptyUsage(),
  }));

  const dashboard: DashboardState = {
    mode: "team",
    name: teamName,
    goal,
    startedAt: Date.now(),
    cards,
  };

  options.onDashboardUpdate(dashboard);

  const limit = Math.max(1, Math.min(8, options.concurrency));
  await mapWithConcurrencyLimit(members, limit, async (member, index) => {
    const result = await runAgentTask(pi, {
      agents: discovery.agents,
      agentName: member,
      task: `Team: ${teamName}\nGoal: ${goal}`,
      cwd: ctx.cwd,
      governor: options.governor,
      signal: options.signal,
    });

    cards[index] = result;
    options.onDashboardUpdate(dashboard);
    return result;
  });

  return {
    mode: "team",
    team: teamName,
    goal,
    results: cards,
  };
}

async function runPipeline(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  pipelineName: string,
  goal: string,
  options: {
    agentScope: AgentScope;
    governor?: GovernorOverrides;
    signal?: AbortSignal;
    onDashboardUpdate: (state: DashboardState) => void;
  },
): Promise<PipelineExecutionResult | null> {
  const { pipelines, warnings, source, baseDir } = loadConfig(ctx.cwd);
  if (warnings.length > 0 && ctx.hasUI) {
    ctx.ui.notify(warnings.join("\n"), "warning");
  }
  if (ctx.hasUI) {
    ctx.ui.notify(`Orchestration config source: ${source} (${baseDir})`, "info");
  }

  const pipeline = pipelines[pipelineName];
  if (!pipeline || pipeline.steps.length === 0) {
    ctx.ui.notify(`Unknown or empty pipeline: ${pipelineName}`, "warning");
    return null;
  }

  const discovery = discoverAgents(ctx.cwd, options.agentScope);
  if (discovery.agents.length === 0) {
    ctx.ui.notify("No agents discovered for pipeline execution.", "warning");
    return null;
  }

  const cards: AgentRunResult[] = pipeline.steps.map((step, index) => ({
    agent: step.agent,
    source: "unknown",
    status: index === 0 ? "running" : "pending",
    output: index === 0 ? "starting..." : "pending",
    usage: emptyUsage(),
    stepIndex: index + 1,
  }));

  const dashboard: DashboardState = {
    mode: "pipeline",
    name: pipelineName,
    goal,
    startedAt: Date.now(),
    cards,
    graph: renderPipelineGraph(pipeline, 0),
  };

  options.onDashboardUpdate(dashboard);

  let input = goal;
  const original = goal;

  for (let index = 0; index < pipeline.steps.length; index++) {
    const step = pipeline.steps[index];
    dashboard.graph = renderPipelineGraph(pipeline, index);

    const task = step.prompt
      .replace(/\$INPUT/g, input)
      .replace(/\$ORIGINAL/g, original);

    cards[index].status = "running";
    cards[index].output = `running step ${index + 1}`;
    options.onDashboardUpdate(dashboard);

    const result = await runAgentTask(pi, {
      agents: discovery.agents,
      agentName: step.agent,
      task,
      cwd: step.cwd ? resolveRuntimePath(step.cwd, ctx.cwd) : ctx.cwd,
      governor: options.governor,
      signal: options.signal,
    });

    cards[index] = {
      ...result,
      stepIndex: index + 1,
    };

    if (result.status === "failed") {
      for (let rest = index + 1; rest < cards.length; rest++) {
        cards[rest] = {
          ...cards[rest],
          status: "failed",
          output: "skipped after failure",
          error: "skipped",
        };
      }
      options.onDashboardUpdate(dashboard);
      return {
        mode: "pipeline",
        pipeline: pipelineName,
        goal,
        checkpoints: pipeline.checkpoints ?? [],
        results: cards,
      };
    }

    input = result.output || input;

    if (index + 1 < cards.length) {
      cards[index + 1].status = "running";
      cards[index + 1].output = "queued";
    }

    options.onDashboardUpdate(dashboard);
  }

  return {
    mode: "pipeline",
    pipeline: pipelineName,
    goal,
    checkpoints: pipeline.checkpoints ?? [],
    results: cards,
  };
}

function renderDashboard(ctx: ExtensionContext, widgetKey: string, dashboard: DashboardState): void {
  const done = dashboard.cards.filter((card) => card.status === "ok").length;
  const failed = dashboard.cards.filter((card) => card.status === "failed").length;

  ctx.ui.setWidget(
    widgetKey,
    (_tui, theme) => {
      const text = new Text("", 0, 0);
      return {
        render(width: number): string[] {
          const lines = buildDashboardLines(dashboard, width, theme);
          text.setText(lines.join("\n"));
          return text.render(width);
        },
        invalidate(): void {
          text.invalidate();
        },
      };
    },
    { placement: ORCHESTRATION_WIDGET_PLACEMENT },
  );

  ctx.ui.setStatus("orchestration", `${dashboard.mode}:${dashboard.name} done=${done}/${dashboard.cards.length} fail=${failed}`);
}

function buildDashboardLines(dashboard: DashboardState, width: number, theme: any): string[] {
  const done = dashboard.cards.filter((card) => card.status === "ok").length;
  const failed = dashboard.cards.filter((card) => card.status === "failed").length;
  const running = dashboard.cards.filter((card) => card.status === "running").length;
  const pending = dashboard.cards.filter((card) => card.status === "pending").length;
  const elapsed = Math.round((Date.now() - dashboard.startedAt) / 1000);

  const lines: string[] = [
    `${theme.fg("toolTitle", theme.bold("Orchestration "))}${theme.fg("accent", `${dashboard.mode}:${dashboard.name}`)}`,
    theme.fg("muted", `progress done=${done} fail=${failed} run=${running} pending=${pending} elapsed=${elapsed}s`),
    theme.fg("dim", `goal: ${truncateToWidth(dashboard.goal, Math.max(20, width - 6))}`),
  ];

  if (dashboard.graph) {
    lines.push(theme.fg("accent", "flow: ") + stylePipelineGraph(dashboard.graph, theme));
  }

  lines.push("");

  const cardLines = renderCardGrid(dashboard.cards, width, theme);
  lines.push(...cardLines);

  return lines.map((line) => truncateToWidth(line, width));
}

function renderCardGrid(cards: AgentRunResult[], width: number, theme: any): string[] {
  if (cards.length === 0) {
    return [theme.fg("dim", "(no active cards)")];
  }

  const gap = 2;
  const suggestedCols = cards.length >= 7 ? 3 : cards.length >= 4 ? 2 : cards.length;

  let cols = Math.max(1, suggestedCols);
  while (cols > 1) {
    const candidateWidth = Math.floor((width - gap * (cols - 1)) / cols);
    if (candidateWidth >= 34) {
      break;
    }
    cols -= 1;
  }

  const cardWidth = Math.max(24, Math.floor((width - gap * (cols - 1)) / cols));
  const cardSets = cards.map((card) => renderCard(card, cardWidth, theme));
  const cardHeight = cardSets[0]?.length ?? 0;
  const out: string[] = [];

  for (let index = 0; index < cardSets.length; index += cols) {
    const rowCards = cardSets.slice(index, index + cols);
    while (rowCards.length < cols) {
      rowCards.push(blankCard(cardWidth, cardHeight));
    }

    for (let line = 0; line < cardHeight; line++) {
      const joined = rowCards.map((card) => card[line] ?? "").join(" ".repeat(gap));
      out.push(truncateToWidth(joined, width));
    }

    if (index + cols < cardSets.length) {
      out.push("");
    }
  }

  return out;
}

function renderCard(card: AgentRunResult, width: number, theme: any): string[] {
  const inner = Math.max(12, width - 2);
  const icon = card.status === "ok" ? "✅" : card.status === "failed" ? "❌" : card.status === "running" ? "⏳" : "⏸";
  const statusColor = card.status === "ok" ? "success" : card.status === "failed" ? "error" : card.status === "running" ? "accent" : "dim";
  const statusLabel = card.status === "ok" ? "done" : card.status;
  const sourceIcon = card.source === "project" ? "📁" : card.source === "user" ? "🧭" : "❔";

  const headerRaw = `${card.agent}${card.stepIndex ? ` (#${card.stepIndex})` : ""}`;
  const governorBadge = formatGovernorBadge(card.governor);
  const statusRaw = `${icon} ${statusLabel}  ${sourceIcon} source:${card.source}${governorBadge ? `  ${governorBadge}` : ""}`;
  const usageRaw = formatUsage(card.usage, card.governor);
  const snippetRaw = truncateLine(card.status === "failed" ? card.error || card.output : card.output, 200) || "(no output)";

  const top = theme.fg("borderMuted", `┌${"─".repeat(inner)}┐`);
  const bottom = theme.fg("borderMuted", `└${"─".repeat(inner)}┘`);

  const lines = [
    top,
    borderLine(theme.fg("accent", truncateToWidth(headerRaw, inner)), inner, theme),
    borderLine(theme.fg(statusColor, truncateToWidth(statusRaw, inner)), inner, theme),
    borderLine(theme.fg("dim", truncateToWidth(usageRaw, inner)), inner, theme),
    borderLine(theme.fg("muted", truncateToWidth(snippetRaw, inner)), inner, theme),
    bottom,
  ];

  return lines;
}

function blankCard(width: number, height: number): string[] {
  return new Array(height).fill(" ".repeat(Math.max(1, width)));
}

function borderLine(content: string, innerWidth: number, theme: any): string {
  const left = theme.fg("borderMuted", "│");
  const right = theme.fg("borderMuted", "│");
  return `${left}${padAnsi(content, innerWidth)}${right}`;
}

function padAnsi(text: string, width: number): string {
  const visible = visibleWidth(text);
  if (visible >= width) {
    return text;
  }
  return `${text}${" ".repeat(width - visible)}`;
}

function stylePipelineGraph(graph: string, theme: any): string {
  return graph.replace(/\[([^\]]+)\]/g, (_, name: string) => theme.fg("accent", theme.bold(name)));
}

function renderPipelineGraph(pipeline: PipelineSpec, activeIndex: number): string {
  return pipeline.steps
    .map((step, index) => (index === activeIndex ? `[${step.agent}]` : step.agent))
    .join(" → ");
}

function summarizeDashboardProgress(dashboard: DashboardState): string {
  const done = dashboard.cards.filter((card) => card.status === "ok").length;
  const failed = dashboard.cards.filter((card) => card.status === "failed").length;
  const running = dashboard.cards.filter((card) => card.status === "running").length;
  const pending = dashboard.cards.filter((card) => card.status === "pending").length;
  return `${dashboard.mode}:${dashboard.name} done=${done} failed=${failed} running=${running} pending=${pending}`;
}

function formatTeamSummary(result: TeamExecutionResult): string {
  const ok = result.results.filter((entry) => entry.status === "ok").length;
  const failed = result.results.length - ok;
  const lines = [
    `team=${result.team} goal=${result.goal}`,
    `ok=${ok} failed=${failed}`,
  ];

  for (const entry of result.results) {
    const governorSuffix = entry.governor && entry.governor.status !== "ok"
      ? ` gov=${entry.governor.status}${entry.governor.reason ? `:${entry.governor.reason}` : ""}`
      : "";
    lines.push(`- ${entry.agent} [${entry.status}]${governorSuffix} ${truncateLine(entry.output || entry.error || "(no output)", 120)}`);
  }

  return lines.join("\n");
}

function formatPipelineSummary(result: PipelineExecutionResult): string {
  const ok = result.results.filter((entry) => entry.status === "ok").length;
  const failed = result.results.length - ok;
  const lines = [
    `pipeline=${result.pipeline} goal=${result.goal}`,
    `ok=${ok} failed=${failed}`,
  ];

  if (result.checkpoints.length > 0) {
    lines.push(`checkpoints=${result.checkpoints.join(", ")}`);
  }

  for (const entry of result.results) {
    const stepLabel = entry.stepIndex ? `#${entry.stepIndex} ` : "";
    const governorSuffix = entry.governor && entry.governor.status !== "ok"
      ? ` gov=${entry.governor.status}${entry.governor.reason ? `:${entry.governor.reason}` : ""}`
      : "";
    lines.push(`- ${stepLabel}${entry.agent} [${entry.status}]${governorSuffix} ${truncateLine(entry.output || entry.error || "(no output)", 120)}`);
  }

  return lines.join("\n");
}

function formatTeams(teams: TeamMap): string[] {
  const names = Object.keys(teams).sort();
  if (names.length === 0) {
    return ["- (none)"];
  }

  return names.map((name) => `- ${name}: ${(teams[name] ?? []).join(", ") || "(empty)"}`);
}

function formatPipelines(pipelines: PipelineMap): string[] {
  const names = Object.keys(pipelines).sort();
  if (names.length === 0) {
    return ["- (none)"];
  }

  return names.map((name) => {
    const spec = pipelines[name];
    const stepNames = spec.steps.map((step) => step.agent).join(" -> ");
    return `- ${name}: ${spec.description ?? "(no description)"} | steps=${spec.steps.length} (${stepNames})`;
  });
}

interface RunAgentTaskOptions {
  agents: AgentConfig[];
  agentName: string;
  task: string;
  cwd: string;
  governor?: GovernorOverrides;
  signal?: AbortSignal;
}

async function runAgentTask(_pi: ExtensionAPI, options: RunAgentTaskOptions): Promise<AgentRunResult> {
  const config = options.agents.find((candidate) => candidate.name === options.agentName);
  if (!config) {
    return {
      agent: options.agentName,
      source: "unknown",
      status: "failed",
      output: "",
      error: `Unknown agent: ${options.agentName}`,
      usage: emptyUsage(),
    };
  }

  return runAgentTaskWithConfig(config, {
    task: options.task,
    cwd: options.cwd,
    governor: options.governor,
    signal: options.signal,
    maxAttempts: LOCK_RETRY_MAX_ATTEMPTS,
  });
}

async function runAgentTaskWithConfig(
  config: AgentConfig,
  options: {
    task: string;
    cwd: string;
    governor?: GovernorOverrides;
    signal?: AbortSignal;
    maxAttempts?: number;
  },
): Promise<AgentRunResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 1);
  let lastResult: AgentRunResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptResult = await runAgentTaskAttempt(config, {
      task: options.task,
      cwd: options.cwd,
      governor: options.governor,
      signal: options.signal,
    });

    lastResult = attemptResult.result;

    const lockIssue = hasLockIssue(attemptResult.stderr, attemptResult.result.error, attemptResult.result.output);
    const noMeaningfulOutput = !attemptResult.result.output.trim() || attemptResult.result.output === "(no output)";
    const shouldRetry = lockIssue && (attemptResult.result.status === "failed" || noMeaningfulOutput);

    if (shouldRetry && attempt < maxAttempts) {
      const delayMs = backoffWithJitterMs(attempt);
      await sleep(delayMs, options.signal);
      continue;
    }

    if (attemptResult.result.status === "ok" && attemptResult.result.error && hasLockIssue(attemptResult.result.error)) {
      attemptResult.result.error = undefined;
    }

    return attemptResult.result;
  }

  return (
    lastResult ?? {
      agent: config.name,
      source: config.source,
      status: "failed",
      output: "error: lock contention retries exhausted",
      error: "lock contention retries exhausted",
      usage: emptyUsage(),
    }
  );
}

async function runAgentTaskAttempt(
  config: AgentConfig,
  options: {
    task: string;
    cwd: string;
    governor?: GovernorOverrides;
    signal?: AbortSignal;
  },
): Promise<{ result: AgentRunResult; stderr: string }> {
  const args: string[] = ["--mode", "json", "-p", "--no-session"];
  if (config.model) {
    args.push("--model", config.model);
  }
  if (config.tools && config.tools.length > 0) {
    args.push("--tools", config.tools.join(","));
  }

  let promptDir: string | null = null;
  try {
    if (config.systemPrompt.trim()) {
      const promptFile = createTempPromptFile(config.name, config.systemPrompt);
      promptDir = promptFile.dir;
      args.push("--append-system-prompt", promptFile.filePath);
    }

    args.push(`Task: ${options.task}`);

    const result: AgentRunResult = {
      agent: config.name,
      source: config.source,
      status: "ok",
      output: "",
      usage: emptyUsage(),
    };

    const governor = new AdaptiveGovernor(resolveGovernorPolicy(options.governor));

    let aborted = false;
    let abortedByGovernor = false;
    let governorAbortMessage: string | undefined;

    const { exitCode, stderr } = await new Promise<{ exitCode: number; stderr: string }>((resolve) => {
      const child = spawn("pi", args, {
        cwd: options.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });

      let stdoutBuffer = "";
      let stderrBuffer = "";
      let governorTimer: ReturnType<typeof setInterval> | null = null;

      const stopGovernorTimer = () => {
        if (governorTimer) {
          clearInterval(governorTimer);
          governorTimer = null;
        }
      };

      const abortChild = (origin: "signal" | "governor", message?: string) => {
        if (aborted) {
          return;
        }
        aborted = true;
        stopGovernorTimer();
        if (origin === "governor") {
          abortedByGovernor = true;
          governorAbortMessage = message ?? "governor policy triggered";
        }

        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 4000);
      };

      const evaluateGovernor = () => {
        const decision = governor.evaluate(Date.now(), result.usage);
        if (decision.action === "abort") {
          abortChild("governor", decision.message);
        }
      };

      child.stdout.on("data", (chunk) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          applyJsonEvent(line, result, governor);
        }
      });

      child.stderr.on("data", (chunk) => {
        stderrBuffer += chunk.toString();
      });

      child.on("close", (code) => {
        stopGovernorTimer();

        if (stdoutBuffer.trim()) {
          applyJsonEvent(stdoutBuffer, result, governor);
        }

        if (stderrBuffer.trim() && result.status !== "failed") {
          result.error = firstNonEmptyLine(stderrBuffer) ?? stderrBuffer.trim();
        }

        resolve({ exitCode: code ?? 0, stderr: stderrBuffer });
      });

      child.on("error", (error) => {
        stopGovernorTimer();
        result.status = "failed";
        result.error = error.message;
        resolve({ exitCode: 1, stderr: error.message });
      });

      governorTimer = setInterval(evaluateGovernor, governor.policy.checkIntervalMs);

      if (options.signal) {
        const abortFromSignal = () => {
          abortChild("signal", "aborted");
        };

        if (options.signal.aborted) {
          abortFromSignal();
        } else {
          options.signal.addEventListener("abort", abortFromSignal, { once: true });
        }
      }
    });

    result.governor = governor.summarize(Date.now(), result.usage, abortedByGovernor);

    if (abortedByGovernor) {
      result.status = "failed";
      result.error = governorAbortMessage ?? "governor policy triggered";
    } else if (aborted) {
      result.status = "failed";
      result.error = "aborted";
    }

    if (exitCode !== 0 && !abortedByGovernor) {
      result.status = "failed";
      result.error = result.error || `exit code ${exitCode}`;
    }

    if (!result.output.trim()) {
      result.output = result.error ? `error: ${result.error}` : "(no output)";
    }

    return { result, stderr };
  } finally {
    if (promptDir) {
      rmSync(promptDir, { recursive: true, force: true });
    }
  }
}

function applyJsonEvent(line: string, result: AgentRunResult, governor?: AdaptiveGovernor): void {
  if (!line.trim()) {
    return;
  }

  try {
    const event = JSON.parse(line) as {
      type?: string;
      message?: Message;
      toolCallId?: string;
      toolName?: string;
      args?: unknown;
      isError?: boolean;
    };

    if (event.type === "tool_execution_start" && event.toolCallId && event.toolName) {
      result.usage.toolCalls += 1;
      governor?.recordToolStart(event.toolCallId, event.toolName, event.args ?? {});
      return;
    }

    if (event.type === "tool_execution_end" && event.toolCallId && event.toolName) {
      governor?.recordToolEnd(event.toolCallId, event.toolName, event.isError === true);
      return;
    }

    if (event.type !== "message_end" || !event.message) {
      return;
    }

    const message = event.message;
    if (message.role !== "assistant") {
      return;
    }

    const text = extractAssistantText(message);
    if (text) {
      result.output = text;
      governor?.recordAssistantMessage(text);
    }

    if (message.stopReason === "error" || message.stopReason === "aborted") {
      result.status = "failed";
      if (message.errorMessage) {
        result.error = message.errorMessage;
      }
    }

    if (message.usage) {
      result.usage.turns += 1;
      result.usage.input += message.usage.input ?? 0;
      result.usage.output += message.usage.output ?? 0;
      result.usage.cacheRead += message.usage.cacheRead ?? 0;
      result.usage.cacheWrite += message.usage.cacheWrite ?? 0;
      result.usage.cost += message.usage.cost?.total ?? 0;
      result.usage.contextTokens = message.usage.totalTokens ?? result.usage.contextTokens;
    }
  } catch {
    // ignore malformed lines
  }
}

function extractAssistantText(message: Message): string {
  const parts: string[] = [];
  for (const part of message.content) {
    if (part.type === "text" && part.text.trim()) {
      parts.push(part.text.trim());
    }
  }
  return parts.join("\n").trim();
}

async function mapWithConcurrencyLimit<T, TResult>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<TResult>(items.length);
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;

  const runners = new Array(limit).fill(null).map(async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

function parseNamedGoalArgs(args: string): {
  name: string | null;
  goal: string;
  scope: AgentScope;
  concurrency: number;
  governor: GovernorOverrides;
} {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { name: null, goal: "", scope: "both", concurrency: 4, governor: {} };
  }

  let name: string | null = null;
  let scope: AgentScope = "both";
  let concurrency = 4;
  const governor: GovernorOverrides = {};
  const goalTokens: string[] = [];

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!name && !token.startsWith("--")) {
      name = token;
      continue;
    }

    if (token === "--scope" && tokens[index + 1]) {
      const maybe = tokens[index + 1] as AgentScope;
      if (maybe === "user" || maybe === "project" || maybe === "both") {
        scope = maybe;
      }
      index += 1;
      continue;
    }

    if (token.startsWith("--scope=")) {
      const maybe = token.slice("--scope=".length) as AgentScope;
      if (maybe === "user" || maybe === "project" || maybe === "both") {
        scope = maybe;
      }
      continue;
    }

    if (token === "--concurrency" && tokens[index + 1]) {
      const value = Number(tokens[index + 1]);
      if (Number.isFinite(value)) {
        concurrency = Math.max(1, Math.min(8, Math.floor(value)));
      }
      index += 1;
      continue;
    }

    if (token.startsWith("--concurrency=")) {
      const value = Number(token.slice("--concurrency=".length));
      if (Number.isFinite(value)) {
        concurrency = Math.max(1, Math.min(8, Math.floor(value)));
      }
      continue;
    }

    if ((token === "--gov-mode" || token === "--governor-mode") && tokens[index + 1]) {
      const mode = parseGovernorMode(tokens[index + 1]);
      if (mode) {
        governor.mode = mode;
      }
      index += 1;
      continue;
    }

    if (token.startsWith("--gov-mode=") || token.startsWith("--governor-mode=")) {
      const raw = token.includes("--gov-mode=")
        ? token.slice("--gov-mode=".length)
        : token.slice("--governor-mode=".length);
      const mode = parseGovernorMode(raw);
      if (mode) {
        governor.mode = mode;
      }
      continue;
    }

    if (token === "--gov-max-cost" && tokens[index + 1]) {
      const value = Number(tokens[index + 1]);
      if (Number.isFinite(value) && value > 0) {
        governor.maxCostUsd = value;
      }
      index += 1;
      continue;
    }

    if (token.startsWith("--gov-max-cost=")) {
      const value = Number(token.slice("--gov-max-cost=".length));
      if (Number.isFinite(value) && value > 0) {
        governor.maxCostUsd = value;
      }
      continue;
    }

    if (token === "--gov-max-tokens" && tokens[index + 1]) {
      const value = Number(tokens[index + 1]);
      if (Number.isFinite(value) && value > 0) {
        governor.maxTokens = Math.floor(value);
      }
      index += 1;
      continue;
    }

    if (token.startsWith("--gov-max-tokens=")) {
      const value = Number(token.slice("--gov-max-tokens=".length));
      if (Number.isFinite(value) && value > 0) {
        governor.maxTokens = Math.floor(value);
      }
      continue;
    }

    if (token === "--gov-fuse-seconds" && tokens[index + 1]) {
      const value = Number(tokens[index + 1]);
      if (Number.isFinite(value) && value >= 60) {
        governor.emergencyFuseSeconds = Math.floor(value);
      }
      index += 1;
      continue;
    }

    if (token.startsWith("--gov-fuse-seconds=")) {
      const value = Number(token.slice("--gov-fuse-seconds=".length));
      if (Number.isFinite(value) && value >= 60) {
        governor.emergencyFuseSeconds = Math.floor(value);
      }
      continue;
    }

    goalTokens.push(token);
  }

  return {
    name,
    goal: goalTokens.join(" "),
    scope,
    concurrency,
    governor,
  };
}

function parseGovernorMode(value: string): GovernorMode | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "observe" || normalized === "warn" || normalized === "enforce") {
    return normalized as GovernorMode;
  }
  return null;
}

function toGovernorOverrides(input: {
  governorMode?: string;
  governorMaxCostUsd?: number;
  governorMaxTokens?: number;
  governorFuseSeconds?: number;
}): GovernorOverrides {
  const mode = parseGovernorMode(String(input.governorMode ?? ""));
  return {
    mode: mode ?? undefined,
    maxCostUsd: Number.isFinite(input.governorMaxCostUsd) && (input.governorMaxCostUsd ?? 0) > 0
      ? input.governorMaxCostUsd
      : undefined,
    maxTokens: Number.isFinite(input.governorMaxTokens) && (input.governorMaxTokens ?? 0) > 0
      ? Math.floor(input.governorMaxTokens as number)
      : undefined,
    emergencyFuseSeconds: Number.isFinite(input.governorFuseSeconds) && (input.governorFuseSeconds ?? 0) >= 60
      ? Math.floor(input.governorFuseSeconds as number)
      : undefined,
  };
}

async function promptForGoal(ctx: ExtensionContext, title: string): Promise<string | null> {
  if (!ctx.hasUI) {
    return null;
  }
  const response = await ctx.ui.input(title, "Describe the objective");
  const trimmed = response?.trim() ?? "";
  return trimmed || null;
}

function truncateLine(text: string, maxChars: number): string {
  const normalized = (text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function formatUsage(usage: AgentUsage, governor?: GovernorSummary): string {
  const parts: string[] = [];
  if (usage.turns > 0) {
    parts.push(`🔁 turns:${usage.turns}`);
  }
  if (usage.toolCalls > 0) {
    parts.push(`🛠 tools:${usage.toolCalls}`);
  }
  if (usage.contextTokens > 0) {
    parts.push(`🧠 ctx:${formatTokens(usage.contextTokens)}`);
  }
  if (usage.cost > 0) {
    parts.push(`💰 $${usage.cost.toFixed(4)}`);
  }
  if (governor && governor.status !== "ok") {
    parts.push(`⚖ ${governor.status}${governor.reason ? `:${governor.reason}` : ""}`);
  }
  return parts.join("  ") || "usage:none";
}

function formatGovernorBadge(governor?: GovernorSummary): string {
  if (!governor || governor.status === "ok") {
    return "";
  }

  return `⚖ ${governor.status}${governor.reason ? `:${governor.reason}` : ""}`;
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

function emptyUsage(): AgentUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    contextTokens: 0,
    turns: 0,
    toolCalls: 0,
  };
}


async function synthesizeTeamExecution(
  ctx: ExtensionContext,
  result: TeamExecutionResult,
  scope: AgentScope,
): Promise<AgentRunResult | null> {
  const membersWithOutput = result.results.filter((entry) => entry.output.trim() || entry.error?.trim());
  if (membersWithOutput.length === 0) {
    return null;
  }

  const discovery = discoverAgents(ctx.cwd, scope);
  if (discovery.agents.length === 0) {
    return null;
  }

  const synthesizer = pickSynthesizerAgent(discovery.agents, membersWithOutput.map((entry) => entry.agent));
  if (!synthesizer) {
    return null;
  }

  const synthesisTask = buildTeamSynthesisTask(result);

  if (ctx.hasUI) {
    ctx.ui.setStatus("orchestration", `team:${result.team} synthesizing with ${synthesizer.name}...`);
  }

  const synthesis = await runAgentTaskWithConfig(synthesizer, {
    task: synthesisTask,
    cwd: ctx.cwd,
    maxAttempts: LOCK_RETRY_MAX_ATTEMPTS,
  });

  if (ctx.hasUI) {
    ctx.ui.setStatus("orchestration", undefined);
  }

  if (synthesis.status !== "ok") {
    if (ctx.hasUI) {
      ctx.ui.notify(
        `Team synthesis failed (${synthesizer.name}): ${synthesis.error ?? "unknown error"}`,
        "warning",
      );
    }
    return null;
  }

  return synthesis;
}

function pickSynthesizerAgent(agents: AgentConfig[], memberNames: string[]): AgentConfig | null {
  const preferred = ["documenter", "planner", "reviewer", ...memberNames];
  for (const name of preferred) {
    const found = agents.find((agent) => agent.name === name);
    if (found) {
      return found;
    }
  }
  return agents[0] ?? null;
}

function buildTeamSynthesisTask(result: TeamExecutionResult): string {
  const sections: string[] = [];
  let budget = SYNTHESIS_MAX_TOTAL_CHARS;

  for (const entry of result.results) {
    if (budget <= 0) {
      break;
    }

    const bodySource = (entry.status === "failed" ? entry.error || entry.output : entry.output) || "(no output)";
    const bounded = truncateMultiline(bodySource, Math.min(SYNTHESIS_MAX_OUTPUT_CHARS_PER_MEMBER, budget));
    budget -= bounded.length;

    sections.push(`### ${entry.agent} [${entry.status}]
${bounded}`);
  }

  return [
    `Team: ${result.team}`,
    `Goal: ${result.goal}`,
    "",
    "You are synthesizing outputs from all team members for the human operator.",
    "Requirements:",
    "- Read every member section below before deciding.",
    "- Call out cross-member consensus and disagreements explicitly.",
    "- Mention failed members and the confidence impact.",
    "- Keep the synthesis concise and action-oriented.",
    "",
    "Output format:",
    "## Synthesis",
    "## Key Agreements",
    "## Open Questions / Risks",
    "## Recommended Next Actions",
    "",
    "Member outputs:",
    sections.join("\n\n"),
  ].join("\n");
}

function truncateMultiline(text: string, maxChars: number): string {
  const normalized = (text || "").trim();
  if (!normalized) {
    return "(no output)";
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function hasLockIssue(...values: Array<string | undefined>): boolean {
  const joined = values.filter(Boolean).join("\n");
  if (!joined) {
    return false;
  }
  return /lock file is already being held|elocked/i.test(joined);
}

function backoffWithJitterMs(attempt: number): number {
  const exp = Math.max(0, attempt - 1);
  const base = LOCK_RETRY_BASE_DELAY_MS * 2 ** exp;
  const jitter = Math.floor(Math.random() * LOCK_RETRY_BASE_DELAY_MS);
  return Math.min(2_000, base + jitter);
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function resolveRuntimePath(token: string, cwd: string): string {
  const trimmed = token.replace(/^['"]|['"]$/g, "").trim();
  if (!trimmed) {
    return cwd;
  }
  if (trimmed.startsWith("~")) {
    return path.resolve(path.join(homedir(), trimmed.slice(1)));
  }
  if (path.isAbsolute(trimmed)) {
    return path.resolve(trimmed);
  }
  return path.resolve(cwd, trimmed);
}

function firstNonEmptyLine(text: string): string | null {
  const line = text
    .split("\n")
    .map((value) => value.trim())
    .find(Boolean);
  return line ?? null;
}

function findNearestProjectAgentsDir(cwd: string): string | null {
  let current = path.resolve(cwd);
  while (true) {
    const candidate = path.join(current, ".pi", "agents");
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function getConfigDir(): string {
  return (
    process.env.PI_CONFIG_DIR ??
    process.env.PI_CODING_AGENT_DIR ??
    path.join(homedir(), ".pi", "agent")
  );
}

function createTempPromptFile(agentName: string, promptText: string): { dir: string; filePath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "pi-orch-"));
  const safe = agentName.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const filePath = path.join(dir, `${safe}.md`);
  writeFileSync(filePath, promptText, { encoding: "utf8", mode: 0o600 });
  return { dir, filePath };
}
