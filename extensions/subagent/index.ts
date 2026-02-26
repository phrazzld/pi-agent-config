import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { StringEnum, type Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

import {
  type AgentConfig,
  type AgentScope,
  discoverAgents,
  formatAgentList,
} from "./agents";
import { type DelegatedHealthSummary } from "../shared/delegated-health";
import {
  runDelegatedCommand,
  type DelegatedRunnerProgressMarker,
} from "../shared/delegation-runner";
import {
  appendSubagentExecutionContract,
  resolveGuardrailBudget,
  type GuardrailBudget,
} from "./guardrails";
import {
  canInvokeSubagentTool,
  formatDelegationPolicyBlock,
  resolveDelegationCaller,
  withDelegationCaller,
} from "../shared/delegation-policy";

const MAX_PARALLEL_TASKS = 8;
const MAX_PARALLEL_CONCURRENCY = 4;

interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

interface SingleResult {
  agent: string;
  agentSource: "user" | "project" | "unknown";
  task: string;
  exitCode: number;
  messages: Message[];
  stderr: string;
  usage: UsageStats;
  model?: string;
  configuredModel?: string;
  configuredTools?: string[];
  stopReason?: string;
  errorMessage?: string;
  step?: number;
  startedAtMs: number;
  lastUpdateAtMs: number;
  elapsedMs: number;
  toolCallCount: number;
  lastAction?: string;
  maxTurns?: number;
  maxRuntimeSeconds?: number;
  health?: DelegatedHealthSummary;
}

interface SubagentDetails {
  mode: "single" | "parallel" | "chain";
  agentScope: AgentScope;
  projectAgentsDir: string | null;
  results: SingleResult[];
}

type UpdateEmitter =
  | ((partial: { content: Array<{ type: "text"; text: string }>; details: SubagentDetails }) => void)
  | undefined;

const TaskItem = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task to delegate to the agent" }),
  cwd: Type.Optional(Type.String({ description: "Working directory for this delegated run" })),
  maxTurns: Type.Optional(Type.Number({ description: "Turn cap override for this delegated run" })),
  maxRuntimeSeconds: Type.Optional(Type.Number({ description: "Runtime cap override for this delegated run" })),
});

const ChainItem = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task with optional {previous} placeholder" }),
  cwd: Type.Optional(Type.String({ description: "Working directory for this delegated run" })),
  maxTurns: Type.Optional(Type.Number({ description: "Turn cap override for this chain step" })),
  maxRuntimeSeconds: Type.Optional(Type.Number({ description: "Runtime cap override for this chain step" })),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
  description: "Agent source scope. Default is user (~/.pi/agent/agents).",
  default: "user",
});

const SubagentParams = Type.Object({
  agent: Type.Optional(Type.String({ description: "Agent name (single mode)" })),
  task: Type.Optional(Type.String({ description: "Task text (single mode)" })),
  tasks: Type.Optional(Type.Array(TaskItem, { description: "Parallel mode" })),
  chain: Type.Optional(Type.Array(ChainItem, { description: "Sequential chain mode" })),
  agentScope: Type.Optional(AgentScopeSchema),
  confirmProjectAgents: Type.Optional(
    Type.Boolean({
      description: "Require explicit confirmation before running project-local agents.",
      default: true,
    })
  ),
  maxTurns: Type.Optional(
    Type.Number({ description: "Global turn cap for delegated runs. Defaults to extension/agent policy." })
  ),
  maxRuntimeSeconds: Type.Optional(
    Type.Number({ description: "Global runtime cap in seconds for delegated runs." })
  ),
  cwd: Type.Optional(Type.String({ description: "Working directory for single mode" })),
});

export default function subagentExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Delegate work to isolated Pi subprocesses. Supports single, parallel, and chain execution modes.",
    parameters: SubagentParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const caller = resolveDelegationCaller(process.env);
      if (!canInvokeSubagentTool(caller)) {
        return {
          content: [{ type: "text", text: formatDelegationPolicyBlock("subagent", caller) }],
          details: makeDetails("single", params.agentScope ?? "user", null, []),
          isError: true,
        };
      }

      const agentScope: AgentScope = params.agentScope ?? "user";
      const discovery = discoverAgents(ctx.cwd, agentScope);
      const agents = discovery.agents;

      if (agents.length === 0) {
        return {
          content: [{ type: "text", text: "No subagents discovered. Add agents under ~/.pi/agent/agents." }],
          details: makeDetails("single", agentScope, discovery.projectAgentsDir, []),
          isError: true,
        };
      }

      const hasChain = (params.chain?.length ?? 0) > 0;
      const hasParallel = (params.tasks?.length ?? 0) > 0;
      const hasSingle = Boolean(params.agent && params.task);
      const selectedModes = Number(hasChain) + Number(hasParallel) + Number(hasSingle);
      const listed = formatAgentList(agents, 8);

      if (selectedModes !== 1) {
        return {
          content: [
            {
              type: "text",
              text: [
                "Invalid parameters for subagent.",
                "Provide exactly one mode: single (agent+task), parallel (tasks), or chain (chain).",
                `Available agents: ${listed.text}${listed.remaining > 0 ? ` (+${listed.remaining} more)` : ""}`,
              ].join("\n"),
            },
          ],
          details: makeDetails("single", agentScope, discovery.projectAgentsDir, []),
          isError: true,
        };
      }

      if (shouldConfirmProjectAgents(params, agentScope, ctx.hasUI)) {
        const requested = collectRequestedAgents(params, agents);
        const projectRequested = requested.filter((agent) => agent.source === "project");
        if (projectRequested.length > 0) {
          const accepted = await ctx.ui.confirm(
            "Run project-local subagents?",
            [
              `Agents: ${projectRequested.map((agent) => agent.name).join(", ")}`,
              `Source: ${discovery.projectAgentsDir ?? "(unknown)"}`,
              "",
              "Project-local agents are repository-controlled prompt code.",
              "Continue only if this repository is trusted.",
            ].join("\n")
          );

          if (!accepted) {
            return {
              content: [{ type: "text", text: "Canceled: project-local subagents were not approved." }],
              details: makeDetails(
                hasChain ? "chain" : hasParallel ? "parallel" : "single",
                agentScope,
                discovery.projectAgentsDir,
                []
              ),
            };
          }
        }
      }

      const emit = onUpdate as UpdateEmitter;

      if (hasChain && params.chain) {
        const results: SingleResult[] = [];
        let previous = "";

        for (let i = 0; i < params.chain.length; i++) {
          const step = params.chain[i];
          const task = step.task.replace(/\{previous\}/g, previous);

          const result = await runSingleAgent({
            defaultCwd: ctx.cwd,
            agents,
            agentName: step.agent,
            task,
            cwd: step.cwd,
            step: i + 1,
            signal,
            guardrailBudget: resolveGuardrailBudget({
              maxTurns: step.maxTurns,
              maxRuntimeSeconds: step.maxRuntimeSeconds,
            }, {
              maxTurns: params.maxTurns,
              maxRuntimeSeconds: params.maxRuntimeSeconds,
            }),
            onUpdate: emit
              ? (partial) => {
                  const running = [...results, partial];
                  emit({
                    content: [{ type: "text", text: getFinalOutput(partial.messages) || "(running...)" }],
                    details: makeDetails("chain", agentScope, discovery.projectAgentsDir, running),
                  });
                }
              : undefined,
          });

          results.push(result);
          if (isFailure(result)) {
            const reason = result.errorMessage ?? result.stderr ?? getFinalOutput(result.messages) ?? "(no output)";
            return {
              content: [{ type: "text", text: `Chain stopped at step ${i + 1} (${step.agent}): ${reason}` }],
              details: makeDetails("chain", agentScope, discovery.projectAgentsDir, results),
              isError: true,
            };
          }

          previous = getFinalOutput(result.messages);
        }

        return {
          content: [{ type: "text", text: getFinalOutput(results[results.length - 1].messages) || "(no output)" }],
          details: makeDetails("chain", agentScope, discovery.projectAgentsDir, results),
        };
      }

      if (hasParallel && params.tasks) {
        if (params.tasks.length > MAX_PARALLEL_TASKS) {
          return {
            content: [
              {
                type: "text",
                text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
              },
            ],
            details: makeDetails("parallel", agentScope, discovery.projectAgentsDir, []),
            isError: true,
          };
        }

        const allResults: SingleResult[] = params.tasks.map((task) =>
          emptyResult(task.agent, task.task)
        );

        const emitParallelProgress = () => {
          if (!emit) {
            return;
          }

          const runningCount = allResults.filter((result) => result.exitCode === -1).length;
          const doneCount = allResults.length - runningCount;
          emit({
            content: [
              {
                type: "text",
                text: `Parallel progress: ${doneCount}/${allResults.length} done, ${runningCount} running`,
              },
            ],
            details: makeDetails("parallel", agentScope, discovery.projectAgentsDir, [...allResults]),
          });
        };

        const results = await mapWithConcurrencyLimit(params.tasks, MAX_PARALLEL_CONCURRENCY, async (task, index) => {
          const result = await runSingleAgent({
            defaultCwd: ctx.cwd,
            agents,
            agentName: task.agent,
            task: task.task,
            cwd: task.cwd,
            signal,
            guardrailBudget: resolveGuardrailBudget({
              maxTurns: task.maxTurns,
              maxRuntimeSeconds: task.maxRuntimeSeconds,
            }, {
              maxTurns: params.maxTurns,
              maxRuntimeSeconds: params.maxRuntimeSeconds,
            }),
            onUpdate: emit
              ? (partial) => {
                  allResults[index] = partial;
                  emitParallelProgress();
                }
              : undefined,
          });

          allResults[index] = result;
          emitParallelProgress();
          return result;
        });

        const successCount = results.filter((result) => !isFailure(result)).length;

        return {
          content: [
            {
              type: "text",
              text: `Parallel complete: ${successCount}/${results.length} succeeded.`,
            },
          ],
          details: makeDetails("parallel", agentScope, discovery.projectAgentsDir, results),
          isError: successCount !== results.length,
        };
      }

      if (hasSingle && params.agent && params.task) {
        const result = await runSingleAgent({
          defaultCwd: ctx.cwd,
          agents,
          agentName: params.agent,
          task: params.task,
          cwd: params.cwd,
          signal,
          guardrailBudget: resolveGuardrailBudget(undefined, {
            maxTurns: params.maxTurns,
            maxRuntimeSeconds: params.maxRuntimeSeconds,
          }),
          onUpdate: emit,
        });

        if (isFailure(result)) {
          const reason = result.errorMessage ?? result.stderr ?? getFinalOutput(result.messages) ?? "(no output)";
          return {
            content: [{ type: "text", text: `Subagent failed: ${reason}` }],
            details: makeDetails("single", agentScope, discovery.projectAgentsDir, [result]),
            isError: true,
          };
        }

        return {
          content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
          details: makeDetails("single", agentScope, discovery.projectAgentsDir, [result]),
        };
      }

      return {
        content: [{ type: "text", text: "Invalid subagent invocation." }],
        details: makeDetails("single", agentScope, discovery.projectAgentsDir, []),
        isError: true,
      };
    },
    renderCall(args, theme) {
      const scope = (args.agentScope as AgentScope | undefined) ?? "user";
      if (Array.isArray(args.chain) && args.chain.length > 0) {
        return new Text(
          `${theme.fg("toolTitle", theme.bold("subagent "))}${theme.fg("accent", `chain(${args.chain.length})`)}${theme.fg("muted", ` [${scope}]`)}`,
          0,
          0
        );
      }
      if (Array.isArray(args.tasks) && args.tasks.length > 0) {
        return new Text(
          `${theme.fg("toolTitle", theme.bold("subagent "))}${theme.fg("accent", `parallel(${args.tasks.length})`)}${theme.fg("muted", ` [${scope}]`)}`,
          0,
          0
        );
      }

      const agent = (args.agent as string | undefined) ?? "(unknown)";
      return new Text(
        `${theme.fg("toolTitle", theme.bold("subagent "))}${theme.fg("accent", agent)}${theme.fg("muted", ` [${scope}]`)}`,
        0,
        0
      );
    },
    renderResult(result, options, theme) {
      const details = result.details as SubagentDetails | undefined;
      if (!details || details.results.length === 0) {
        const first = result.content[0];
        return new Text(first?.type === "text" ? first.text : "(no output)", 0, 0);
      }

      const expanded = options.expanded;
      let out = `${theme.fg("toolTitle", theme.bold(`mode=${details.mode}`))}${theme.fg("muted", ` scope=${details.agentScope}`)}`;

      for (const entry of details.results) {
        const state =
          entry.exitCode === -1
            ? theme.fg("warning", "running")
            : isFailure(entry)
              ? theme.fg("error", "failed")
              : theme.fg("success", "ok");

        out += `\n\n${theme.fg("accent", entry.agent)} (${entry.agentSource}) ${state}`;
        if (entry.step) {
          out += theme.fg("muted", ` step=${entry.step}`);
        }

        const elapsedSeconds = (entry.elapsedMs / 1000).toFixed(1);
        const budgetParts: string[] = [];
        if (entry.maxTurns) {
          budgetParts.push(`turns ${entry.usage.turns}/${entry.maxTurns}`);
        } else {
          budgetParts.push(`turns ${entry.usage.turns}`);
        }
        budgetParts.push(`tools ${entry.toolCallCount}`);
        if (entry.maxRuntimeSeconds) {
          budgetParts.push(`runtime ${elapsedSeconds}s/${entry.maxRuntimeSeconds}s`);
        } else {
          budgetParts.push(`runtime ${elapsedSeconds}s`);
        }
        out += `\n${theme.fg("muted", budgetParts.join(" · "))}`;

        if (entry.health) {
          const healthState =
            entry.health.classification === "healthy"
              ? theme.fg("success", entry.health.classification)
              : entry.health.classification === "slow"
                ? theme.fg("warning", entry.health.classification)
                : theme.fg("error", entry.health.classification);
          out += `\n${theme.fg("dim", `health: ${healthState} no-progress=${entry.health.noProgressSeconds}s stalls=${entry.health.stallEpisodes}`)}`;
        }

        if (entry.model || entry.configuredModel) {
          out += `\n${theme.fg("dim", `model: ${entry.model ?? entry.configuredModel}`)}`;
        }
        if (entry.configuredTools && entry.configuredTools.length > 0) {
          out += `\n${theme.fg("dim", `tools: ${entry.configuredTools.join(",")}`)}`;
        }

        if (entry.lastAction) {
          out += `\n${theme.fg("dim", `last: ${entry.lastAction}`)}`;
        }

        const preview = getFinalOutput(entry.messages);
        if (preview) {
          const rendered = expanded ? preview : preview.split("\n").slice(0, 3).join("\n");
          out += `\n${rendered}`;
          if (!expanded && preview.split("\n").length > 3) {
            out += `\n${theme.fg("muted", "(expand for full output)")}`;
          }
        } else if (entry.stderr) {
          out += `\n${theme.fg("dim", entry.stderr.trim())}`;
        } else {
          out += `\n${theme.fg("muted", "(no final text yet)")}`;
        }

        out += `\n${theme.fg("dim", formatUsage(entry.usage, entry.model ?? entry.configuredModel))}`;
      }

      return new Text(out.trim(), 0, 0);
    },
  });
}

function makeDetails(
  mode: "single" | "parallel" | "chain",
  agentScope: AgentScope,
  projectAgentsDir: string | null,
  results: SingleResult[]
): SubagentDetails {
  return { mode, agentScope, projectAgentsDir, results };
}

function collectRequestedAgents(
  params: {
    agent?: string;
    tasks?: Array<{ agent: string }>;
    chain?: Array<{ agent: string }>;
  },
  allAgents: AgentConfig[]
): AgentConfig[] {
  const names = new Set<string>();
  if (params.agent) {
    names.add(params.agent);
  }
  if (params.tasks) {
    for (const task of params.tasks) {
      names.add(task.agent);
    }
  }
  if (params.chain) {
    for (const step of params.chain) {
      names.add(step.agent);
    }
  }

  return Array.from(names)
    .map((name) => allAgents.find((agent) => agent.name === name))
    .filter((agent): agent is AgentConfig => Boolean(agent));
}

function shouldConfirmProjectAgents(
  params: { confirmProjectAgents?: boolean },
  scope: AgentScope,
  hasUI: boolean
): boolean {
  if (!hasUI) {
    return false;
  }
  if (scope === "user") {
    return false;
  }

  return params.confirmProjectAgents ?? true;
}

function isFailure(result: SingleResult): boolean {
  return (
    result.exitCode !== 0 ||
    result.stopReason === "error" ||
    result.stopReason === "aborted"
  );
}

function emptyResult(agent: string, task: string): SingleResult {
  const now = Date.now();
  return {
    agent,
    agentSource: "unknown",
    task,
    exitCode: -1,
    messages: [],
    stderr: "",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 0,
      turns: 0,
    },
    startedAtMs: now,
    lastUpdateAtMs: now,
    elapsedMs: 0,
    toolCallCount: 0,
  };
}

interface RunSingleAgentOptions {
  defaultCwd: string;
  agents: AgentConfig[];
  agentName: string;
  task: string;
  cwd?: string;
  step?: number;
  signal?: AbortSignal;
  guardrailBudget?: Partial<GuardrailBudget>;
  onUpdate?: (result: SingleResult) => void;
}

async function runSingleAgent(options: RunSingleAgentOptions): Promise<SingleResult> {
  const agent = options.agents.find((candidate) => candidate.name === options.agentName);
  if (!agent) {
    return {
      ...emptyResult(options.agentName, options.task),
      agentSource: "unknown",
      exitCode: 1,
      stderr: `Unknown agent: ${options.agentName}`,
      step: options.step,
    };
  }

  const guardrailBudget = resolveGuardrailBudget(options.guardrailBudget, {
    maxTurns: agent.maxTurns,
    maxRuntimeSeconds: agent.maxRuntimeSeconds,
  });

  const args: string[] = ["--mode", "json", "-p", "--no-session"];
  if (agent.model) {
    args.push("--model", agent.model);
  }
  if (agent.tools && agent.tools.length > 0) {
    args.push("--tools", agent.tools.join(","));
  }

  let promptDir: string | null = null;
  try {
    if (agent.systemPrompt.trim()) {
      const promptFile = createTempPromptFile(
        agent.name,
        appendSubagentExecutionContract(agent.systemPrompt, guardrailBudget)
      );
      promptDir = promptFile.dir;
      args.push("--append-system-prompt", promptFile.filePath);
    }

    args.push(`Task: ${options.task}`);

    const result: SingleResult = {
      ...emptyResult(agent.name, options.task),
      agentSource: agent.source,
      exitCode: 0,
      step: options.step,
      model: agent.model,
      configuredModel: agent.model,
      configuredTools: agent.tools,
      maxTurns: guardrailBudget.maxTurns,
      maxRuntimeSeconds: guardrailBudget.maxRuntimeSeconds,
    };

    let observedToolExecutionEvents = false;

    const updateProgress = () => {
      result.lastUpdateAtMs = Date.now();
      result.elapsedMs = Math.max(0, result.lastUpdateAtMs - result.startedAtMs);
      options.onUpdate?.(result);
    };

    updateProgress();

    const delegated = await runDelegatedCommand({
      label: `subagent:${agent.name}:${Date.now()}`,
      args,
      cwd: options.cwd ?? options.defaultCwd,
      env: withDelegationCaller(process.env, "subagent"),
      signal: options.signal,
      runtimeLimitSeconds: guardrailBudget.maxRuntimeSeconds,
      tickIntervalMs: 1_000,
      onTick: updateProgress,
      watchdogs: guardrailBudget.maxTurns
        ? [
            {
              intervalMs: 500,
              origin: "budget",
              evaluate: () =>
                result.usage.turns >= (guardrailBudget.maxTurns ?? 0)
                  ? `turn budget exceeded (${guardrailBudget.maxTurns})`
                  : undefined,
            },
          ]
        : undefined,
      onStdoutLine: (line) => {
        const marker = applySubagentEventLine(line, {
          result,
          observedToolExecutionEvents,
          onObservedToolExecution: () => {
            observedToolExecutionEvents = true;
          },
        });

        if (!marker) {
          return;
        }

        updateProgress();
        const runnerMarker: DelegatedRunnerProgressMarker = {
          ...marker,
          fingerprint: buildSubagentProgressFingerprint(result),
        };

        return { marker: runnerMarker };
      },
      onStderr: (text) => {
        result.stderr += text;
        const trimmed = text.trim();
        if (trimmed) {
          result.lastAction = `stderr: ${trimmed.split("\n").at(-1)?.slice(0, 120) ?? trimmed.slice(0, 120)}`;
          updateProgress();
        }
      },
    });

    result.exitCode = delegated.exitCode;
    result.lastUpdateAtMs = Date.now();
    result.elapsedMs = Math.max(0, result.lastUpdateAtMs - result.startedAtMs);
    result.health = delegated.health;

    if (!result.stderr && delegated.stderr) {
      result.stderr = delegated.stderr;
    }

    if (delegated.aborted) {
      result.stopReason = "aborted";
      if (!result.errorMessage) {
        result.errorMessage = delegated.abortReason ?? "Subagent aborted by parent signal.";
      }
    }

    if (delegated.abortOrigin === "health" && !result.errorMessage) {
      result.errorMessage = "delegated run stalled";
    }

    if (result.exitCode !== 0 && !result.errorMessage) {
      result.errorMessage = firstNonEmptyLine(result.stderr) ?? `exit code ${result.exitCode}`;
    }

    return result;
  } finally {
    if (promptDir) {
      rmSync(promptDir, { recursive: true, force: true });
    }
  }
}

interface SubagentProgressMarker {
  kind: "tool_start" | "tool_end" | "assistant" | "assistant_error" | "other";
  action: string;
  toolName?: string;
}

interface ApplySubagentEventContext {
  result: SingleResult;
  observedToolExecutionEvents: boolean;
  onObservedToolExecution: () => void;
}

function applySubagentEventLine(
  line: string,
  context: ApplySubagentEventContext,
): SubagentProgressMarker | null {
  if (!line.trim()) {
    return null;
  }

  try {
    const event = JSON.parse(line) as {
      type?: string;
      message?: Message;
      toolName?: string;
      args?: unknown;
      isError?: boolean;
    };

    if (event.type === "tool_execution_start" && event.toolName) {
      context.onObservedToolExecution();
      context.result.toolCallCount += 1;

      const argsRecord = isRecord(event.args) ? event.args : undefined;
      context.result.lastAction = summarizeToolCall(event.toolName, argsRecord);

      return {
        kind: "tool_start",
        action: `tool_start:${event.toolName}`,
        toolName: event.toolName,
      };
    }

    if (event.type === "tool_execution_end" && event.toolName) {
      context.result.lastAction = event.isError
        ? `tool: ${event.toolName} (error)`
        : `tool: ${event.toolName} done`;

      return {
        kind: "tool_end",
        action: `tool_end:${event.toolName}`,
        toolName: event.toolName,
      };
    }

    if (event.type !== "message_end" || !event.message) {
      return {
        kind: "other",
        action: `event:${String(event.type ?? "unknown")}`,
      };
    }

    const message = event.message;
    context.result.messages.push(message);

    if (message.role !== "assistant") {
      return {
        kind: "other",
        action: `message:${message.role}`,
      };
    }

    context.result.stopReason = message.stopReason;
    context.result.errorMessage = message.errorMessage ||
      context.result.errorMessage ||
      (message.stopReason === "error" || message.stopReason === "aborted"
        ? `assistant ${message.stopReason}`
        : undefined);

    if (!context.result.model && message.model) {
      context.result.model = message.model;
    }

    if (!context.observedToolExecutionEvents) {
      const toolCallsInMessage = message.content.filter((part) => part.type === "toolCall").length;
      if (toolCallsInMessage > 0) {
        context.result.toolCallCount += toolCallsInMessage;
      }
    }

    const assistantSummary = summarizeAssistantMessage(message);
    if (assistantSummary) {
      context.result.lastAction = assistantSummary;
    }

    if (message.usage) {
      context.result.usage.turns += 1;
      context.result.usage.input += message.usage.input ?? 0;
      context.result.usage.output += message.usage.output ?? 0;
      context.result.usage.cacheRead += message.usage.cacheRead ?? 0;
      context.result.usage.cacheWrite += message.usage.cacheWrite ?? 0;
      context.result.usage.cost += message.usage.cost?.total ?? 0;
      context.result.usage.contextTokens = message.usage.totalTokens ?? context.result.usage.contextTokens;
    }

    return message.stopReason === "error" || message.stopReason === "aborted"
      ? { kind: "assistant_error", action: `assistant:${message.stopReason}` }
      : { kind: "assistant", action: "assistant:message" };
  } catch {
    return {
      kind: "other",
      action: "event:malformed_json",
    };
  }
}

function buildSubagentProgressFingerprint(result: SingleResult): string {
  return [
    result.usage.turns,
    result.toolCallCount,
    result.usage.input,
    result.usage.output,
    result.messages.length,
    result.errorMessage ?? "",
  ].join("|");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizeAssistantMessage(message: Message): string | undefined {
  for (const part of message.content) {
    if (part.type === "toolCall") {
      return summarizeToolCall(part.name, part.arguments as Record<string, unknown> | undefined);
    }
  }

  for (const part of message.content) {
    if (part.type === "text") {
      const text = part.text.trim();
      if (text) {
        return `text: ${text.split("\n")[0].slice(0, 120)}`;
      }
    }
  }

  return undefined;
}

function summarizeToolCall(name: string, args?: Record<string, unknown>): string {
  const value = args ?? {};
  if (name === "read") {
    const path = String(value.path ?? value.file_path ?? "(path?)");
    const offset = value.offset;
    const limit = value.limit;
    const range = offset || limit ? `:${offset ?? 1}${limit ? `+${limit}` : ""}` : "";
    return `tool: read ${truncate(path, 90)}${range}`;
  }
  if (name === "bash") {
    return `tool: bash ${truncate(String(value.command ?? ""), 90)}`;
  }
  if (name === "grep") {
    return `tool: grep /${truncate(String(value.pattern ?? ""), 50)}/`;
  }
  if (name === "find") {
    return `tool: find ${truncate(String(value.path ?? "."), 70)}`;
  }
  if (name === "ls") {
    return `tool: ls ${truncate(String(value.path ?? "."), 70)}`;
  }
  if (name === "edit") {
    return `tool: edit ${truncate(String(value.path ?? value.file_path ?? ""), 90)}`;
  }
  if (name === "write") {
    return `tool: write ${truncate(String(value.path ?? value.file_path ?? ""), 90)}`;
  }

  return `tool: ${name}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function createTempPromptFile(agentName: string, systemPrompt: string): { dir: string; filePath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "pi-subagent-"));
  const safeName = agentName.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const filePath = path.join(dir, `${safeName}.md`);
  writeFileSync(filePath, systemPrompt, { encoding: "utf8", mode: 0o600 });
  return { dir, filePath };
}

function getFinalOutput(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") {
      continue;
    }

    for (const part of message.content) {
      if (part.type === "text" && part.text.trim()) {
        return part.text.trim();
      }
    }
  }

  return "";
}

async function mapWithConcurrencyLimit<T, TResult>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<TResult>
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

function firstNonEmptyLine(text: string): string | null {
  const line = text
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return line ?? null;
}

function formatUsage(usage: UsageStats, model?: string): string {
  const parts: string[] = [];
  if (usage.turns > 0) {
    parts.push(`${usage.turns} turn${usage.turns === 1 ? "" : "s"}`);
  }
  if (usage.input > 0) {
    parts.push(`↑${formatTokens(usage.input)}`);
  }
  if (usage.output > 0) {
    parts.push(`↓${formatTokens(usage.output)}`);
  }
  if (usage.cacheRead > 0) {
    parts.push(`R${formatTokens(usage.cacheRead)}`);
  }
  if (usage.cacheWrite > 0) {
    parts.push(`W${formatTokens(usage.cacheWrite)}`);
  }
  if (usage.cost > 0) {
    parts.push(`$${usage.cost.toFixed(4)}`);
  }
  if (usage.contextTokens > 0) {
    parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
  }
  if (model) {
    parts.push(model);
  }

  return parts.join(" ") || "usage: none";
}

function formatTokens(value: number): string {
  if (value < 1_000) {
    return String(value);
  }
  if (value < 10_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  if (value < 1_000_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return `${(value / 1_000_000).toFixed(1)}M`;
}
