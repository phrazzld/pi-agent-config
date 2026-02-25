import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { appendPrGovernanceEvent } from "../shared/pr-governance-log";
import {
  classifyReviewSeverity,
  isActionableReviewFinding,
  isBotAuthor,
  isHardBlockingFinding,
} from "../shared/reviewer-policy";
import type { ReviewSeverity } from "../shared/reviewer-policy";
import {
  buildRepoMemoryKey,
  normalizeMemoryScope,
  parseMemoryScopeFromArgs,
  parseRepoSlugFromRemote,
  resolveCollectionTemplate,
  sanitizeCollectionName,
  selectAndRankMemoryResults,
  stripMemoryScopeFlag,
  type ConcreteMemoryScope,
  type MemoryScope,
} from "./memory-utils";

type MemoryMode = "keyword" | "semantic" | "hybrid";

interface IngestOptions {
  sessionLimit: number;
  localSessionLimit: number;
  includeLogs: boolean;
  embed: boolean;
  force: boolean;
  scope: MemoryScope;
}

interface ScopeIngestSummary {
  scope: ConcreteMemoryScope;
  corpusDir: string;
  collection: string;
  sessionFilesWritten: number;
  logFilesWritten: number;
  skippedSessions: number;
  markerPath: string;
  staleBeforeIngest: boolean;
}

interface IngestSummary {
  scope: MemoryScope;
  repoRoot: string;
  repoMemoryKey: string;
  scopes: ScopeIngestSummary[];
  collections: string[];
  corpusDirs: string[];
  markerPaths: string[];
  sessionFilesWritten: number;
  logFilesWritten: number;
  skippedSessions: number;
  indexed: boolean;
  embedded: boolean;

  // Back-compat convenience fields (first selected scope)
  corpusDir: string;
  collection: string;
  markerPath: string;
}

interface MemoryRepoContext {
  repoRoot: string;
  repoSlug: string;
  repoMemoryKey: string;
  globalCollection: string;
  localCollection: string;
  globalCorpusDir: string;
  localCorpusDir: string;
  globalMarkerPath: string;
  localMarkerPath: string;
}

interface MemoryScopeConfig {
  scope: ConcreteMemoryScope;
  collection: string;
  corpusDir: string;
  markerPath: string;
}

interface MemorySearchResult {
  scope: ConcreteMemoryScope;
  collection: string;
  docid: string;
  score: number;
  adjustedScore: number;
  file: string;
  title: string;
  context: string;
  snippet: string;
}

interface MemorySearchSummary {
  query: string;
  mode: MemoryMode;
  scope: MemoryScope;
  limit: number;
  searchedAt: string;
  repoRoot: string;
  repoMemoryKey: string;
  collections: string[];
  warnings: string[];
  results: MemorySearchResult[];
}

interface SquashMergeOptions {
  prNumber: number;
  reflectionFocus: string;
  allowUnresolvedNits: boolean;
  allowQualityGateChanges: boolean;
  allowCriticalBotFindings: boolean;
  keepBranch: boolean;
}

interface ParsedSquashMergeArgs {
  prNumber: number | null;
  reflectionFocus: string;
  allowUnresolvedNits: boolean;
  allowQualityGateChanges: boolean;
  allowCriticalBotFindings: boolean;
  keepBranch: boolean;
}

interface PullRequestMeta {
  number: number;
  state: string;
  isDraft: boolean;
  mergeStateStatus: string;
  reviewDecision: string | null;
  title: string;
  url: string;
}

interface PrCheck {
  name: string;
  state: string;
  bucket?: string;
  link?: string;
}

interface PrFile {
  filename: string;
  patch?: string;
}

interface RepoIdentity {
  owner: string;
  name: string;
}

interface ReviewThread {
  isResolved: boolean;
  path?: string;
  comments?: {
    nodes?: Array<{
      body?: string;
      author?: {
        login?: string;
      };
    }>;
  };
}

interface ReviewThreadsResponse {
  data?: {
    repository?: {
      pullRequest?: {
        reviewThreads?: {
          nodes?: ReviewThread[];
          pageInfo?: {
            hasNextPage?: boolean;
          };
        };
      };
    };
  };
}

interface GitHubComment {
  id: number;
  body?: string;
  html_url?: string;
  user?: {
    login?: string;
    type?: string;
  };
}

interface GitHubReviewSummary {
  id: number;
  state?: string;
  body?: string;
  html_url?: string;
  user?: {
    login?: string;
    type?: string;
  };
}

interface BotReviewFinding {
  id: number;
  source: "issue_comment" | "review_comment";
  author: string;
  severity: ReviewSeverity;
  actionable: boolean;
  url: string;
  summary: string;
}

interface RespondDigestFinding {
  id: number;
  source: "issue_comment" | "review_comment" | "review_summary";
  author: string;
  authorType: "bot" | "human";
  severity: ReviewSeverity;
  actionable: boolean;
  summary: string;
  url: string;
}

interface PrReadinessReport {
  meta: PullRequestMeta | null;
  blockers: string[];
  warnings: string[];
  botFindings: BotReviewFinding[];
}

const MEMORY_MODE = StringEnum(["keyword", "semantic", "hybrid"] as const);
const MEMORY_SCOPE = StringEnum(["global", "local", "both"] as const);
const ANSI_CSI_REGEX = new RegExp("\\u001b\\[[0-9;]*[A-Za-z]", "g");
const ANSI_OSC_REGEX = new RegExp("\\u001b\\][^\\u0007]*\\u0007", "g");
const REFLECT_PROMPT_MARKER = /^#\s*REFLECT\b/im;
const RESPOND_PROMPT_MARKER = /^#\s*RESPOND\b/im;
const AUTO_CONTEXT_MESSAGE_TYPE = "organic-workflows:auto-context";
const AUTO_DIGEST_MAX_FINDINGS = 8;
const AUTO_REFLECT_TOP_TOOL_LIMIT = 8;
const AUTO_RESPOND_BODY_LIMIT = 8_000;

export default function organicWorkflowsExtension(pi: ExtensionAPI): void {
  pi.registerCommand("squash-merge", {
    description: "Squash-merge current-branch PR (or explicit PR number) after strict readiness checks, then auto-run /reflect",
    handler: async (args, ctx) => {
      const parsed = parseSquashMergeArgs(args);
      const cwd = ctx.cwd;

      const prNumber = parsed.prNumber ?? (await detectCurrentBranchPrNumber(pi, cwd));
      if (!prNumber) {
        ctx.ui.notify(
          "Unable to infer a pull request for the current branch. Usage: /squash-merge [pr-number] [reflection focus] [--allow-unresolved-nits] [--allow-quality-gate-changes] [--allow-critical-bot-findings] [--keep-branch]",
          "warning"
        );
        return;
      }

      const options: SquashMergeOptions = {
        prNumber,
        reflectionFocus: parsed.reflectionFocus,
        allowUnresolvedNits: parsed.allowUnresolvedNits,
        allowQualityGateChanges: parsed.allowQualityGateChanges,
        allowCriticalBotFindings: parsed.allowCriticalBotFindings,
        keepBranch: parsed.keepBranch,
      };
      const { reflectionFocus } = options;

      const dirty = await pi.exec("git", ["status", "--porcelain"], { cwd });
      if (dirty.stdout.trim().length > 0) {
        ctx.ui.notify(
          "Blocked: working directory is not clean. Commit/stash first, then run /squash-merge.",
          "warning"
        );
        return;
      }

      const readiness = await assessPrReadiness(pi, ctx, options);
      if (!readiness.meta) {
        await appendPrGovernanceEvent({
          ts: Date.now(),
          kind: "review_gate",
          status: "error",
          prNumber,
          details: {
            blockers: ["failed-to-load-pr-metadata"],
          },
        });
        ctx.ui.notify(`Failed to load PR #${prNumber}.`, "error");
        return;
      }

      await appendPrGovernanceEvent({
        ts: Date.now(),
        kind: "review_gate",
        status:
          readiness.blockers.length > 0
            ? "block"
            : readiness.warnings.length > 0
              ? "warn"
              : "pass",
        repo: repoFromPullRequestUrl(readiness.meta.url),
        prNumber,
        details: {
          blockers: readiness.blockers,
          warnings: readiness.warnings,
          botFindings: readiness.botFindings.map((finding) => ({
            severity: finding.severity,
            actionable: finding.actionable,
            source: finding.source,
            url: finding.url,
          })),
        },
      });

      if (readiness.blockers.length > 0) {
        ctx.ui.notify(
          `Blocked: PR #${prNumber} is not ready:\n- ${readiness.blockers.join("\n- ")}`,
          "warning"
        );
        return;
      }

      if (readiness.warnings.length > 0) {
        if (!ctx.hasUI) {
          ctx.ui.notify(
            `Blocked (non-interactive): readiness warnings require confirmation:\n- ${readiness.warnings.join("\n- ")}`,
            "warning"
          );
          return;
        }

        const proceed = await ctx.ui.confirm(
          "Merge readiness warnings",
          [
            `PR #${prNumber} has warnings:`,
            ...readiness.warnings.map((w) => `- ${w}`),
            "",
            "Merge anyway?",
          ].join("\n")
        );
        if (!proceed) {
          ctx.ui.notify("Merge canceled due to readiness warnings.", "info");
          return;
        }
      }

      ctx.ui.setStatus("organic-workflows", `Squash-merging PR #${prNumber}...`);

      const mergeArgs = ["pr", "merge", String(prNumber), "--squash"];
      if (!options.keepBranch) {
        mergeArgs.push("--delete-branch");
      }

      const merge = await pi.exec("gh", mergeArgs, {
        cwd,
        timeout: 180_000,
      });

      if (merge.code !== 0) {
        ctx.ui.setStatus("organic-workflows", "");
        const summary = firstNonEmptyLine(merge.stderr) ?? firstNonEmptyLine(merge.stdout);
        ctx.ui.notify(`Merge failed${summary ? ` (${summary})` : ""}.`, "error");
        return;
      }

      const defaultBranch = await detectDefaultBranch(pi, cwd);

      const checkout = await pi.exec("git", ["checkout", defaultBranch], { cwd, timeout: 60_000 });
      if (checkout.code !== 0) {
        ctx.ui.setStatus("organic-workflows", "");
        const summary = firstNonEmptyLine(checkout.stderr) ?? firstNonEmptyLine(checkout.stdout);
        ctx.ui.notify(
          `Post-merge sync failed during git checkout ${defaultBranch}${summary ? ` (${summary})` : ""}.`,
          "error"
        );
        return;
      }

      const pull = await pi.exec("git", ["pull", "--ff-only"], { cwd, timeout: 120_000 });
      if (pull.code !== 0) {
        ctx.ui.setStatus("organic-workflows", "");
        const summary = firstNonEmptyLine(pull.stderr) ?? firstNonEmptyLine(pull.stdout);
        ctx.ui.notify(`Post-merge sync failed during git pull${summary ? ` (${summary})` : ""}.`, "error");
        return;
      }

      ctx.ui.setStatus("organic-workflows", "");

      const reflectMessage = reflectionFocus
        ? `/reflect post-merge PR #${prNumber} ${reflectionFocus}`
        : `/reflect post-merge PR #${prNumber}`;

      pi.sendUserMessage(reflectMessage);
      ctx.ui.notify(
        `Merged PR #${prNumber} and triggered ${reflectMessage}`,
        "success"
      );
    },
  });

  pi.registerTool({
    name: "memory_ingest",
    label: "Memory Ingest",
    description:
      "Build/update local-first memory corpora (repo-local + global) from Pi sessions/logs and index with QMD.",
    parameters: Type.Object({
      sessionLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
      localSessionLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
      includeLogs: Type.Optional(Type.Boolean()),
      embed: Type.Optional(Type.Boolean()),
      force: Type.Optional(Type.Boolean()),
      scope: Type.Optional(MEMORY_SCOPE),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const summary = await ingestMemory(pi, ctx, {
        sessionLimit: params.sessionLimit ?? getDefaultSessionLimit(),
        localSessionLimit: params.localSessionLimit ?? getDefaultLocalSessionLimit(),
        includeLogs: params.includeLogs ?? true,
        embed: params.embed ?? false,
        force: params.force ?? false,
        scope: normalizeMemoryScope(params.scope),
      });

      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        details: summary,
      };
    },
  });

  pi.registerTool({
    name: "memory_search",
    label: "Memory Search",
    description:
      "Search local-first Pi memory via QMD with repo-local prioritization and global fallback.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      mode: Type.Optional(MEMORY_MODE),
      scope: Type.Optional(MEMORY_SCOPE),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 25 })),
      autoIngest: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const mode = (params.mode ?? "hybrid") as MemoryMode;
      const scope = normalizeMemoryScope(params.scope);
      const limit = clamp(params.limit ?? 8, 1, 25);
      const autoIngest = params.autoIngest ?? true;

      if (autoIngest) {
        const stale = await isMemoryStale(pi, ctx.cwd, scope);
        if (stale) {
          ctx.ui.setStatus("organic-workflows", "Auto-ingesting stale memory...");
          try {
            await ingestMemory(pi, ctx, {
              sessionLimit: getDefaultSessionLimit(),
              localSessionLimit: getDefaultLocalSessionLimit(),
              includeLogs: true,
              embed: false,
              force: false,
              scope,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.ui.notify(
              `Auto-ingest failed (${message}). Continuing with existing memory corpus.`,
              "warning"
            );
          } finally {
            ctx.ui.setStatus("organic-workflows", "");
          }
        }
      }

      const summary = await runMemorySearch(pi, ctx, params.query, mode, scope, limit);
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        details: summary,
      };
    },
  });

  pi.registerTool({
    name: "memory_context",
    label: "Memory Context",
    description:
      "Build a compact local-first context pack (local prioritized, global fallback) for immediate use in the active run.",
    parameters: Type.Object({
      query: Type.String({ description: "Context query" }),
      mode: Type.Optional(MEMORY_MODE),
      scope: Type.Optional(MEMORY_SCOPE),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      maxChars: Type.Optional(Type.Integer({ minimum: 500, maximum: 20_000 })),
      autoIngest: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const mode = (params.mode ?? "hybrid") as MemoryMode;
      const scope = normalizeMemoryScope(params.scope);
      const limit = clamp(params.limit ?? 6, 1, 20);
      const maxChars = clamp(params.maxChars ?? 4_000, 500, 20_000);
      const autoIngest = params.autoIngest ?? true;

      if (autoIngest) {
        const stale = await isMemoryStale(pi, ctx.cwd, scope);
        if (stale) {
          ctx.ui.setStatus("organic-workflows", "Auto-ingesting stale memory...");
          try {
            await ingestMemory(pi, ctx, {
              sessionLimit: getDefaultSessionLimit(),
              localSessionLimit: getDefaultLocalSessionLimit(),
              includeLogs: true,
              embed: false,
              force: false,
              scope,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.ui.notify(
              `Auto-ingest failed (${message}). Continuing with existing memory corpus.`,
              "warning"
            );
          } finally {
            ctx.ui.setStatus("organic-workflows", "");
          }
        }
      }

      const summary = await runMemorySearch(pi, ctx, params.query, mode, scope, limit);
      const pack = formatMemoryContextPack(summary, maxChars);

      return {
        content: [{ type: "text", text: pack }],
        details: summary,
      };
    },
  });

  pi.registerCommand("memory-ingest", {
    description: "Build/update local-first memory corpora and index with QMD",
    handler: async (args, ctx) => {
      const scope = parseMemoryScopeFromArgs(args, "both");
      const embed = args.includes("--embed");
      const force = args.includes("--force");
      const summary = await ingestMemory(pi, ctx, {
        sessionLimit: getDefaultSessionLimit(),
        localSessionLimit: getDefaultLocalSessionLimit(),
        includeLogs: true,
        embed,
        force,
        scope,
      });
      ctx.ui.notify(
        `Memory ingest (${scope}) complete: ${summary.sessionFilesWritten} sessions, ${summary.logFilesWritten} logs, collections=${summary.collections.join(", ")}`,
        "success"
      );
    },
  });

  pi.registerCommand("memory-search", {
    description: "Run local-first memory search via QMD",
    handler: async (args, ctx) => {
      const scope = parseMemoryScopeFromArgs(args, "both");
      const query = stripMemoryScopeFlag(args).trim();
      if (!query) {
        ctx.ui.notify("Usage: /memory-search <query> [--scope local|global|both]", "warning");
        return;
      }

      const message = [
        `Use the memory_search tool now with query \"${query}\", mode \"hybrid\", and scope \"${scope}\".`,
        "Prefer local findings, then use global findings as fallback.",
        "Summarize key findings with source paths and confidence caveats.",
      ].join(" ");

      if (ctx.isIdle()) {
        pi.sendUserMessage(message);
      } else {
        pi.sendUserMessage(message, { deliverAs: "followUp" });
      }
    },
  });

  pi.registerCommand("memory-context", {
    description: "Inject a compact local-first memory context pack into the active run",
    handler: async (args, ctx) => {
      const scope = parseMemoryScopeFromArgs(args, "both");
      const query = stripMemoryScopeFlag(args).trim();
      if (!query) {
        ctx.ui.notify("Usage: /memory-context <query> [--scope local|global|both]", "warning");
        return;
      }

      const message = [
        `Use the memory_context tool now with query \"${query}\", mode \"hybrid\", and scope \"${scope}\".`,
        "Return a concise context pack with source references.",
      ].join(" ");

      if (ctx.isIdle()) {
        pi.sendUserMessage(message);
      } else {
        pi.sendUserMessage(message, { deliverAs: "followUp" });
      }
    },
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const prompt = typeof event.prompt === "string" ? event.prompt : "";
    const autoContextBlocks: string[] = [];

    if (isReflectWorkflowPrompt(prompt)) {
      try {
        const reflectContext = await buildAutoReflectContextBlock(pi, ctx);
        if (reflectContext) {
          autoContextBlocks.push(reflectContext);
        }
      } catch (error) {
        autoContextBlocks.push(
          [
            "## Auto Reflect Context",
            `- status: failed to build (${toErrorMessage(error)})`,
            "- fallback: proceed with manual session/log replay",
          ].join("\n")
        );
      }
    }

    if (isRespondWorkflowPrompt(prompt)) {
      try {
        const respondDigest = await buildAutoRespondDigestBlock(pi, ctx);
        if (respondDigest) {
          autoContextBlocks.push(respondDigest);
        }
      } catch (error) {
        autoContextBlocks.push(
          [
            "## Auto PR Feedback Digest",
            `- status: failed to build (${toErrorMessage(error)})`,
            "- fallback: fetch pulls/comments/reviews manually via gh api",
          ].join("\n")
        );
      }
    }

    if (autoContextBlocks.length === 0) {
      return undefined;
    }

    return {
      message: {
        customType: AUTO_CONTEXT_MESSAGE_TYPE,
        content: autoContextBlocks.join("\n\n---\n\n"),
        display: true,
        details: {
          generatedAt: new Date().toISOString(),
          contexts: autoContextBlocks.length,
        },
      },
    };
  });
}

function isReflectWorkflowPrompt(prompt: string): boolean {
  return REFLECT_PROMPT_MARKER.test(prompt || "");
}

function isRespondWorkflowPrompt(prompt: string): boolean {
  return RESPOND_PROMPT_MARKER.test(prompt || "");
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error === undefined || error === null) {
    return "unknown error";
  }
  return String(error);
}

async function buildAutoReflectContextBlock(pi: ExtensionAPI, ctx: ExtensionContext): Promise<string> {
  const branchStats = collectSessionBranchStats(ctx);
  const availableTools = new Set(pi.getAllTools().map((tool) => tool.name));
  const activeTools = new Set(pi.getActiveTools().map((tool) => String(tool)));

  const subagentStatus = describeToolStatus("subagent", availableTools, activeTools);
  const teamRunStatus = describeToolStatus("team_run", availableTools, activeTools);
  const pipelineRunStatus = describeToolStatus("pipeline_run", availableTools, activeTools);
  const memoryContextStatus = describeToolStatus("memory_context", availableTools, activeTools);

  const primitiveSummary = await readPrimitiveUsageSummary();
  const memoryStale = await isMemoryStale(pi, ctx.cwd, "both").catch(() => null);

  const lines: string[] = [
    "## Auto Reflect Context",
    `- generatedAt: ${new Date().toISOString()}`,
    `- subagent: ${subagentStatus}`,
    `- team_run: ${teamRunStatus}`,
    `- pipeline_run: ${pipelineRunStatus}`,
    `- memory_context: ${memoryContextStatus}`,
    memoryStale === null ? "- memoryFreshness(scope=both): unknown" : `- memoryFreshness(scope=both): ${memoryStale ? "stale" : "fresh"}`,
    "",
    "### Session branch snapshot",
    `- entries: ${branchStats.entries}`,
    `- user messages: ${branchStats.userMessages}`,
    `- assistant messages: ${branchStats.assistantMessages}`,
    `- tool results: ${branchStats.toolResults}`,
    `- tool calls: ${branchStats.toolCalls}`,
    `- top tools: ${branchStats.topTools || "none"}`,
  ];

  if (branchStats.latestCompaction) {
    lines.push(
      `- latest compaction: tokensBefore=${branchStats.latestCompaction.tokensBefore}, readFiles=${branchStats.latestCompaction.readFiles}, modifiedFiles=${branchStats.latestCompaction.modifiedFiles}`
    );
  }

  if (primitiveSummary) {
    lines.push(
      "",
      "### Recent primitive telemetry",
      `- sampled runs: ${primitiveSummary.runCount}`,
      `- avg duration: ${primitiveSummary.avgDurationSeconds}s`,
      `- top run tools: ${primitiveSummary.topRunTools || "none"}`,
      `- top run skills: ${primitiveSummary.topRunSkills || "none"}`,
    );
  }

  lines.push(
    "",
    "### Guidance",
    subagentStatus === "enabled"
      ? "- Subagents are available: prefer parallel lane delegation when work is naturally partitionable."
      : "- Subagents are not currently enabled: note the limitation and proceed sequentially.",
    "- Keep recommendations small/reversible and tied to observed repetition.",
  );

  return lines.join("\n");
}

function collectSessionBranchStats(ctx: ExtensionContext): {
  entries: number;
  userMessages: number;
  assistantMessages: number;
  toolResults: number;
  toolCalls: number;
  topTools: string;
  latestCompaction: { tokensBefore: number; readFiles: number; modifiedFiles: number } | null;
} {
  const branch = ctx.sessionManager.getBranch();
  let userMessages = 0;
  let assistantMessages = 0;
  let toolResults = 0;
  let toolCalls = 0;
  const toolCount = new Map<string, number>();
  let latestCompaction: { tokensBefore: number; readFiles: number; modifiedFiles: number } | null = null;

  for (const entry of branch) {
    if (entry.type === "message") {
      const message = entry.message as any;
      const role = String(message?.role ?? "");
      if (role === "user") {
        userMessages += 1;
      } else if (role === "assistant") {
        assistantMessages += 1;
        const content = Array.isArray(message?.content) ? message.content : [];
        for (const part of content) {
          if (part?.type !== "toolCall") {
            continue;
          }
          toolCalls += 1;
          const toolName = String(part?.name ?? "unknown");
          toolCount.set(toolName, (toolCount.get(toolName) ?? 0) + 1);
        }
      } else if (role === "toolResult") {
        toolResults += 1;
      }
      continue;
    }

    if (entry.type === "compaction") {
      const details = (entry.details ?? {}) as {
        readFiles?: unknown;
        modifiedFiles?: unknown;
      };

      latestCompaction = {
        tokensBefore: Number(entry.tokensBefore ?? 0),
        readFiles: Array.isArray(details.readFiles) ? details.readFiles.length : 0,
        modifiedFiles: Array.isArray(details.modifiedFiles) ? details.modifiedFiles.length : 0,
      };
    }
  }

  const topTools = Array.from(toolCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, AUTO_REFLECT_TOP_TOOL_LIMIT)
    .map(([tool, count]) => `${tool}:${count}`)
    .join(", ");

  return {
    entries: branch.length,
    userMessages,
    assistantMessages,
    toolResults,
    toolCalls,
    topTools,
    latestCompaction,
  };
}

function describeToolStatus(
  toolName: string,
  availableTools: ReadonlySet<string>,
  activeTools: ReadonlySet<string>,
): string {
  if (!availableTools.has(toolName)) {
    return "missing";
  }
  if (activeTools.has(toolName)) {
    return "enabled";
  }
  return "available-but-inactive";
}

async function readPrimitiveUsageSummary(): Promise<{
  runCount: number;
  avgDurationSeconds: number;
  topRunTools: string;
  topRunSkills: string;
} | null> {
  const logPath = path.join(getConfigDir(), "logs", "primitive-usage.ndjson");
  if (!existsSync(logPath)) {
    return null;
  }

  const raw = await fs.readFile(logPath, "utf8").catch(() => "");
  if (!raw.trim()) {
    return null;
  }

  const parsed = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as {
          durationMs?: number;
          runTools?: Record<string, number>;
          runSkills?: string[];
        };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { durationMs?: number; runTools?: Record<string, number>; runSkills?: string[] } =>
      Boolean(entry)
    );

  if (parsed.length === 0) {
    return null;
  }

  const recent = parsed.slice(-20);
  const toolCounts = new Map<string, number>();
  const skillCounts = new Map<string, number>();
  let durationTotal = 0;
  let durationCount = 0;

  for (const entry of recent) {
    const duration = Number(entry.durationMs ?? NaN);
    if (Number.isFinite(duration) && duration >= 0) {
      durationTotal += duration;
      durationCount += 1;
    }

    for (const [tool, count] of Object.entries(entry.runTools ?? {})) {
      const numeric = Number(count ?? 0);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        continue;
      }
      toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + numeric);
    }

    for (const skill of entry.runSkills ?? []) {
      const key = String(skill);
      if (!key) {
        continue;
      }
      skillCounts.set(key, (skillCounts.get(key) ?? 0) + 1);
    }
  }

  const avgDurationSeconds =
    durationCount === 0 ? 0 : Number((durationTotal / durationCount / 1000).toFixed(1));

  return {
    runCount: recent.length,
    avgDurationSeconds,
    topRunTools: formatTopCounter(toolCounts, 6),
    topRunSkills: formatTopCounter(skillCounts, 6),
  };
}

function formatTopCounter(counter: Map<string, number>, limit: number): string {
  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, value]) => `${key}:${value}`)
    .join(", ");
}

async function buildAutoRespondDigestBlock(pi: ExtensionAPI, ctx: ExtensionContext): Promise<string> {
  const prNumber = await detectCurrentBranchPrNumber(pi, ctx.cwd);
  if (!prNumber) {
    return [
      "## Auto PR Feedback Digest",
      "- status: no pull request detected for current branch",
      "- action: resolve PR context first (`gh pr status`) before triage",
    ].join("\n");
  }

  const repo = await getRepoIdentity(pi, ctx.cwd);
  if (!repo) {
    return [
      "## Auto PR Feedback Digest",
      `- PR: #${prNumber}`,
      "- status: could not resolve repository owner/name",
    ].join("\n");
  }

  const [meta, issueCommentsRaw, reviewCommentsRaw, reviewSummariesRaw] = await Promise.all([
    ghJson<PullRequestMeta>(pi, ctx.cwd, [
      "pr",
      "view",
      String(prNumber),
      "--json",
      "number,title,url,state,isDraft,mergeStateStatus,reviewDecision",
    ]),
    ghJson<GitHubComment[]>(pi, ctx.cwd, [
      "api",
      `repos/${repo.owner}/${repo.name}/issues/${prNumber}/comments?per_page=100`,
    ]),
    ghJson<GitHubComment[]>(pi, ctx.cwd, [
      "api",
      `repos/${repo.owner}/${repo.name}/pulls/${prNumber}/comments?per_page=100`,
    ]),
    ghJson<GitHubReviewSummary[]>(pi, ctx.cwd, [
      "api",
      `repos/${repo.owner}/${repo.name}/pulls/${prNumber}/reviews?per_page=100`,
    ]),
  ]);

  const warnings: string[] = [];
  if (!issueCommentsRaw) warnings.push("issues comments fetch failed");
  if (!reviewCommentsRaw) warnings.push("inline review comments fetch failed");
  if (!reviewSummariesRaw) warnings.push("review summaries fetch failed");

  const issueComments = issueCommentsRaw ?? [];
  const reviewComments = reviewCommentsRaw ?? [];
  const reviewSummaries = reviewSummariesRaw ?? [];

  const findings = collectRespondDigestFindings(issueComments, reviewComments, reviewSummaries);
  const actionable = findings.filter((finding) => finding.actionable && finding.severity !== "none");
  const hardBlockers = actionable.filter((finding) =>
    isHardBlockingFinding(finding.authorType, finding.severity, true)
  );

  const severityCounts = {
    critical: actionable.filter((finding) => finding.severity === "critical").length,
    high: actionable.filter((finding) => finding.severity === "high").length,
    medium: actionable.filter((finding) => finding.severity === "medium").length,
    low: actionable.filter((finding) => finding.severity === "low").length,
  };

  const reviewStateCounts = new Map<string, number>();
  for (const review of reviewSummaries) {
    const state = String(review.state ?? "UNKNOWN").toUpperCase();
    reviewStateCounts.set(state, (reviewStateCounts.get(state) ?? 0) + 1);
  }

  const topActionable = actionable
    .sort((left, right) => {
      const severityDelta = severityWeight(right.severity) - severityWeight(left.severity);
      if (severityDelta !== 0) {
        return severityDelta;
      }
      if (left.authorType !== right.authorType) {
        return left.authorType === "human" ? -1 : 1;
      }
      return left.id - right.id;
    })
    .slice(0, AUTO_DIGEST_MAX_FINDINGS);

  const lines: string[] = [
    "## Auto PR Feedback Digest",
    `- PR: #${prNumber}${meta?.title ? ` ${meta.title}` : ""}`,
    meta?.url ? `- URL: ${meta.url}` : "",
    `- source counts: issue_comments=${issueComments.length}, inline_comments=${reviewComments.length}, review_summaries=${reviewSummaries.length}`,
    `- actionable findings: ${actionable.length} (critical=${severityCounts.critical}, high=${severityCounts.high}, medium=${severityCounts.medium}, low=${severityCounts.low})`,
    `- hard blockers (critical/high actionable): ${hardBlockers.length}`,
    reviewStateCounts.size > 0
      ? `- review states: ${Array.from(reviewStateCounts.entries())
          .map(([state, count]) => `${state}:${count}`)
          .join(", ")}`
      : "",
  ].filter(Boolean);

  if (warnings.length > 0) {
    lines.push(`- warnings: ${warnings.join("; ")}`);
  }

  lines.push("", "### Top actionable findings");

  if (topActionable.length === 0) {
    lines.push("- none detected from fetched comment bodies");
  } else {
    for (const finding of topActionable) {
      const location = finding.url ? ` — ${finding.url}` : "";
      lines.push(
        `- [${finding.severity.toUpperCase()}][${finding.authorType}][${finding.source}] ${finding.summary}${location}`
      );
    }
  }

  lines.push(
    "",
    "### Triage hint",
    "- Address hard blockers first, then medium findings, then low-severity polish.",
    "- Keep responses in the required Classification/Severity/Decision/Change/Verification structure.",
  );

  return lines.join("\n");
}

function collectRespondDigestFindings(
  issueComments: GitHubComment[],
  reviewComments: GitHubComment[],
  reviewSummaries: GitHubReviewSummary[],
): RespondDigestFinding[] {
  const findings: RespondDigestFinding[] = [];
  const seen = new Set<string>();

  const pushFinding = (finding: RespondDigestFinding) => {
    const key = `${finding.source}:${finding.id}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    findings.push(finding);
  };

  for (const comment of issueComments) {
    const body = (comment.body ?? "").slice(0, AUTO_RESPOND_BODY_LIMIT);
    if (!body.trim()) {
      continue;
    }

    pushFinding({
      id: comment.id,
      source: "issue_comment",
      author: comment.user?.login ?? "unknown",
      authorType: toReviewerSource(comment.user?.login, comment.user?.type),
      severity: classifyReviewSeverity(body),
      actionable: isActionableReviewFinding(body),
      summary: summarizeFinding(body),
      url: comment.html_url ?? "",
    });
  }

  for (const comment of reviewComments) {
    const body = (comment.body ?? "").slice(0, AUTO_RESPOND_BODY_LIMIT);
    if (!body.trim()) {
      continue;
    }

    pushFinding({
      id: comment.id,
      source: "review_comment",
      author: comment.user?.login ?? "unknown",
      authorType: toReviewerSource(comment.user?.login, comment.user?.type),
      severity: classifyReviewSeverity(body),
      actionable: isActionableReviewFinding(body),
      summary: summarizeFinding(body),
      url: comment.html_url ?? "",
    });
  }

  for (const review of reviewSummaries) {
    const body = (review.body ?? "").slice(0, AUTO_RESPOND_BODY_LIMIT).trim();
    const state = String(review.state ?? "").toUpperCase();
    const fallbackBody = body || (state === "CHANGES_REQUESTED" ? "Review state: CHANGES_REQUESTED" : "");
    if (!fallbackBody) {
      continue;
    }

    const severity = body
      ? classifyReviewSeverity(fallbackBody)
      : state === "CHANGES_REQUESTED"
        ? "high"
        : "none";
    const actionable = body
      ? isActionableReviewFinding(fallbackBody)
      : state === "CHANGES_REQUESTED";

    pushFinding({
      id: review.id,
      source: "review_summary",
      author: review.user?.login ?? "unknown",
      authorType: toReviewerSource(review.user?.login, review.user?.type),
      severity,
      actionable,
      summary: summarizeFinding(fallbackBody),
      url: review.html_url ?? "",
    });
  }

  return findings;
}

function toReviewerSource(login?: string, type?: string): "bot" | "human" {
  return isBotAuthor(login, type) ? "bot" : "human";
}

function severityWeight(severity: ReviewSeverity): number {
  switch (severity) {
    case "critical":
      return 5;
    case "high":
      return 4;
    case "medium":
      return 3;
    case "low":
      return 2;
    default:
      return 1;
  }
}

async function ingestMemory(pi: ExtensionAPI, ctx: ExtensionContext, options: IngestOptions): Promise<IngestSummary> {
  await ensureQmdAvailable(pi, ctx.cwd);

  const configDir = getConfigDir();
  const sessionsRoot = path.join(configDir, "sessions");
  const logsRoot = path.join(configDir, "logs");
  const repo = await buildMemoryRepoContext(pi, ctx.cwd, configDir);
  const scopeConfigs = resolveMemoryScopeConfigs(options.scope, repo);

  const staleBeforeIngest = new Map<ConcreteMemoryScope, boolean>();
  for (const scopeConfig of scopeConfigs) {
    staleBeforeIngest.set(scopeConfig.scope, await isMemoryScopeStale(scopeConfig.markerPath));
  }

  if (!options.force && scopeConfigs.every((scopeConfig) => !staleBeforeIngest.get(scopeConfig.scope))) {
    return buildSkippedIngestSummary(options.scope, repo, scopeConfigs);
  }

  const sessionFiles = await listFilesRecursive(sessionsRoot, (file) => file.endsWith(".jsonl"));
  sessionFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const logFiles = options.includeLogs && existsSync(logsRoot)
    ? await listFilesRecursive(logsRoot, (file) =>
      file.endsWith(".ndjson") || file.endsWith(".log") || file.endsWith(".txt")
    )
    : [];

  const scopeSummaries: ScopeIngestSummary[] = [];
  for (const scopeConfig of scopeConfigs) {
    const summary = await ingestMemoryScope(pi, ctx.cwd, {
      scopeConfig,
      scope: scopeConfig.scope,
      staleBeforeIngest: staleBeforeIngest.get(scopeConfig.scope) ?? true,
      repo,
      options,
      sessionFiles,
      logFiles,
      logsRoot,
      sessionsRoot,
    });
    scopeSummaries.push(summary);
  }

  const shouldIndex = scopeSummaries.some(
    (summary) => summary.staleBeforeIngest || summary.sessionFilesWritten > 0 || summary.logFilesWritten > 0 || options.force,
  );

  let indexed = false;
  if (shouldIndex) {
    const update = await pi.exec("qmd", ["update"], { cwd: ctx.cwd, timeout: 180_000 });
    if (update.code !== 0) {
      throw new Error(`qmd update failed: ${firstNonEmptyLine(update.stderr) ?? "unknown error"}`);
    }
    indexed = true;
  }

  let embedded = false;
  if (options.embed && indexed) {
    const embed = await pi.exec("qmd", ["embed"], { cwd: ctx.cwd, timeout: 300_000 });
    if (embed.code !== 0) {
      throw new Error(`qmd embed failed: ${firstNonEmptyLine(embed.stderr) ?? "unknown error"}`);
    }
    embedded = true;
  }

  return buildIngestSummary(options.scope, repo, scopeSummaries, indexed, embedded);
}

interface IngestScopeParams {
  scopeConfig: MemoryScopeConfig;
  scope: ConcreteMemoryScope;
  staleBeforeIngest: boolean;
  repo: MemoryRepoContext;
  options: IngestOptions;
  sessionFiles: Array<{ path: string; mtimeMs: number }>;
  logFiles: Array<{ path: string; mtimeMs: number }>;
  sessionsRoot: string;
  logsRoot: string;
}

async function ingestMemoryScope(
  pi: ExtensionAPI,
  cwd: string,
  params: IngestScopeParams,
): Promise<ScopeIngestSummary> {
  const { scopeConfig, scope, staleBeforeIngest, repo, options, sessionFiles, logFiles, sessionsRoot, logsRoot } = params;

  const sessionsOut = path.join(scopeConfig.corpusDir, "sessions");
  const logsOut = path.join(scopeConfig.corpusDir, "logs");

  await fs.mkdir(sessionsOut, { recursive: true });
  await fs.mkdir(logsOut, { recursive: true });

  const expectedSessionFiles = new Set<string>();
  const expectedLogFiles = new Set<string>();

  const maxSessions = scope === "local" ? options.localSessionLimit : options.sessionLimit;
  const selectedSessions = await selectSessionFilesForScope(sessionFiles, scope, repo.repoRoot, maxSessions);

  let sessionFilesWritten = 0;
  let skippedSessions = 0;

  for (const sessionFile of selectedSessions) {
    const transcript = await renderSessionAsMarkdown(sessionFile.path);
    if (!transcript) {
      skippedSessions++;
      continue;
    }

    const fileName = `${sessionFile.path
      .replace(/[:/\\]+/g, "__")
      .replace(/\.+/g, "_")
      .slice(-180)}.md`;

    const outPath = path.join(sessionsOut, fileName);
    await fs.writeFile(outPath, transcript, "utf8");
    expectedSessionFiles.add(fileName);
    sessionFilesWritten++;
  }

  let logFilesWritten = 0;
  const localLogFilter = scope === "local" ? buildLocalLogLineFilter(repo) : undefined;

  for (const logFile of logFiles) {
    const rendered = await renderLogAsMarkdown(logFile.path, {
      lineFilter: localLogFilter,
      maxLines: scope === "local" ? 300 : 500,
      title: scope === "local" ? "Repo-Scoped Log Excerpts" : "Log Excerpts",
    });

    if (!rendered) {
      continue;
    }

    const relative = path.relative(logsRoot, logFile.path) || path.basename(logFile.path);
    const fileName = `${relative.replace(/[:/\\]+/g, "__").replace(/[^a-zA-Z0-9_.-]/g, "_")}.md`;
    const outPath = path.join(logsOut, fileName);
    await fs.writeFile(outPath, rendered, "utf8");
    expectedLogFiles.add(fileName);
    logFilesWritten++;
  }

  await pruneMarkdownFiles(sessionsOut, expectedSessionFiles);
  await pruneMarkdownFiles(logsOut, expectedLogFiles);

  const manifest = [
    "# Pi Memory Corpus",
    "",
    `- Scope: ${scope}`,
    `- Repo root: ${repo.repoRoot}`,
    `- Repo key: ${repo.repoMemoryKey}`,
    `- Generated: ${new Date().toISOString()}`,
    `- Session files: ${sessionFilesWritten}`,
    `- Log files: ${logFilesWritten}`,
    `- Skipped sessions: ${skippedSessions}`,
    `- Source sessions root: ${sessionsRoot}`,
    `- Source logs root: ${logsRoot}`,
    "",
    "This corpus stores raw transcript excerpts plus minimal metadata for local-first retrieval.",
  ].join("\n");
  await fs.writeFile(path.join(scopeConfig.corpusDir, "index.md"), manifest, "utf8");

  const contextLabel = scope === "local"
    ? `Repo-local Pi memory corpus (${repo.repoSlug})`
    : "Global Pi memory corpus";

  await ensureQmdCollection(pi, cwd, scopeConfig.corpusDir, scopeConfig.collection, contextLabel);

  await fs.writeFile(
    scopeConfig.markerPath,
    JSON.stringify(
      {
        ts: Date.now(),
        scope,
        repoRoot: repo.repoRoot,
        repoMemoryKey: repo.repoMemoryKey,
        sessionFilesWritten,
        logFilesWritten,
        skippedSessions,
        collection: scopeConfig.collection,
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    scope,
    corpusDir: scopeConfig.corpusDir,
    collection: scopeConfig.collection,
    sessionFilesWritten,
    logFilesWritten,
    skippedSessions,
    markerPath: scopeConfig.markerPath,
    staleBeforeIngest,
  };
}

function resolveMemoryScopeConfigs(scope: MemoryScope, repo: MemoryRepoContext): MemoryScopeConfig[] {
  const local: MemoryScopeConfig = {
    scope: "local",
    collection: repo.localCollection,
    corpusDir: repo.localCorpusDir,
    markerPath: repo.localMarkerPath,
  };

  const global: MemoryScopeConfig = {
    scope: "global",
    collection: repo.globalCollection,
    corpusDir: repo.globalCorpusDir,
    markerPath: repo.globalMarkerPath,
  };

  if (scope === "local") {
    return [local];
  }
  if (scope === "global") {
    return [global];
  }

  // Local-first order for mixed lookups.
  return [local, global];
}

function buildSkippedIngestSummary(
  scope: MemoryScope,
  repo: MemoryRepoContext,
  scopeConfigs: MemoryScopeConfig[],
): IngestSummary {
  const scopes: ScopeIngestSummary[] = scopeConfigs.map((scopeConfig) => ({
    scope: scopeConfig.scope,
    corpusDir: scopeConfig.corpusDir,
    collection: scopeConfig.collection,
    sessionFilesWritten: 0,
    logFilesWritten: 0,
    skippedSessions: 0,
    markerPath: scopeConfig.markerPath,
    staleBeforeIngest: false,
  }));

  return buildIngestSummary(scope, repo, scopes, false, false);
}

function buildIngestSummary(
  scope: MemoryScope,
  repo: MemoryRepoContext,
  scopes: ScopeIngestSummary[],
  indexed: boolean,
  embedded: boolean,
): IngestSummary {
  const sessionFilesWritten = scopes.reduce((total, entry) => total + entry.sessionFilesWritten, 0);
  const logFilesWritten = scopes.reduce((total, entry) => total + entry.logFilesWritten, 0);
  const skippedSessions = scopes.reduce((total, entry) => total + entry.skippedSessions, 0);

  const collections = scopes.map((entry) => entry.collection);
  const corpusDirs = scopes.map((entry) => entry.corpusDir);
  const markerPaths = scopes.map((entry) => entry.markerPath);

  const first = scopes[0];

  return {
    scope,
    repoRoot: repo.repoRoot,
    repoMemoryKey: repo.repoMemoryKey,
    scopes,
    collections,
    corpusDirs,
    markerPaths,
    sessionFilesWritten,
    logFilesWritten,
    skippedSessions,
    indexed,
    embedded,
    corpusDir: first?.corpusDir ?? repo.globalCorpusDir,
    collection: first?.collection ?? repo.globalCollection,
    markerPath: first?.markerPath ?? repo.globalMarkerPath,
  };
}

async function runMemorySearch(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  query: string,
  mode: MemoryMode,
  scope: MemoryScope,
  limit: number,
): Promise<MemorySearchSummary> {
  await ensureQmdAvailable(pi, ctx.cwd);

  const configDir = getConfigDir();
  const repo = await buildMemoryRepoContext(pi, ctx.cwd, configDir);
  const scopeConfigs = resolveMemoryScopeConfigs(scope, repo);
  const command = mode === "keyword" ? "search" : mode === "semantic" ? "vsearch" : "query";
  const perCollectionLimit = scope === "both" ? Math.max(limit * 2, 10) : limit;
  const warnings: string[] = [];

  const candidates: MemorySearchResult[] = [];

  for (const scopeConfig of scopeConfigs) {
    const queried = await queryMemoryCollection(
      pi,
      ctx.cwd,
      command,
      query,
      perCollectionLimit,
      scopeConfig,
    );

    if (!queried.ok) {
      warnings.push(queried.warning);
      continue;
    }

    candidates.push(...queried.results);
  }

  const results = selectAndRankMemoryResults(candidates, limit, getMemoryLocalPriorityBoost());

  if (results.length === 0 && warnings.length === 0) {
    warnings.push("No memory matches found.");
  }

  return {
    query,
    mode,
    scope,
    limit,
    searchedAt: new Date().toISOString(),
    repoRoot: repo.repoRoot,
    repoMemoryKey: repo.repoMemoryKey,
    collections: scopeConfigs.map((scopeConfig) => scopeConfig.collection),
    warnings,
    results,
  };
}

function formatMemoryContextPack(summary: MemorySearchSummary, maxChars: number): string {
  const lines: string[] = [
    "## Memory Context Pack",
    `- query: ${summary.query}`,
    `- mode: ${summary.mode}`,
    `- scope: ${summary.scope}`,
    `- collections: ${summary.collections.join(", ") || "(none)"}`,
    "",
  ];

  if (summary.results.length === 0) {
    lines.push("No memory results found.");
    if (summary.warnings.length > 0) {
      lines.push("", "Warnings:", ...summary.warnings.map((warning) => `- ${warning}`));
    }
    return lines.join("\n");
  }

  let used = lines.join("\n").length;
  let included = 0;

  for (const [index, result] of summary.results.entries()) {
    const section = [
      `### ${index + 1}. [${result.scope}] ${result.file}`,
      `- score: ${result.score.toFixed(3)} (adjusted ${result.adjustedScore.toFixed(3)})`,
      result.title ? `- title: ${result.title}` : "",
      result.context ? `- context: ${result.context}` : "",
      "",
      normalizeSnippetForContextPack(result.snippet),
      "",
    ]
      .filter(Boolean)
      .join("\n");

    if (used + section.length > maxChars) {
      break;
    }

    lines.push(section);
    used += section.length;
    included++;
  }

  if (included < summary.results.length) {
    lines.push(`_truncated: included ${included}/${summary.results.length} results due to maxChars=${maxChars}_`);
  }

  if (summary.warnings.length > 0) {
    lines.push("", "Warnings:", ...summary.warnings.map((warning) => `- ${warning}`));
  }

  return lines.join("\n").trim();
}

function normalizeSnippetForContextPack(snippet: string): string {
  const normalized = (snippet || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "(no snippet provided)";
  }
  if (normalized.length <= 900) {
    return normalized;
  }
  return `${normalized.slice(0, 899).trimEnd()}…`;
}

async function queryMemoryCollection(
  pi: ExtensionAPI,
  cwd: string,
  command: string,
  query: string,
  limit: number,
  scopeConfig: MemoryScopeConfig,
): Promise<{ ok: true; results: MemorySearchResult[] } | { ok: false; warning: string }> {
  const result = await pi.exec(
    "qmd",
    [command, query, "--json", "-n", String(limit), "-c", scopeConfig.collection],
    { cwd, timeout: 180_000 },
  );

  if (result.code !== 0) {
    const reason = firstNonEmptyLine(result.stderr) ?? firstNonEmptyLine(result.stdout) ?? "unknown error";
    return {
      ok: false,
      warning: `${scopeConfig.scope}: memory search failed for collection ${scopeConfig.collection} (${reason})`,
    };
  }

  const parsed = parseQmdResultArray(result.stdout);
  const normalized = parsed.map((entry) => ({
    scope: scopeConfig.scope,
    collection: scopeConfig.collection,
    docid: entry.docid,
    score: entry.score,
    adjustedScore: entry.score,
    file: entry.file,
    title: entry.title,
    context: entry.context,
    snippet: entry.snippet,
  } satisfies MemorySearchResult));

  return {
    ok: true,
    results: normalized,
  };
}

function parseQmdResultArray(stdout: string): Array<{
  docid: string;
  score: number;
  file: string;
  title: string;
  context: string;
  snippet: string;
}> {
  const trimmed = stripAnsi(stdout).trim();
  if (!trimmed) {
    return [];
  }

  const payload = extractJsonPayload(trimmed);
  if (!Array.isArray(payload)) {
    return [];
  }

  const out: Array<{
    docid: string;
    score: number;
    file: string;
    title: string;
    context: string;
    snippet: string;
  }> = [];

  for (const item of payload) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const maybe = item as Record<string, unknown>;
    const file = typeof maybe.file === "string" ? maybe.file : "";
    if (!file) {
      continue;
    }

    out.push({
      docid: typeof maybe.docid === "string" ? maybe.docid : "",
      score: typeof maybe.score === "number" ? maybe.score : Number(maybe.score ?? 0) || 0,
      file,
      title: typeof maybe.title === "string" ? maybe.title : "",
      context: typeof maybe.context === "string" ? maybe.context : "",
      snippet: typeof maybe.snippet === "string" ? maybe.snippet : "",
    });
  }

  return out;
}

async function buildMemoryRepoContext(
  pi: ExtensionAPI,
  cwd: string,
  configDir: string,
): Promise<MemoryRepoContext> {
  const repoRoot = await detectRepoRootPath(pi, cwd);
  const repoSlug = await detectRepoSlug(pi, repoRoot);
  const repoMemoryKey = buildRepoMemoryKey(repoRoot, repoSlug);

  const corpusBaseDir = getMemoryCorpusDir(configDir);
  const globalCollection = getGlobalMemoryCollection();
  const localCollection = getLocalMemoryCollection(repoMemoryKey);

  const globalCorpusDir = corpusBaseDir;
  const localCorpusDir = path.join(corpusBaseDir, "local", repoMemoryKey);

  return {
    repoRoot,
    repoSlug,
    repoMemoryKey,
    globalCollection,
    localCollection,
    globalCorpusDir,
    localCorpusDir,
    globalMarkerPath: path.join(globalCorpusDir, "_last_sync.json"),
    localMarkerPath: path.join(localCorpusDir, "_last_sync.json"),
  };
}

async function detectRepoRootPath(pi: ExtensionAPI, cwd: string): Promise<string> {
  const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 20_000 });
  const root = result.stdout.trim();
  if (result.code === 0 && root) {
    return root;
  }
  return cwd;
}

async function detectRepoSlug(pi: ExtensionAPI, repoRoot: string): Promise<string> {
  const remote = await pi.exec("git", ["config", "--get", "remote.origin.url"], {
    cwd: repoRoot,
    timeout: 10_000,
  });

  if (remote.code === 0) {
    const parsed = parseRepoSlugFromRemote(remote.stdout.trim());
    if (parsed) {
      return parsed;
    }
  }

  return path.basename(repoRoot) || "repo";
}

async function ensureQmdAvailable(pi: ExtensionAPI, cwd: string): Promise<void> {
  try {
    const version = await pi.exec("qmd", ["--version"], { cwd, timeout: 30_000 });
    if (version.code === 0) {
      return;
    }
  } catch {
    // fall through
  }
  throw new Error("qmd is not installed. Install with: npm install -g @tobilu/qmd");
}

async function ensureQmdCollection(
  pi: ExtensionAPI,
  cwd: string,
  corpusDir: string,
  collection: string,
  contextLabel: string,
): Promise<void> {
  const listed = await pi.exec("qmd", ["collection", "list"], { cwd, timeout: 60_000 });
  const exists = listed.code === 0 && qmdCollectionExistsInList(listed.stdout, collection);

  if (!exists) {
    const add = await pi.exec("qmd", ["collection", "add", corpusDir, "--name", collection], {
      cwd,
      timeout: 120_000,
    });
    if (add.code !== 0) {
      const combined = `${add.stderr}\n${add.stdout}`;
      if (!/exists|already\s+exists|duplicate/i.test(combined)) {
        const summary = firstNonEmptyLine(add.stderr) ?? firstNonEmptyLine(add.stdout);
        throw new Error(`Failed to add qmd collection ${collection}${summary ? ` (${summary})` : ""}`);
      }
    }
  }

  const contextAdd = await pi.exec("qmd", ["context", "add", `qmd://${collection}`, contextLabel], {
    cwd,
    timeout: 60_000,
  });

  if (contextAdd.code !== 0 && !/exists|duplicate|already/i.test(`${contextAdd.stderr} ${contextAdd.stdout}`)) {
    const summary = firstNonEmptyLine(contextAdd.stderr) ?? firstNonEmptyLine(contextAdd.stdout);
    throw new Error(`Failed to add qmd context${summary ? ` (${summary})` : ""}`);
  }
}

function qmdCollectionExistsInList(stdout: string, collection: string): boolean {
  const needle = collection.trim();
  if (!needle) {
    return false;
  }

  return stdout
    .split("\n")
    .map((line) => stripAnsi(line).trim())
    .filter(Boolean)
    .some((line) => {
      if (line === needle) {
        return true;
      }
      if (line.startsWith(`${needle} (`)) {
        return true;
      }
      return line.includes(`qmd://${needle}`);
    });
}

async function selectSessionFilesForScope(
  sessionFiles: Array<{ path: string; mtimeMs: number }>,
  scope: ConcreteMemoryScope,
  repoRoot: string,
  limit: number,
): Promise<Array<{ path: string; mtimeMs: number }>> {
  if (scope === "global") {
    return sessionFiles.slice(0, limit);
  }

  const selected: Array<{ path: string; mtimeMs: number }> = [];
  for (const sessionFile of sessionFiles) {
    if (selected.length >= limit) {
      break;
    }

    if (await sessionBelongsToRepo(sessionFile.path, repoRoot)) {
      selected.push(sessionFile);
    }
  }

  return selected;
}

async function sessionBelongsToRepo(sessionPath: string, repoRoot: string): Promise<boolean> {
  const header = await readSessionHeader(sessionPath);
  if (!header) {
    return false;
  }

  if (typeof header.cwd === "string" && header.cwd.trim()) {
    return isPathWithin(repoRoot, header.cwd);
  }

  const normalizedPath = sessionPath.toLowerCase();
  const normalizedRepo = repoRoot.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return normalizedPath.includes(normalizedRepo);
}

async function readSessionHeader(sessionPath: string): Promise<{ cwd?: string } | null> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(sessionPath, "r");
    const buffer = Buffer.alloc(8_192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const firstLine = buffer.toString("utf8", 0, bytesRead).split("\n")[0]?.trim();
    if (!firstLine) {
      return null;
    }

    const parsed = JSON.parse(firstLine) as { cwd?: string };
    return parsed;
  } catch {
    return null;
  } finally {
    if (handle) {
      await handle.close();
    }
  }
}

async function renderSessionAsMarkdown(sessionPath: string): Promise<string | null> {
  const raw = await fs.readFile(sessionPath, "utf8");
  const lines = raw.split("\n").filter(Boolean);

  const chunks: string[] = [];
  const maxChars = getMaxCharsPerSession();
  let usedChars = 0;

  for (const line of lines) {
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const excerpt = extractEntryExcerpt(entry);
    if (!excerpt) {
      continue;
    }

    if (usedChars + excerpt.length > maxChars) {
      break;
    }

    chunks.push(excerpt);
    usedChars += excerpt.length;
  }

  if (chunks.length === 0) {
    return null;
  }

  const header = [
    "# Session Transcript Excerpts",
    "",
    `- Source: ${sessionPath}`,
    `- Exported: ${new Date().toISOString()}`,
    "",
    "---",
    "",
  ].join("\n");

  return header + chunks.join("\n\n---\n\n");
}

function extractEntryExcerpt(entry: any): string | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  if (entry.type === "message" && entry.message) {
    const role = String(entry.message.role ?? "unknown");
    const ts = String(entry.timestamp ?? entry.message.timestamp ?? "");

    if (role === "user") {
      const text = extractContentText(entry.message.content);
      if (!text) return null;
      return `## ${ts} USER\n\n${text}`;
    }

    if (role === "assistant") {
      const textParts: string[] = [];
      const content = Array.isArray(entry.message.content) ? entry.message.content : [];
      for (const part of content) {
        if (part?.type === "text" && typeof part.text === "string") {
          textParts.push(part.text);
        }
        if (part?.type === "toolCall") {
          const call = `${part.name ?? "tool"}(${JSON.stringify(part.arguments ?? {})})`;
          textParts.push(`[toolCall] ${call}`);
        }
      }
      const text = textParts.join("\n").trim();
      if (!text) return null;
      return `## ${ts} ASSISTANT\n\n${text}`;
    }

    if (role === "toolResult") {
      const text = extractContentText(entry.message.content);
      if (!text) return null;
      const name = String(entry.message.toolName ?? "tool");
      return `## ${ts} TOOL_RESULT (${name})\n\n${text}`;
    }
  }

  if (entry.type === "compaction" && typeof entry.summary === "string") {
    return `## COMPACTION_SUMMARY\n\n${entry.summary}`;
  }

  if (entry.type === "branch_summary" && typeof entry.summary === "string") {
    return `## BRANCH_SUMMARY\n\n${entry.summary}`;
  }

  if (entry.type === "custom_message" && typeof entry.content === "string") {
    return `## CUSTOM_MESSAGE (${entry.customType ?? "custom"})\n\n${entry.content}`;
  }

  return null;
}

function extractContentText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts = content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if ((part as any).type === "text") {
        return String((part as any).text ?? "");
      }
      if ((part as any).type === "image") {
        return "[image]";
      }
      return "";
    })
    .filter(Boolean);
  return parts.join("\n").trim();
}

function buildLocalLogLineFilter(repo: MemoryRepoContext): (line: string) => boolean {
  const repoRoot = path.resolve(repo.repoRoot);
  const repoSlug = repo.repoSlug.toLowerCase();

  return (line: string) => {
    const raw = stripAnsi(line).trim();
    if (!raw) {
      return false;
    }

    const lower = raw.toLowerCase();
    if (lower.includes(repoSlug) || raw.includes(repoRoot)) {
      return true;
    }

    if (!raw.startsWith("{")) {
      return false;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.repo === "string" && parsed.repo.toLowerCase() === repoSlug) {
        return true;
      }

      const maybePathFields = [parsed.cwd, parsed.repoRoot, parsed.path, parsed.workdir]
        .filter((value): value is string => typeof value === "string" && value.length > 0);

      return maybePathFields.some((value) => isPathWithin(repoRoot, value));
    } catch {
      return false;
    }
  };
}

async function renderLogAsMarkdown(
  logPath: string,
  options?: { lineFilter?: (line: string) => boolean; maxLines?: number; title?: string },
): Promise<string | null> {
  const raw = await fs.readFile(logPath, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  const filtered = options?.lineFilter ? lines.filter(options.lineFilter) : lines;
  if (filtered.length === 0) {
    return null;
  }

  const maxLines = clamp(options?.maxLines ?? 500, 20, 2_000);
  const tail = filtered.slice(-maxLines).join("\n");

  const filteredLabel = options?.lineFilter
    ? ` (filtered from ${lines.length})`
    : "";

  return [
    `# ${options?.title ?? "Log Excerpts"}`,
    "",
    `- Source: ${logPath}`,
    `- Exported: ${new Date().toISOString()}`,
    `- Lines exported: ${Math.min(maxLines, filtered.length)} / ${filtered.length}${filteredLabel}`,
    "",
    "```text",
    tail,
    "```",
  ].join("\n");
}

async function listFilesRecursive(
  root: string,
  include: (filePath: string) => boolean,
): Promise<Array<{ path: string; mtimeMs: number }>> {
  if (!existsSync(root)) {
    return [];
  }

  const out: Array<{ path: string; mtimeMs: number }> = [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!include(fullPath)) {
        continue;
      }
      const stat = await fs.stat(fullPath);
      out.push({ path: fullPath, mtimeMs: stat.mtimeMs });
    }
  }

  await walk(root);
  return out;
}

async function pruneMarkdownFiles(dir: string, keep: Set<string>): Promise<void> {
  if (!existsSync(dir)) {
    return;
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() || !entry.name.endsWith(".md")) {
      continue;
    }
    if (keep.has(entry.name)) {
      continue;
    }
    await fs.unlink(path.join(dir, entry.name));
  }
}

async function isMemoryStale(pi: ExtensionAPI, cwd: string, scope: MemoryScope): Promise<boolean> {
  const configDir = getConfigDir();
  const repo = await buildMemoryRepoContext(pi, cwd, configDir);
  const scopeConfigs = resolveMemoryScopeConfigs(scope, repo);

  for (const scopeConfig of scopeConfigs) {
    if (await isMemoryScopeStale(scopeConfig.markerPath)) {
      return true;
    }
  }

  return false;
}

async function isMemoryScopeStale(markerPath: string): Promise<boolean> {
  if (!existsSync(markerPath)) {
    return true;
  }

  try {
    const raw = await fs.readFile(markerPath, "utf8");
    const parsed = JSON.parse(raw) as { ts?: number };
    const ts = Number(parsed.ts ?? 0);
    if (!Number.isFinite(ts) || ts <= 0) {
      return true;
    }
    return Date.now() - ts > getMemorySyncTtlMs();
  } catch {
    return true;
  }
}

function isPathWithin(basePath: string, candidatePath: string): boolean {
  const base = path.resolve(basePath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(base, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function detectDefaultBranch(pi: ExtensionAPI, cwd: string): Promise<string> {
  const response = await pi.exec(
    "gh",
    ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
    { cwd, timeout: 30_000 }
  );
  const value = response.stdout.trim();
  if (response.code === 0 && value) {
    return value;
  }

  const mainCheck = await pi.exec("git", ["rev-parse", "--verify", "main"], { cwd, timeout: 20_000 });
  if (mainCheck.code === 0) {
    return "main";
  }
  return "master";
}

async function detectCurrentBranchPrNumber(pi: ExtensionAPI, cwd: string): Promise<number | null> {
  const current = await ghJson<{ number?: number }>(pi, cwd, ["pr", "view", "--json", "number"]);
  const prNumber = Number(current?.number);
  if (Number.isInteger(prNumber) && prNumber > 0) {
    return prNumber;
  }
  return null;
}

async function ghJson<T>(pi: ExtensionAPI, cwd: string, args: string[]): Promise<T | null> {
  const result = await pi.exec("gh", args, { cwd, timeout: 60_000 });
  if (result.code !== 0) {
    return null;
  }
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    return null;
  }
}

async function assessPrReadiness(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  options: SquashMergeOptions
): Promise<PrReadinessReport> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const botFindings: BotReviewFinding[] = [];

  const meta = await ghJson<PullRequestMeta>(pi, ctx.cwd, [
    "pr",
    "view",
    String(options.prNumber),
    "--json",
    "number,state,isDraft,mergeStateStatus,reviewDecision,title,url",
  ]);

  if (!meta) {
    return {
      meta: null,
      blockers: ["Unable to load pull request metadata."],
      warnings,
      botFindings,
    };
  }

  if (meta.state !== "OPEN") {
    blockers.push(`PR is not open (state=${meta.state}).`);
  }
  if (meta.isDraft) {
    blockers.push("PR is still draft.");
  }
  if (meta.reviewDecision === "CHANGES_REQUESTED") {
    blockers.push("Review decision is CHANGES_REQUESTED.");
  }
  if (meta.mergeStateStatus !== "CLEAN" && meta.mergeStateStatus !== "HAS_HOOKS") {
    blockers.push(`mergeStateStatus=${meta.mergeStateStatus} (not merge-ready).`);
  }

  const checks = await ghJson<PrCheck[]>(pi, ctx.cwd, [
    "pr",
    "checks",
    String(options.prNumber),
    "--json",
    "name,state,bucket,link",
  ]);

  if (!checks) {
    const fallbackChecks = await pi.exec("gh", ["pr", "checks", String(options.prNumber)], {
      cwd: ctx.cwd,
      timeout: 120_000,
    });
    if (fallbackChecks.code !== 0) {
      blockers.push(
        `Unable to verify CI/CD checks (${firstNonEmptyLine(fallbackChecks.stderr) ?? "unknown error"}).`
      );
    }
  } else {
    const failing = checks.filter((check) => {
      const bucket = check.bucket?.toLowerCase();
      if (bucket) {
        return bucket === "fail" || bucket === "cancel";
      }

      const state = check.state.toUpperCase();
      return (
        state === "FAILURE" ||
        state === "ERROR" ||
        state === "CANCELLED" ||
        state === "TIMED_OUT" ||
        state === "ACTION_REQUIRED" ||
        state === "STARTUP_FAILURE"
      );
    });
    const pending = checks.filter((check) => {
      const bucket = check.bucket?.toLowerCase();
      if (bucket) {
        return bucket === "pending";
      }

      const state = check.state.toUpperCase();
      return state === "PENDING" || state === "IN_PROGRESS" || state === "QUEUED" || state === "WAITING";
    });

    if (failing.length > 0) {
      blockers.push(`CI/CD failing checks: ${failing.map((check) => check.name).join(", ")}`);
    }
    if (pending.length > 0) {
      blockers.push(`CI/CD checks still pending: ${pending.map((check) => check.name).join(", ")}`);
    }
    if (checks.length === 0) {
      warnings.push("No PR checks were reported by GitHub CLI.");
    }
  }

  const repo = await getRepoIdentity(pi, ctx.cwd);
  if (!repo) {
    warnings.push("Could not resolve repository identity for deep review-thread checks.");
  } else {
    const threadScan = await fetchReviewThreads(pi, ctx.cwd, repo, options.prNumber);
    if (threadScan) {
      if (threadScan.truncated) {
        warnings.push("Review thread scan truncated at 100 threads; manually verify long PR discussions.");
      }

      const unresolved = threadScan.threads.filter((thread) => !thread.isResolved);
      const unresolvedSevere = unresolved.filter((thread) => hasSeveritySignal(threadSummary(thread)));

      if (unresolvedSevere.length > 0) {
        blockers.push(
          `Unresolved severe review threads: ${unresolvedSevere
            .slice(0, 3)
            .map((thread) => thread.path ?? "(no-path)")
            .join(", ")}`
        );
      }

      const unresolvedNits = unresolved.length - unresolvedSevere.length;
      if (unresolvedNits > 0) {
        if (options.allowUnresolvedNits) {
          warnings.push(
            `Unresolved non-severe review threads: ${unresolvedNits} (allowed by --allow-unresolved-nits).`
          );
        } else {
          warnings.push(
            `Unresolved non-severe review threads: ${unresolvedNits}. Resolve or run with --allow-unresolved-nits after manual review.`
          );
        }
      }
    } else {
      warnings.push("Could not inspect review threads via GraphQL.");
    }

    const scannedBotFindings = await fetchBotReviewFindings(pi, ctx.cwd, repo, options.prNumber);
    if (!scannedBotFindings) {
      warnings.push("Could not inspect bot review comments for severity policy checks.");
    } else {
      botFindings.push(...scannedBotFindings);

      const blockingBotFindings = scannedBotFindings.filter((finding) =>
        isHardBlockingFinding("bot", finding.severity, finding.actionable)
      );

      if (blockingBotFindings.length > 0) {
        const sample = blockingBotFindings
          .slice(0, 3)
          .map((finding) => `${finding.severity.toUpperCase()} ${finding.summary}`)
          .join("; ");

        if (options.allowCriticalBotFindings) {
          warnings.push(
            `Blocking bot findings present (allowed by --allow-critical-bot-findings): ${sample}`
          );
        } else {
          blockers.push(
            `Blocking bot findings (critical/high) must be fixed before merge: ${sample}`
          );
        }
      }
    }

    const files = await ghJson<PrFile[]>(pi, ctx.cwd, [
      "api",
      `repos/${repo.owner}/${repo.name}/pulls/${options.prNumber}/files?per_page=100`,
    ]);

    if (!files) {
      warnings.push("Could not inspect changed files for quality-gate weakening patterns.");
    } else {
      const findings = detectQualityGateFindings(files);
      if (findings.length > 0) {
        if (options.allowQualityGateChanges) {
          warnings.push(
            `Potential quality-gate weakening detected (allowed by --allow-quality-gate-changes): ${findings
              .slice(0, 3)
              .join("; ")}`
          );
        } else {
          blockers.push(
            `Potential quality-gate weakening detected: ${findings
              .slice(0, 3)
              .join("; ")} (use --allow-quality-gate-changes only after explicit review).`
          );
        }
      }
    }
  }

  return { meta, blockers, warnings, botFindings };
}

async function getRepoIdentity(pi: ExtensionAPI, cwd: string): Promise<RepoIdentity | null> {
  const repo = await ghJson<{ owner?: { login?: string }; name?: string }>(pi, cwd, [
    "repo",
    "view",
    "--json",
    "owner,name",
  ]);

  const owner = repo?.owner?.login?.trim();
  const name = repo?.name?.trim();
  if (!owner || !name) {
    return null;
  }
  return { owner, name };
}

async function fetchReviewThreads(
  pi: ExtensionAPI,
  cwd: string,
  repo: RepoIdentity,
  prNumber: number
): Promise<{ threads: ReviewThread[]; truncated: boolean } | null> {
  const query = [
    "query($owner:String!, $name:String!, $number:Int!) {",
    "  repository(owner:$owner, name:$name) {",
    "    pullRequest(number:$number) {",
    "      reviewThreads(first:100) {",
    "        nodes {",
    "          isResolved",
    "          path",
    "          comments(first:20) {",
    "            nodes {",
    "              body",
    "              author { login }",
    "            }",
    "          }",
    "        }",
    "        pageInfo { hasNextPage }",
    "      }",
    "    }",
    "  }",
    "}",
  ].join("\n");

  const result = await pi.exec(
    "gh",
    [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${repo.owner}`,
      "-F",
      `name=${repo.name}`,
      "-F",
      `number=${prNumber}`,
    ],
    { cwd, timeout: 120_000 }
  );

  if (result.code !== 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout) as ReviewThreadsResponse;
    const reviewThreads = parsed.data?.repository?.pullRequest?.reviewThreads;
    return {
      threads: reviewThreads?.nodes ?? [],
      truncated: Boolean(reviewThreads?.pageInfo?.hasNextPage),
    };
  } catch {
    return null;
  }
}

async function fetchBotReviewFindings(
  pi: ExtensionAPI,
  cwd: string,
  repo: RepoIdentity,
  prNumber: number
): Promise<BotReviewFinding[] | null> {
  const issueComments = await ghJson<GitHubComment[]>(pi, cwd, [
    "api",
    `repos/${repo.owner}/${repo.name}/issues/${prNumber}/comments?per_page=100`,
  ]);

  const reviewComments = await ghJson<GitHubComment[]>(pi, cwd, [
    "api",
    `repos/${repo.owner}/${repo.name}/pulls/${prNumber}/comments?per_page=100`,
  ]);

  if (!issueComments && !reviewComments) {
    return null;
  }

  const findings: BotReviewFinding[] = [];
  if (issueComments) {
    findings.push(...collectBotFindings(issueComments, "issue_comment"));
  }
  if (reviewComments) {
    findings.push(...collectBotFindings(reviewComments, "review_comment"));
  }

  return findings;
}

function collectBotFindings(
  comments: GitHubComment[],
  source: BotReviewFinding["source"]
): BotReviewFinding[] {
  const findings: BotReviewFinding[] = [];

  for (const comment of comments) {
    const login = comment.user?.login ?? "";
    const type = comment.user?.type ?? "";
    if (!isBotAuthor(login, type)) {
      continue;
    }

    const body = comment.body ?? "";
    const severity = classifyReviewSeverity(body);
    if (severity === "none") {
      continue;
    }

    findings.push({
      id: comment.id,
      source,
      author: login || "unknown-bot",
      severity,
      actionable: isActionableReviewFinding(body),
      url: comment.html_url ?? "",
      summary: summarizeFinding(body),
    });
  }

  return findings;
}

function summarizeFinding(body: string): string {
  const line = body
    .split("\n")
    .map((value) => value.trim())
    .find((value) =>
      Boolean(value) && !value.startsWith("!") && !value.startsWith("<")
    );

  const normalized = line ? line.replace(/`/g, "").trim() : "bot finding";
  if (normalized.length <= 120) {
    return normalized;
  }
  return `${normalized.slice(0, 117).trimEnd()}...`;
}

function threadSummary(thread: ReviewThread): string {
  const comments = thread.comments?.nodes ?? [];
  const bodies = comments
    .map((comment) => comment.body?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
  return `${thread.path ?? "(no-path)"}\n${bodies}`.trim();
}

function hasSeveritySignal(text: string): boolean {
  const severity = classifyReviewSeverity(text);
  return isHardBlockingFinding("human", severity, isActionableReviewFinding(text));
}

function detectQualityGateFindings(files: PrFile[]): string[] {
  const findings: string[] = [];

  for (const file of files) {
    if (!isQualityGateFile(file.filename)) {
      continue;
    }

    const patch = file.patch ?? "";
    if (!patch) {
      findings.push(`${file.filename}: changed quality-gate-related file (patch unavailable)`);
      continue;
    }

    if (/^\+.*continue-on-error:\s*true/im.test(patch)) {
      findings.push(`${file.filename}: adds continue-on-error: true`);
    }
    if (/^\+.*\|\|\s*true\s*$/im.test(patch)) {
      findings.push(`${file.filename}: adds '|| true' failure bypass`);
    }
    if (/^\+.*--passWithNoTests\b/im.test(patch)) {
      findings.push(`${file.filename}: allows passWithNoTests`);
    }
    if (/^\+.*--max-warnings\s+[1-9]\d*/im.test(patch)) {
      findings.push(`${file.filename}: increases --max-warnings tolerance`);
    }

    findings.push(...extractLoweredThresholdFindings(file.filename, patch));
  }

  return dedupe(findings);
}

function isQualityGateFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const base = path.posix.basename(normalized);

  return (
    normalized.startsWith(".github/workflows/") ||
    normalized === "package.json" ||
    normalized === "codecov.yml" ||
    normalized === ".codecov.yml" ||
    normalized === ".coveragerc" ||
    /^vitest\.config(\.[^/]+)?$/.test(base) ||
    /^jest\.config(\.[^/]+)?$/.test(base) ||
    /^eslint\.config(\.[^/]+)?$/.test(base) ||
    /^\.eslintrc(\.[^/]+)?$/.test(base) ||
    /^tsconfig(\.[^/]+)?\.json$/.test(base) ||
    /^lefthook(\.[^/]+)?$/.test(base) ||
    normalized === ".husky" ||
    normalized.includes("/.husky/") ||
    /^commitlint(\.[^/]+)?$/.test(base)
  );
}

function extractLoweredThresholdFindings(filePath: string, patch: string): string[] {
  const findings: string[] = [];
  const removed = new Map<string, number>();

  const lines = patch.split("\n");
  for (const line of lines) {
    const parsed = parseThresholdLine(line);
    if (!parsed) {
      continue;
    }

    const key = `${filePath}:${parsed.metric}`;
    if (parsed.kind === "removed") {
      removed.set(key, parsed.value);
      continue;
    }

    const previous = removed.get(key);
    if (previous !== undefined && parsed.value < previous) {
      findings.push(`${filePath}: lowers ${parsed.metric} threshold (${previous} -> ${parsed.value})`);
      continue;
    }

    if (parsed.value <= 5 && /(coverage|threshold|minimum_coverage)/i.test(parsed.metric)) {
      findings.push(`${filePath}: sets ${parsed.metric} threshold to very low value (${parsed.value})`);
    }
  }

  return findings;
}

function parseThresholdLine(
  line: string
): { kind: "added" | "removed"; metric: string; value: number } | null {
  if (!(line.startsWith("+") || line.startsWith("-"))) {
    return null;
  }
  if (line.startsWith("+++") || line.startsWith("---")) {
    return null;
  }

  const lowered = line.toLowerCase();
  if (!/(coverage|threshold|minimum_coverage|lines|branches|functions|statements)/.test(lowered)) {
    return null;
  }

  const metricMatch = lowered.match(
    /(minimum_coverage|coverage_threshold|coverage|threshold|lines|branches|functions|statements)/
  );
  const valueMatch = lowered.match(/(-?\d+(?:\.\d+)?)/);

  if (!metricMatch || !valueMatch) {
    return null;
  }

  return {
    kind: line.startsWith("+") ? "added" : "removed",
    metric: metricMatch[1],
    value: Number(valueMatch[1]),
  };
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function parseSquashMergeArgs(args: string): ParsedSquashMergeArgs {
  const trimmed = args.trim();
  if (!trimmed) {
    return {
      prNumber: null,
      reflectionFocus: "",
      allowUnresolvedNits: false,
      allowQualityGateChanges: false,
      allowCriticalBotFindings: false,
      keepBranch: false,
    };
  }

  const tokens = trimmed.split(/\s+/);
  const flags = new Set<string>();
  const valueTokens: string[] = [];

  for (const token of tokens) {
    if (token.startsWith("--")) {
      flags.add(token);
    } else {
      valueTokens.push(token);
    }
  }

  let prNumber: number | null = null;
  const focusTokens = [...valueTokens];
  if (focusTokens.length > 0) {
    const explicitPr = parsePrNumberToken(focusTokens[0]);
    if (explicitPr !== null) {
      prNumber = explicitPr;
      focusTokens.shift();
    }
  }

  return {
    prNumber,
    reflectionFocus: focusTokens.join(" ").trim(),
    allowUnresolvedNits: flags.has("--allow-unresolved-nits"),
    allowQualityGateChanges: flags.has("--allow-quality-gate-changes"),
    allowCriticalBotFindings: flags.has("--allow-critical-bot-findings"),
    keepBranch: flags.has("--keep-branch"),
  };
}

function parsePrNumberToken(token: string): number | null {
  const normalized = token.startsWith("#") ? token.slice(1) : token;
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const value = Number(normalized);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function getConfigDir(): string {
  return (
    process.env.PI_CONFIG_DIR ??
    process.env.PI_CODING_AGENT_DIR ??
    path.join(homedir(), ".pi", "agent")
  );
}

function getGlobalMemoryCollection(): string {
  const explicit = process.env.PI_MEMORY_GLOBAL_COLLECTION?.trim();
  if (explicit) {
    return sanitizeCollectionName(explicit);
  }

  const legacy = process.env.PI_MEMORY_QMD_COLLECTION?.trim();
  if (legacy) {
    return sanitizeCollectionName(legacy);
  }

  return "pi-memory";
}

function getLocalMemoryCollection(repoMemoryKey: string): string {
  const explicit = process.env.PI_MEMORY_LOCAL_COLLECTION?.trim();
  if (explicit) {
    return sanitizeCollectionName(resolveCollectionTemplate(explicit, repoMemoryKey));
  }

  const template = process.env.PI_MEMORY_LOCAL_COLLECTION_TEMPLATE?.trim() || "pi-memory-local-{repo}";
  return sanitizeCollectionName(resolveCollectionTemplate(template, repoMemoryKey));
}

function getMemoryCorpusDir(configDir: string): string {
  return process.env.PI_MEMORY_CORPUS_DIR?.trim() || path.join(configDir, "cache", "memory-corpus");
}

function getMemorySyncTtlMs(): number {
  const value = Number(process.env.PI_MEMORY_SYNC_TTL_MS ?? 10 * 60 * 1000);
  return Number.isFinite(value) && value > 0 ? value : 10 * 60 * 1000;
}

function getDefaultSessionLimit(): number {
  const value = Number(process.env.PI_MEMORY_SESSION_LIMIT ?? 40);
  return clamp(Number.isFinite(value) ? value : 40, 1, 500);
}

function getDefaultLocalSessionLimit(): number {
  const value = Number(process.env.PI_MEMORY_LOCAL_SESSION_LIMIT ?? process.env.PI_MEMORY_SESSION_LIMIT ?? 80);
  return clamp(Number.isFinite(value) ? value : 80, 1, 500);
}

function getMaxCharsPerSession(): number {
  const value = Number(process.env.PI_MEMORY_MAX_CHARS_PER_SESSION ?? 120_000);
  return clamp(Number.isFinite(value) ? value : 120_000, 5_000, 2_000_000);
}

function getMemoryLocalPriorityBoost(): number {
  const value = Number(process.env.PI_MEMORY_LOCAL_PRIORITY_BOOST ?? 0.15);
  if (!Number.isFinite(value)) {
    return 0.15;
  }
  return Math.max(0, Math.min(value, 2));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function repoFromPullRequestUrl(url: string): string | undefined {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\//i);
  if (!match) {
    return undefined;
  }

  return `${match[1]}/${match[2]}`;
}

function firstNonEmptyLine(text: string): string | null {
  const line = text
    .split("\n")
    .map((value) => value.trim())
    .find(Boolean);
  return line ?? null;
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_CSI_REGEX, "").replace(ANSI_OSC_REGEX, "");
}

function extractJsonPayload(text: string): unknown | null {
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket < 0 || lastBracket <= firstBracket) {
    return null;
  }

  const candidate = text.slice(firstBracket, lastBracket + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

