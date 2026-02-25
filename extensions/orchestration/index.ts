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
});

interface AgentUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

interface AgentRunResult {
  agent: string;
  source: "user" | "project" | "unknown";
  status: "pending" | "running" | "ok" | "failed";
  output: string;
  error?: string;
  usage: AgentUsage;
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

  pi.registerMessageRenderer("orchestration", (message, _options, theme) => {
    const content = typeof message.content === "string" ? message.content : String(message.content ?? "");
    const title = `${theme.fg("toolTitle", theme.bold("orchestration "))}${theme.fg("accent", "result")}`;
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
    description: "Run a team in parallel. Usage: /team <name> <goal>",
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
        onDashboardUpdate: (dashboard) => {
          lastDashboard = dashboard;
          renderDashboard(ctx, dashboardKey, dashboard);
        },
      });

      if (!result) {
        return;
      }

      const summary = formatTeamSummary(result);
      pi.sendMessage({
        customType: "orchestration",
        content: summary,
        display: true,
        details: result,
      });
    },
  });

  pi.registerCommand("pipeline", {
    description: "Run a pipeline. Usage: /pipeline <name> <goal>",
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
        onDashboardUpdate: (dashboard) => {
          lastDashboard = dashboard;
          renderDashboard(ctx, dashboardKey, dashboard);
        },
      });

      if (!result) {
        return;
      }

      const summary = formatPipelineSummary(result);
      pi.sendMessage({
        customType: "orchestration",
        content: summary,
        display: true,
        details: result,
      });
    },
  });

  pi.registerCommand("orchestration", {
    description: "Show current orchestration dashboard snapshot",
    handler: async (_args, ctx) => {
      if (!lastDashboard) {
        ctx.ui.notify("No orchestration run yet in this session.", "info");
        return;
      }
      renderDashboard(ctx, dashboardKey, lastDashboard);
      ctx.ui.notify("Refreshed orchestration dashboard.", "info");
    },
  });

  pi.registerTool({
    name: "team_run",
    label: "Team Run",
    description: "Execute a configured team in parallel and return member outputs.",
    parameters: TEAM_TOOL_PARAMS,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const result = await runTeam(pi, ctx, params.team, params.goal, {
        agentScope: (params.agentScope ?? "both") as AgentScope,
        concurrency: params.concurrency ?? 4,
        signal,
        onDashboardUpdate: (dashboard) => {
          lastDashboard = dashboard;
          renderDashboard(ctx, dashboardKey, dashboard);
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
        signal,
        onDashboardUpdate: (dashboard) => {
          lastDashboard = dashboard;
          renderDashboard(ctx, dashboardKey, dashboard);
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
    { placement: "belowEditor" },
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
  const icon = card.status === "ok" ? "✓" : card.status === "failed" ? "✗" : card.status === "running" ? "●" : "○";
  const statusColor = card.status === "ok" ? "success" : card.status === "failed" ? "error" : card.status === "running" ? "accent" : "dim";
  const statusLabel = card.status === "ok" ? "done" : card.status;

  const headerRaw = `${card.agent}${card.stepIndex ? ` (#${card.stepIndex})` : ""}`;
  const statusRaw = `${icon} ${statusLabel} · ${card.source}`;
  const usageRaw = formatUsage(card.usage);
  const snippetRaw = truncateLine(card.status === "failed" ? card.error || card.output : card.output, 220) || "(no output)";

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
    lines.push(`- ${entry.agent} [${entry.status}] ${truncateLine(entry.output || entry.error || "(no output)", 120)}`);
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
    lines.push(`- ${stepLabel}${entry.agent} [${entry.status}] ${truncateLine(entry.output || entry.error || "(no output)", 120)}`);
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
  signal?: AbortSignal;
}

async function runAgentTask(pi: ExtensionAPI, options: RunAgentTaskOptions): Promise<AgentRunResult> {
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

    let aborted = false;

    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn("pi", args, {
        cwd: options.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });

      let stdoutBuffer = "";
      let stderrBuffer = "";

      child.stdout.on("data", (chunk) => {
        stdoutBuffer += chunk.toString();
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          applyJsonEvent(line, result);
        }
      });

      child.stderr.on("data", (chunk) => {
        stderrBuffer += chunk.toString();
      });

      child.on("close", (code) => {
        if (stdoutBuffer.trim()) {
          applyJsonEvent(stdoutBuffer, result);
        }

        if (stderrBuffer.trim() && result.status !== "failed") {
          result.error = firstNonEmptyLine(stderrBuffer) ?? stderrBuffer.trim();
        }

        resolve(code ?? 0);
      });

      child.on("error", (error) => {
        result.status = "failed";
        result.error = error.message;
        resolve(1);
      });

      if (options.signal) {
        const abortChild = () => {
          aborted = true;
          child.kill("SIGTERM");
          setTimeout(() => {
            if (!child.killed) {
              child.kill("SIGKILL");
            }
          }, 4000);
        };

        if (options.signal.aborted) {
          abortChild();
        } else {
          options.signal.addEventListener("abort", abortChild, { once: true });
        }
      }
    });

    if (aborted) {
      result.status = "failed";
      result.error = "aborted";
    }

    if (exitCode !== 0) {
      result.status = "failed";
      result.error = result.error || `exit code ${exitCode}`;
    }

    if (!result.output.trim()) {
      result.output = result.error ? `error: ${result.error}` : "(no output)";
    }

    return result;
  } finally {
    if (promptDir) {
      rmSync(promptDir, { recursive: true, force: true });
    }
  }
}

function applyJsonEvent(line: string, result: AgentRunResult): void {
  if (!line.trim()) {
    return;
  }

  try {
    const event = JSON.parse(line) as { type?: string; message?: Message };
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
} {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { name: null, goal: "", scope: "both", concurrency: 4 };
  }

  let name: string | null = null;
  let scope: AgentScope = "both";
  let concurrency = 4;
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

    goalTokens.push(token);
  }

  return {
    name,
    goal: goalTokens.join(" "),
    scope,
    concurrency,
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

function formatUsage(usage: AgentUsage): string {
  const parts: string[] = [];
  if (usage.turns > 0) {
    parts.push(`${usage.turns}t`);
  }
  if (usage.contextTokens > 0) {
    parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
  }
  if (usage.cost > 0) {
    parts.push(`$${usage.cost.toFixed(4)}`);
  }
  return parts.join(" ") || "usage:none";
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
  };
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
