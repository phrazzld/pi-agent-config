import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

import { parseBootstrapArgs } from "./args";

type ChangeAction = "created" | "updated" | "skipped";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

interface BootstrapChange {
  path: string;
  action: ChangeAction;
  reason?: string;
}

interface LaneResult {
  name: string;
  model: string;
  thinking: ThinkingLevel;
  ok: boolean;
  elapsedMs: number;
  output: string;
  error?: string;
}

interface BootstrapResult {
  repoRoot: string;
  domain: string;
  force: boolean;
  quick: boolean;
  lanes: LaneResult[];
  synthesisModel: string;
  recommendedTarget: string;
  notes: string[];
  changes: BootstrapChange[];
}

interface BootstrapPlan {
  files: Record<string, string>;
  notes?: string[];
  recommendedTarget?: string;
}

interface RepoFacts {
  domain: string;
  repoRoot: string;
  topLevelFiles: string[];
  topLevelDirs: string[];
  packageManager: string;
  scripts: string[];
  dependencies: string[];
  devDependencies: string[];
  workflowFiles: string[];
  stackHints: string[];
  readmeSnippet: string;
}

interface PiRunResult {
  ok: boolean;
  output: string;
  error?: string;
  elapsedMs: number;
}

const BOOTSTRAP_PARAMS = Type.Object({
  domain: Type.Optional(Type.String({ description: "Domain slug (e.g. vox, cerberus)" })),
  force: Type.Optional(Type.Boolean({ description: "Overwrite existing differing files" })),
  quick: Type.Optional(Type.Boolean({ description: "Skip autonomous multi-model bootstrap and use template-only mode" })),
});

const MODEL_SCOUT = process.env.PI_BOOTSTRAP_MODEL_SCOUT?.trim() || "openai-codex/gpt-5.3-codex";
const MODEL_RESEARCH = process.env.PI_BOOTSTRAP_MODEL_RESEARCH?.trim() || "openrouter/google/gemini-3.1-pro";
const MODEL_MARKET = process.env.PI_BOOTSTRAP_MODEL_MARKET?.trim() || "openrouter/google/gemini-3-flash-preview";
const MODEL_CRITIC = process.env.PI_BOOTSTRAP_MODEL_CRITIC?.trim() || "openrouter/anthropic/claude-sonnet-4.6";
const MODEL_SYNTHESIS = process.env.PI_BOOTSTRAP_MODEL_SYNTHESIS?.trim() || "openai-codex/gpt-5.3-codex";

const REQUIRED_FILES = [
  ".pi/settings.json",
  ".pi/agents/planner.md",
  ".pi/agents/worker.md",
  ".pi/agents/reviewer.md",
  ".pi/agents/teams.yaml",
  ".pi/agents/pipelines.yaml",
  "docs/pi-local-workflow.md",
  ".pi/bootstrap-report.md",
];

export default function bootstrapExtension(pi: ExtensionAPI): void {
  pi.registerCommand("bootstrap-repo", {
    description:
      "Intelligent repo bootstrap: multi-model reconnaissance + synthesis into repo-local .pi config",
    handler: async (args, ctx) => {
      const defaultDomain = path.basename(await detectRepoRoot(pi, ctx.cwd));
      const parsed = parseBootstrapArgs(args, defaultDomain);

      const result = await bootstrapRepo(pi, ctx, {
        domain: parsed.domain,
        force: parsed.force,
        quick: parsed.quick,
      });

      const summary = formatBootstrapSummary(result);
      ctx.ui.notify(summary, "info");
      pi.sendMessage({
        customType: "bootstrap-repo",
        content: summary,
        display: true,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "bootstrap_repo",
    label: "Bootstrap Repo",
    description:
      "Intelligently bootstrap repo-local Pi configuration with multi-model reconnaissance and synthesis.",
    parameters: BOOTSTRAP_PARAMS,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const defaultDomain = path.basename(await detectRepoRoot(pi, ctx.cwd));

      const result = await bootstrapRepo(pi, ctx, {
        domain: params.domain?.trim() || defaultDomain,
        force: params.force ?? false,
        quick: params.quick ?? false,
      });

      const summary = formatBootstrapSummary(result);
      return {
        content: [{ type: "text", text: summary }],
        details: result,
      };
    },
    renderCall(args, theme) {
      const domain = String(args.domain ?? "project");
      return new Text(
        `${theme.fg("toolTitle", theme.bold("bootstrap_repo "))}${theme.fg("accent", domain)}`,
        0,
        0,
      );
    },
  });
}

async function bootstrapRepo(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  options: { domain: string; force: boolean; quick: boolean },
): Promise<BootstrapResult> {
  const repoRoot = await detectRepoRoot(pi, ctx.cwd);
  const domain = sanitizeDomain(options.domain);

  ctx.ui.setStatus("bootstrap", "Collecting repository facts...");
  const facts = await collectRepoFacts(repoRoot, domain);

  let lanes: LaneResult[] = [];
  let notes: string[] = [];
  let recommendedTarget = "build";
  let plan: BootstrapPlan | null = null;

  if (!options.quick) {
    ctx.ui.setStatus("bootstrap", "Running multi-model bootstrap lanes...");
    lanes = await runBootstrapLanes(pi, repoRoot, facts, ctx);

    ctx.ui.setStatus("bootstrap", "Synthesizing repository-local Pi config...");
    const synthesis = await runSynthesisLane(pi, repoRoot, facts, lanes);
    plan = synthesis.plan;
    if (!plan && synthesis.error) {
      notes.push(`synthesis-fallback: ${synthesis.error}`);
    }
  }

  if (!plan) {
    plan = fallbackPlan(facts, lanes);
  }

  const normalized = normalizePlan(plan, facts, lanes);
  notes = dedupe([...(plan.notes ?? []), ...notes]);
  recommendedTarget = plan.recommendedTarget || inferRecommendedTarget(facts, lanes);

  const changes: BootstrapChange[] = [];
  for (const [relativePath, content] of Object.entries(normalized.files)) {
    const absolutePath = resolveOutputPath(repoRoot, relativePath);
    if (!absolutePath) {
      changes.push({
        path: relativePath,
        action: "skipped",
        reason: "blocked unsafe output path",
      });
      continue;
    }
    await writePlannedFile(absolutePath, content, options.force, changes);
  }

  ctx.ui.setStatus("bootstrap", undefined);

  return {
    repoRoot,
    domain,
    force: options.force,
    quick: options.quick,
    lanes,
    synthesisModel: MODEL_SYNTHESIS,
    recommendedTarget,
    notes,
    changes,
  };
}

async function runBootstrapLanes(
  pi: ExtensionAPI,
  repoRoot: string,
  facts: RepoFacts,
  ctx: ExtensionContext,
): Promise<LaneResult[]> {
  const webSearchExtension = path.join(getConfigDir(), "extensions", "web-search", "index.ts");
  const hasWebSearchExt = existsSync(webSearchExtension);

  const lanes: Array<{
    name: string;
    model: string;
    thinking: ThinkingLevel;
    useWebSearch: boolean;
    task: string;
  }> = [
    {
      name: "repo-scout",
      model: MODEL_SCOUT,
      thinking: "xhigh",
      useWebSearch: false,
      task: buildRepoScoutPrompt(facts),
    },
    {
      name: "docs-research",
      model: MODEL_RESEARCH,
      thinking: "high",
      useWebSearch: true,
      task: buildDocsResearchPrompt(facts),
    },
    {
      name: "market-research",
      model: MODEL_MARKET,
      thinking: "medium",
      useWebSearch: true,
      task: buildMarketResearchPrompt(facts),
    },
    {
      name: "workflow-critic",
      model: MODEL_CRITIC,
      thinking: "high",
      useWebSearch: false,
      task: buildWorkflowCriticPrompt(facts),
    },
  ];

  const results = await Promise.all(
    lanes.map(async (lane) => {
      ctx.ui.setStatus("bootstrap", `Lane ${lane.name}: ${lane.model}`);
      const run = await runPiPrompt({
        cwd: repoRoot,
        model: lane.model,
        thinking: lane.thinking,
        task: lane.task,
        tools: lane.useWebSearch
          ? ["read", "bash", "grep", "find", "ls", "web_search"]
          : ["read", "bash", "grep", "find", "ls"],
        extensions: lane.useWebSearch && hasWebSearchExt ? [webSearchExtension] : [],
      });

      return {
        name: lane.name,
        model: lane.model,
        thinking: lane.thinking,
        ok: run.ok,
        elapsedMs: run.elapsedMs,
        output: run.output,
        error: run.error,
      } satisfies LaneResult;
    }),
  );

  return results;
}

async function runSynthesisLane(
  pi: ExtensionAPI,
  repoRoot: string,
  facts: RepoFacts,
  lanes: LaneResult[],
): Promise<{ plan: BootstrapPlan | null; error?: string }> {
  const lanePayload = lanes
    .map((lane) => {
      const status = lane.ok ? "ok" : `failed (${lane.error ?? "unknown"})`;
      const body = truncateForSynthesis(lane.output || lane.error || "", 12_000);
      return [`## Lane: ${lane.name}`, `- model: ${lane.model}`, `- status: ${status}`, "", body].join("\n");
    })
    .join("\n\n---\n\n");

  const prompt = [
    "You are a principal Pi configuration architect.",
    "Synthesize a repository-specific local Pi configuration from the evidence below.",
    "",
    "Return STRICT JSON only (no markdown fences) with this exact shape:",
    "{",
    '  "files": {',
    '    ".pi/settings.json": "...",',
    '    ".pi/agents/planner.md": "...",',
    '    ".pi/agents/worker.md": "...",',
    '    ".pi/agents/reviewer.md": "...",',
    '    ".pi/agents/teams.yaml": "...",',
    '    ".pi/agents/pipelines.yaml": "...",',
    '    "docs/pi-local-workflow.md": "...",',
    '    ".pi/bootstrap-report.md": "..."',
    "  },",
    '  "recommendedTarget": "build|research|autopilot|daybook",',
    '  "notes": ["..."]',
    "}",
    "",
    "Requirements:",
    "- settings.json must be valid JSON with explicit local intent.",
    "- Teams and pipelines must only reference agents that exist in files output.",
    "- Include at least one repo-specific pipeline and one repo-specific workflow note.",
    "- Include concise rationale in .pi/bootstrap-report.md with lane evidence references.",
    "",
    "## Repository Facts",
    formatRepoFacts(facts),
    "",
    "## Lane Outputs",
    lanePayload,
  ].join("\n");

  const run = await runPiPrompt({
    cwd: repoRoot,
    model: MODEL_SYNTHESIS,
    thinking: "xhigh",
    task: prompt,
    tools: ["read", "bash", "grep", "find", "ls"],
  });

  if (!run.ok) {
    return { plan: null, error: run.error ?? "synthesis run failed" };
  }

  const plan = parseBootstrapPlan(run.output);
  if (!plan) {
    return { plan: null, error: "failed to parse synthesis JSON" };
  }

  return { plan };
}

function normalizePlan(plan: BootstrapPlan, facts: RepoFacts, lanes: LaneResult[]): BootstrapPlan {
  const files = { ...plan.files };

  const fallback = fallbackPlan(facts, lanes).files;
  for (const required of REQUIRED_FILES) {
    if (!files[required] || !files[required].trim()) {
      files[required] = fallback[required];
    }
  }

  const settingsRaw = files[".pi/settings.json"];
  try {
    const parsed = JSON.parse(settingsRaw);
    files[".pi/settings.json"] = `${JSON.stringify(parsed, null, 2)}\n`;
  } catch {
    files[".pi/settings.json"] = fallback[".pi/settings.json"];
  }

  return {
    files,
    notes: plan.notes,
    recommendedTarget: plan.recommendedTarget,
  };
}

function fallbackPlan(facts: RepoFacts, lanes: LaneResult[]): BootstrapPlan {
  const report = buildBootstrapReport(facts, lanes, [
    "Fallback plan used because synthesis was unavailable or invalid.",
  ]);

  return {
    files: {
      ".pi/settings.json": `${JSON.stringify(buildSettingsObject(facts), null, 2)}\n`,
      ".pi/agents/planner.md": plannerTemplate(facts),
      ".pi/agents/worker.md": workerTemplate(facts),
      ".pi/agents/reviewer.md": reviewerTemplate(facts),
      ".pi/agents/teams.yaml": teamsTemplate(facts),
      ".pi/agents/pipelines.yaml": pipelinesTemplate(facts),
      "docs/pi-local-workflow.md": localWorkflowTemplate(facts),
      ".pi/bootstrap-report.md": report,
    },
    recommendedTarget: inferRecommendedTarget(facts, lanes),
    notes: ["fallback-plan"],
  };
}

function buildSettingsObject(facts: RepoFacts): Record<string, unknown> {
  const settings: Record<string, unknown> = {
    skills: [],
    prompts: [],
    extensions: [],
    themes: [],
  };

  const deps = new Set([...facts.dependencies, ...facts.devDependencies].map((value) => value.toLowerCase()));
  const promptHints: string[] = [];

  if (deps.has("next") || deps.has("nextjs")) {
    promptHints.push("Focus on Next.js app router and RSC boundaries when planning changes.");
  }

  if (deps.has("vitest") || deps.has("jest")) {
    promptHints.push("Keep testing changes aligned with existing test runner conventions.");
  }

  if (promptHints.length > 0) {
    settings.prompts = promptHints;
  }

  return settings;
}

function buildBootstrapReport(facts: RepoFacts, lanes: LaneResult[], notes: string[]): string {
  const laneSection = lanes.length
    ? lanes
        .map((lane) => {
          const status = lane.ok ? "ok" : `failed (${lane.error ?? "unknown"})`;
          return [
            `## ${lane.name}`,
            `- model: ${lane.model}`,
            `- thinking: ${lane.thinking}`,
            `- status: ${status}`,
            `- elapsed: ${Math.round(lane.elapsedMs / 1000)}s`,
            "",
            truncateForSynthesis(lane.output || lane.error || "(no output)", 2000),
          ].join("\n");
        })
        .join("\n\n---\n\n")
    : "(no lanes executed)";

  return [
    "# Pi Bootstrap Report",
    "",
    `- Domain: ${facts.domain}`,
    `- Repo: ${facts.repoRoot}`,
    `- Generated: ${new Date().toISOString()}`,
    `- Package manager: ${facts.packageManager}`,
    `- Stack hints: ${facts.stackHints.join(", ") || "none"}`,
    "",
    "## Notes",
    ...notes.map((note) => `- ${note}`),
    "",
    "## Lane Evidence",
    laneSection,
    "",
  ].join("\n");
}

async function collectRepoFacts(repoRoot: string, domain: string): Promise<RepoFacts> {
  const topEntries = await readdir(repoRoot, { withFileTypes: true }).catch(() => []);
  const topLevelFiles = topEntries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort()
    .slice(0, 60);
  const topLevelDirs = topEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .slice(0, 60);

  const packageJsonPath = path.join(repoRoot, "package.json");
  const packageJson = existsSync(packageJsonPath)
    ? await readFile(packageJsonPath, "utf8").then((raw) => JSON.parse(raw) as any).catch(() => null)
    : null;

  const scripts = packageJson?.scripts ? Object.keys(packageJson.scripts).sort() : [];
  const dependencies = packageJson?.dependencies ? Object.keys(packageJson.dependencies).sort() : [];
  const devDependencies = packageJson?.devDependencies ? Object.keys(packageJson.devDependencies).sort() : [];

  const workflowDir = path.join(repoRoot, ".github", "workflows");
  const workflowFiles = existsSync(workflowDir)
    ? await readdir(workflowDir).then((items) => items.sort()).catch(() => [])
    : [];

  const readmePath = ["README.md", "readme.md", "README.MD"]
    .map((name) => path.join(repoRoot, name))
    .find((candidate) => existsSync(candidate));

  const readmeSnippet = readmePath
    ? await readFile(readmePath, "utf8")
        .then((raw) => raw.slice(0, 2500))
        .catch(() => "")
    : "";

  const packageManager = detectPackageManager(repoRoot, topLevelFiles);
  const stackHints = detectStackHints(topLevelFiles, dependencies, devDependencies, topLevelDirs);

  return {
    domain,
    repoRoot,
    topLevelFiles,
    topLevelDirs,
    packageManager,
    scripts,
    dependencies,
    devDependencies,
    workflowFiles,
    stackHints,
    readmeSnippet,
  };
}

function buildRepoScoutPrompt(facts: RepoFacts): string {
  return [
    "Lane: repo-scout",
    "Goal: deeply understand this repository and propose a repository-specific local Pi workflow foundation.",
    "",
    "Instructions:",
    "- Inspect repository structure, scripts, CI workflows, and architecture-critical files.",
    "- Infer how work is actually done (build, test, lint, release).",
    "- Propose specific planner/worker/reviewer behavior tailored to this repo.",
    "- Keep output concise but concrete.",
    "",
    "Output format:",
    "## Repo Profile",
    "## Toolchain + Quality Gates",
    "## Architecture Map",
    "## Risks and Constraints",
    "## Pi Local Config Recommendations",
    "",
    "Repository facts to start from:",
    formatRepoFacts(facts),
  ].join("\n");
}

function buildDocsResearchPrompt(facts: RepoFacts): string {
  return [
    "Lane: docs-research",
    "Goal: gather current best-practice documentation relevant to this repository's stack.",
    "",
    "Instructions:",
    "- Use web_search for official docs and migration guides.",
    "- Prioritize concrete guidance for this repo's frameworks/tooling.",
    "- Include URLs for every factual recommendation.",
    "",
    "Output format:",
    "## High-Value Docs",
    "- item with url and why it matters",
    "## Best-Practice Implications for Repo",
    "## Config and Workflow Recommendations",
    "",
    `Stack hints: ${facts.stackHints.join(", ") || "unknown"}`,
    `Package manager: ${facts.packageManager}`,
    `Scripts: ${facts.scripts.join(", ") || "none"}`,
  ].join("\n");
}

function buildMarketResearchPrompt(facts: RepoFacts): string {
  return [
    "Lane: market-research",
    "Goal: infer product/domain expectations and operator workflow needs for this repository.",
    "",
    "Instructions:",
    "- Infer product category from repo facts and readme.",
    "- Use web_search for current market expectations and relevant engineering conventions.",
    "- Keep this practical for agent workflow design (not generic market fluff).",
    "",
    "Output format:",
    "## Product/Domain Inference",
    "## Market and User Expectations",
    "## Implications for Pi Agent Setup",
    "",
    "Repository facts:",
    formatRepoFacts(facts),
  ].join("\n");
}

function buildWorkflowCriticPrompt(facts: RepoFacts): string {
  return [
    "Lane: workflow-critic",
    "Goal: stress-test the bootstrap foundation and identify failure modes before it is written.",
    "",
    "Instructions:",
    "- Identify what could go wrong with naive planner/worker/reviewer setup for this repo.",
    "- Call out missing gates, risky loops, and maintainability pitfalls.",
    "- Propose concrete mitigations in local teams/pipelines.",
    "",
    "Output format:",
    "## Critical Failure Modes",
    "## Missing Controls",
    "## Recommended Safeguards",
    "",
    "Repository facts:",
    formatRepoFacts(facts),
  ].join("\n");
}

function formatRepoFacts(facts: RepoFacts): string {
  return [
    `domain=${facts.domain}`,
    `repoRoot=${facts.repoRoot}`,
    `packageManager=${facts.packageManager}`,
    `stackHints=${facts.stackHints.join(", ") || "none"}`,
    `scripts=${facts.scripts.join(", ") || "none"}`,
    `dependencies(sample)=${facts.dependencies.slice(0, 30).join(", ") || "none"}`,
    `devDependencies(sample)=${facts.devDependencies.slice(0, 30).join(", ") || "none"}`,
    `workflows=${facts.workflowFiles.join(", ") || "none"}`,
    `topLevelFiles=${facts.topLevelFiles.join(", ") || "none"}`,
    `topLevelDirs=${facts.topLevelDirs.join(", ") || "none"}`,
    "readmeSnippet:",
    facts.readmeSnippet || "(none)",
  ].join("\n");
}

async function runPiPrompt(options: {
  cwd: string;
  model: string;
  thinking: ThinkingLevel;
  task: string;
  tools: string[];
  extensions?: string[];
}): Promise<PiRunResult> {
  const started = Date.now();

  const args: string[] = [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--no-extensions",
    "--tools",
    options.tools.join(","),
    "--model",
    options.model,
    "--thinking",
    options.thinking,
  ];

  for (const extensionPath of options.extensions ?? []) {
    args.push("-e", extensionPath);
  }

  args.push(options.task);

  return await new Promise<PiRunResult>((resolve) => {
    const proc = spawn("pi", args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: process.env,
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let latestAssistantText = "";
    let stopError = "";

    proc.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const parsed = parseAssistantEvent(line);
        if (!parsed) {
          continue;
        }
        if (parsed.text) {
          latestAssistantText = parsed.text;
        }
        if (parsed.error) {
          stopError = parsed.error;
        }
      }
    });

    proc.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
    });

    proc.on("close", (code) => {
      if (stdoutBuffer.trim()) {
        const parsed = parseAssistantEvent(stdoutBuffer.trim());
        if (parsed?.text) {
          latestAssistantText = parsed.text;
        }
        if (parsed?.error) {
          stopError = parsed.error;
        }
      }

      const elapsedMs = Date.now() - started;
      const stderrLine = firstNonEmptyLine(stderrBuffer);

      if ((code ?? 1) !== 0) {
        resolve({
          ok: false,
          output: latestAssistantText,
          error: stopError || stderrLine || `pi exited with code ${code}`,
          elapsedMs,
        });
        return;
      }

      if (stopError) {
        resolve({
          ok: false,
          output: latestAssistantText,
          error: stopError,
          elapsedMs,
        });
        return;
      }

      resolve({
        ok: true,
        output: latestAssistantText,
        elapsedMs,
      });
    });

    proc.on("error", (error) => {
      resolve({
        ok: false,
        output: latestAssistantText,
        error: error.message,
        elapsedMs: Date.now() - started,
      });
    });
  });
}

function parseAssistantEvent(line: string): { text?: string; error?: string } | null {
  if (!line.trim()) {
    return null;
  }

  try {
    const event = JSON.parse(line) as { type?: string; message?: Message };
    if (event.type !== "message_end" || !event.message || event.message.role !== "assistant") {
      return null;
    }

    const text = extractAssistantText(event.message);
    const error = event.message.errorMessage ||
      (event.message.stopReason === "error" || event.message.stopReason === "aborted"
        ? event.message.stopReason
        : "");

    return {
      text,
      error: error || undefined,
    };
  } catch {
    return null;
  }
}

function parseBootstrapPlan(raw: string): BootstrapPlan | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const candidates = [
    trimmed,
    extractCodeFence(trimmed),
    extractJsonObject(trimmed),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as BootstrapPlan;
      if (!parsed || typeof parsed !== "object" || typeof parsed.files !== "object" || !parsed.files) {
        continue;
      }
      return parsed;
    } catch {
      continue;
    }
  }

  return null;
}

function extractCodeFence(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match?.[1]?.trim() || "";
}

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start < 0) {
    return "";
  }

  let depth = 0;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return "";
}

async function detectRepoRoot(pi: ExtensionAPI, cwd: string): Promise<string> {
  const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    timeout: 15_000,
  });

  if (result.code === 0) {
    const root = result.stdout.trim();
    if (root) {
      return root;
    }
  }

  return cwd;
}

async function writePlannedFile(
  filePath: string,
  content: string,
  force: boolean,
  changes: BootstrapChange[],
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });

  if (!existsSync(filePath)) {
    await writeFile(filePath, content, "utf8");
    changes.push({ path: filePath, action: "created" });
    return;
  }

  const current = await readFile(filePath, "utf8");
  if (current === content) {
    changes.push({ path: filePath, action: "skipped", reason: "already up to date" });
    return;
  }

  if (!force) {
    changes.push({ path: filePath, action: "skipped", reason: "exists (use --force to overwrite)" });
    return;
  }

  await writeFile(filePath, content, "utf8");
  changes.push({ path: filePath, action: "updated", reason: "overwritten by --force" });
}

function resolveOutputPath(repoRoot: string, relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) {
    return null;
  }

  const absolute = path.resolve(repoRoot, normalized);
  const rel = path.relative(repoRoot, absolute);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  return absolute;
}

function detectPackageManager(repoRoot: string, topLevelFiles: string[]): string {
  if (topLevelFiles.includes("pnpm-lock.yaml")) {
    return "pnpm";
  }
  if (topLevelFiles.includes("yarn.lock")) {
    return "yarn";
  }
  if (topLevelFiles.includes("bun.lock") || topLevelFiles.includes("bun.lockb")) {
    return "bun";
  }
  if (topLevelFiles.includes("package-lock.json")) {
    return "npm";
  }
  if (topLevelFiles.includes("go.mod")) {
    return "go";
  }
  if (topLevelFiles.includes("pyproject.toml") || topLevelFiles.includes("requirements.txt")) {
    return "python";
  }
  return "unknown";
}

function detectStackHints(
  topLevelFiles: string[],
  dependencies: string[],
  devDependencies: string[],
  topLevelDirs: string[],
): string[] {
  const hints = new Set<string>();
  const deps = new Set([...dependencies, ...devDependencies].map((item) => item.toLowerCase()));

  if (deps.has("next")) hints.add("nextjs");
  if (deps.has("react")) hints.add("react");
  if (deps.has("typescript") || topLevelFiles.includes("tsconfig.json")) hints.add("typescript");
  if (deps.has("vitest")) hints.add("vitest");
  if (deps.has("jest")) hints.add("jest");
  if (deps.has("playwright")) hints.add("playwright");
  if (deps.has("tailwindcss")) hints.add("tailwindcss");
  if (topLevelFiles.includes("go.mod")) hints.add("go");
  if (topLevelFiles.includes("pyproject.toml")) hints.add("python");
  if (topLevelDirs.includes("apps") || topLevelDirs.includes("packages")) hints.add("monorepo");

  return Array.from(hints.values()).sort();
}

function inferRecommendedTarget(facts: RepoFacts, lanes: LaneResult[]): string {
  const deps = new Set([...facts.dependencies, ...facts.devDependencies].map((value) => value.toLowerCase()));
  const laneText = lanes.map((lane) => lane.output.toLowerCase()).join("\n");

  if (/(journal|diary|reflection|daybook)/.test(laneText)) {
    return "daybook";
  }

  if (/(issue-to-pr|autopilot|merge gate)/.test(laneText)) {
    return "autopilot";
  }

  if (deps.size === 0 && facts.stackHints.length === 0) {
    return "research";
  }

  return "build";
}

function plannerTemplate(facts: RepoFacts): string {
  return [
    "---",
    "name: planner",
    `description: ${facts.domain} planning specialist grounded in local architecture and workflow constraints`,
    "tools: read, grep, find, ls",
    "---",
    "",
    "You are the repo-local planner.",
    "",
    "Repo context:",
    `- package manager: ${facts.packageManager}`,
    `- stack hints: ${facts.stackHints.join(", ") || "none"}`,
    `- scripts: ${facts.scripts.join(", ") || "none"}`,
    "",
    "Goal: produce concrete, file-level plans that can be executed directly.",
    "",
    "Output:",
    "1. Goal",
    "2. Ordered implementation steps",
    "3. Files to modify",
    "4. Verification plan",
    "5. Risks + mitigations",
    "",
  ].join("\n");
}

function workerTemplate(facts: RepoFacts): string {
  return [
    "---",
    "name: worker",
    `description: ${facts.domain} implementation specialist aligned with local quality gates`,
    "tools: read, grep, find, ls, bash, edit, write",
    "---",
    "",
    "You are the repo-local worker.",
    "",
    "Execution constraints:",
    `- package manager: ${facts.packageManager}`,
    `- primary scripts: ${facts.scripts.join(", ") || "none"}`,
    "",
    "Goal: execute requested plans with minimal scope creep and explicit verification.",
    "",
    "Output:",
    "1. Completed work",
    "2. Files changed",
    "3. Verification commands + outcomes",
    "4. Residual risk",
    "",
  ].join("\n");
}

function reviewerTemplate(facts: RepoFacts): string {
  return [
    "---",
    "name: reviewer",
    `description: ${facts.domain} review specialist for correctness, risk, and maintainability`,
    "tools: read, grep, find, ls, bash",
    "---",
    "",
    "You are the repo-local reviewer.",
    "",
    "Review focus:",
    `- stack hints: ${facts.stackHints.join(", ") || "none"}`,
    `- quality scripts: ${facts.scripts.filter((script) => /test|lint|type|check|build/i.test(script)).join(", ") || "none"}`,
    "",
    "Goal: identify critical correctness and risk issues before merge.",
    "",
    "Output:",
    "1. Files reviewed",
    "2. Critical findings",
    "3. Warnings",
    "4. Summary verdict",
    "",
  ].join("\n");
}

function teamsTemplate(_facts: RepoFacts): string {
  return [
    "core:",
    "  - planner",
    "  - worker",
    "  - reviewer",
    "",
    "delivery:",
    "  - planner",
    "  - worker",
    "  - reviewer",
    "",
  ].join("\n");
}

function pipelinesTemplate(facts: RepoFacts): string {
  const verificationHint = facts.scripts
    .filter((script) => /test|lint|type|check|build/i.test(script))
    .slice(0, 3)
    .join(", ");

  return [
    "repo-delivery-v1:",
    '  description: "Repo-local plan -> build -> review flow"',
    "  steps:",
    "    - agent: planner",
    '      prompt: "Create an implementation plan for: $INPUT"',
    "    - agent: worker",
    `      prompt: "Execute this plan with focused changes and verification (${verificationHint || "repo checks"}):\\n\\n$INPUT"`,
    "    - agent: reviewer",
    '      prompt: "Review this implementation for correctness, risk, and maintainability:\\n\\n$INPUT"',
    "",
  ].join("\n");
}

function localWorkflowTemplate(facts: RepoFacts): string {
  return [
    "# Pi Local Workflow",
    "",
    `This repository is bootstrapped for ${facts.domain} using repo-local Pi config under \.pi/.`,
    "",
    "## Recommended run pattern",
    "",
    "1. Use meta mode only when changing architecture/config patterns:",
    "   - `pictl meta`",
    "2. Use build mode for normal product work:",
    "   - `pictl build`",
    "3. Run local pipelines from this repo:",
    "   - `/pipeline repo-delivery-v1 <goal>`",
    "",
    "## Local artifacts",
    "",
    "- `.pi/settings.json`",
    "- `.pi/agents/*.md`",
    "- `.pi/agents/teams.yaml`",
    "- `.pi/agents/pipelines.yaml`",
    "- `.pi/bootstrap-report.md`",
    "",
  ].join("\n");
}

function formatBootstrapSummary(result: BootstrapResult): string {
  const created = result.changes.filter((item) => item.action === "created").length;
  const updated = result.changes.filter((item) => item.action === "updated").length;
  const skipped = result.changes.filter((item) => item.action === "skipped").length;

  const lines = [
    `bootstrap-repo (${result.domain})`,
    `repo: ${result.repoRoot}`,
    `mode: ${result.quick ? "quick" : "intelligent"}`,
    `recommended target: pictl ${result.recommendedTarget}`,
    `created=${created} updated=${updated} skipped=${skipped}`,
  ];

  if (result.lanes.length > 0) {
    lines.push("lanes:");
    for (const lane of result.lanes) {
      lines.push(
        `- ${lane.name}: ${lane.ok ? "ok" : "failed"} model=${lane.model} elapsed=${Math.round(
          lane.elapsedMs / 1000,
        )}s${lane.error ? ` error=${lane.error}` : ""}`,
      );
    }
  }

  if (result.notes.length > 0) {
    lines.push("notes:");
    for (const note of result.notes) {
      lines.push(`- ${note}`);
    }
  }

  for (const change of result.changes) {
    const rel = path.relative(result.repoRoot, change.path) || change.path;
    lines.push(`- ${change.action}: ${rel}${change.reason ? ` (${change.reason})` : ""}`);
  }

  return lines.join("\n");
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

function truncateForSynthesis(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function firstNonEmptyLine(text: string): string | null {
  const line = text
    .split("\n")
    .map((value) => value.trim())
    .find(Boolean);
  return line ?? null;
}

function sanitizeDomain(value: string): string {
  const cleaned = value.trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "").toLowerCase();
  return cleaned || "project";
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function getConfigDir(): string {
  return (
    process.env.PI_CONFIG_DIR ??
    process.env.PI_CODING_AGENT_DIR ??
    path.join(homedir(), ".pi", "agent")
  );
}
