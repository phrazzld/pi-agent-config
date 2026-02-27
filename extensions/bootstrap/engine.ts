import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import type { Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { sanitizeDomain } from "./args";
import {
  createBootstrapProgressTracker,
  formatElapsed,
  type BootstrapProgressTracker,
} from "./progress";
import { type DelegatedHealthSummary } from "../shared/delegated-health";
import {
  runDelegatedCommand,
  type DelegatedRunOutcome,
  type DelegatedRunnerProgressMarker,
} from "../shared/delegation-runner";
import {
  createQuorumState,
  DEFAULT_RECOVERY_POLICY,
  evaluateQuorum,
  evaluateRecovery,
  classifyRecoveryReason,
  isSuccessfulOutcome,
  resolveTaskRecoveryPolicy,
  sleep,
  totalAllowedAttempts,
} from "../shared/delegation-recovery";

export type ChangeAction = "created" | "updated" | "skipped";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface BootstrapChange {
  path: string;
  action: ChangeAction;
  reason?: string;
}

export interface LaneResult {
  name: string;
  model: string;
  thinking: ThinkingLevel;
  ok: boolean;
  elapsedMs: number;
  output: string;
  error?: string;
}

export interface BootstrapResult {
  repoRoot: string;
  domain: string;
  force: boolean;
  mode: string;
  lanes: LaneResult[];
  synthesisModel: string;
  recommendedTarget: string;
  notes: string[];
  changes: BootstrapChange[];
  qualityGate: BootstrapQualityGate;
  elapsedMs: number;
}

export interface BootstrapPlan {
  files: Record<string, string>;
  notes?: string[];
  recommendedTarget?: string;
}

export interface RepoFacts {
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
  localContextSummary: string;
}

export interface AmbitionCheckpointScore {
  novelty: number;
  feasibility: number;
  evidence: number;
  rollbackability: number;
  total: number;
  pass: boolean;
  missingElements: string[];
}

export interface ConsensusQualityCheck {
  name: string;
  blocking: boolean;
  weight: number;
  earned: number;
  pass: boolean;
  detail: string;
}

export interface ConsensusQualityValidation {
  score: number;
  pass: boolean;
  checks: ConsensusQualityCheck[];
  blockingIssues: string[];
  warnings: string[];
}

export interface BootstrapQualityGate {
  ambition: AmbitionCheckpointScore;
  consensus: ConsensusQualityValidation;
  pass: boolean;
  notes: string[];
}

interface PiRunResult {
  ok: boolean;
  output: string;
  error?: string;
  elapsedMs: number;
  health?: DelegatedHealthSummary;
}


const MODEL_SCOUT = process.env.PI_BOOTSTRAP_MODEL_SCOUT?.trim() || "openai-codex/gpt-5.3-codex";
const MODEL_CONTEXT = process.env.PI_BOOTSTRAP_MODEL_CONTEXT?.trim() || "openrouter/anthropic/claude-sonnet-4.6";
const MODEL_RESEARCH = process.env.PI_BOOTSTRAP_MODEL_RESEARCH?.trim() || "openrouter/google/gemini-3.1-pro";
const MODEL_CRITIC = process.env.PI_BOOTSTRAP_MODEL_CRITIC?.trim() || "openrouter/anthropic/claude-sonnet-4.6";
const MODEL_IDEATION =
  process.env.PI_BOOTSTRAP_MODEL_IDEATION?.trim() ||
  process.env.PI_BOOTSTRAP_MODEL_MARKET?.trim() ||
  "openrouter/google/gemini-3-flash-preview";
const MODEL_SYNTHESIS = process.env.PI_BOOTSTRAP_MODEL_SYNTHESIS?.trim() || "openai-codex/gpt-5.3-codex";

const REQUIRED_FILES = [
  ".pi/settings.json",
  ".pi/persona.md",
  ".pi/agents/planner.md",
  ".pi/agents/worker.md",
  ".pi/agents/reviewer.md",
  ".pi/agents/teams.yaml",
  ".pi/agents/pipelines.yaml",
  ".pi/prompts/discover.md",
  ".pi/prompts/design.md",
  ".pi/prompts/deliver.md",
  ".pi/prompts/review.md",
  "AGENTS.md",
  "docs/pi-local-workflow.md",
  ".pi/bootstrap-report.md",
] as const;

type RequiredBootstrapFilePath = (typeof REQUIRED_FILES)[number];

const REQUIRED_CONSENSUS_LANES = [
  "repo-scout",
  "context-bridge",
  "workflow-critic",
  "implementation-critic",
  "ambition-pass",
] as const;

const AMBITION_MIN_SCORE = 65;
const CONSENSUS_MIN_SCORE = 70;

const PLACEHOLDER_VALUES = new Set([
  "",
  "-",
  "n/a",
  "na",
  "none",
  "tbd",
  "todo",
  "unknown",
]);

export async function bootstrapRepo(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  options: { domain: string; force: boolean },
): Promise<BootstrapResult> {
  const startedAtMs = Date.now();
  const repoRoot = await detectRepoRoot(pi, ctx.cwd);
  const domain = sanitizeDomain(options.domain);
  const mode = bootstrapModeLabel();

  const progress = createBootstrapProgressTracker(ctx, {
    repoRoot,
    domain,
    mode,
    force: options.force,
  });

  ctx.ui.notify(`bootstrap-repo started (${mode}) for ${domain}`, "info");

  try {
    progress.setPhase("collecting repository facts");
    const facts = await collectRepoFacts(repoRoot, domain);

    let lanes: LaneResult[] = [];
    let notes: string[] = [];
    let recommendedTarget = "build";
    let plan: BootstrapPlan | null = null;

    progress.setPhase("running autonomous lanes", "opinionated max mode");
    lanes = await runBootstrapLanes(pi, repoRoot, facts, ctx, progress);

    progress.setPhase("synthesizing repository-local plan", `model=${MODEL_SYNTHESIS}`);
    const synthesis = await runSynthesisLane(pi, repoRoot, facts, lanes);
    plan = synthesis.plan;
    if (!plan && synthesis.error) {
      notes.push(`synthesis-fallback: ${synthesis.error}`);
    }

    if (!plan) {
      plan = fallbackPlan(facts, lanes);
    }

    let normalized = normalizePlan(plan, facts, lanes);
    recommendedTarget = plan.recommendedTarget || inferRecommendedTarget(facts, lanes);

    let qualityGate = evaluateBootstrapQualityGate(normalized, lanes);
    normalized.files[".pi/bootstrap-report.md"] = applyQualityGateToReport(
      normalized.files[".pi/bootstrap-report.md"],
      qualityGate,
    );

    notes = dedupe([...(normalized.notes ?? []), ...notes, ...qualityGate.notes]);

    if (!qualityGate.consensus.pass) {
      notes = dedupe([...notes, "consensus-quality-fallback: synthesized plan failed consensus gate"]);
      normalized = normalizePlan(fallbackPlan(facts, lanes), facts, lanes);
      qualityGate = evaluateBootstrapQualityGate(normalized, lanes);
      normalized.files[".pi/bootstrap-report.md"] = applyQualityGateToReport(
        normalized.files[".pi/bootstrap-report.md"],
        qualityGate,
      );
      notes = dedupe([...notes, ...(normalized.notes ?? []), ...qualityGate.notes]);
      recommendedTarget = inferRecommendedTarget(facts, lanes);
    } else if (!qualityGate.ambition.pass) {
      notes = dedupe([...notes, `ambition-score-below-threshold:${qualityGate.ambition.total}`]);
    }

    progress.setPhase("writing bootstrap artifacts", `${Object.keys(normalized.files).length} files`);

    const changes: BootstrapChange[] = [];
    const writeWarnings: string[] = [];
    for (const [relativePath, content] of Object.entries(normalized.files)) {
      if (typeof content !== "string") {
        const valueType = describeValueType(content);
        changes.push({
          path: relativePath,
          action: "skipped",
          reason: `invalid content type: ${valueType}`,
        });
        writeWarnings.push(`invalid-file-content:${relativePath}:${valueType}`);
        progress.setWriteProgress(changes);
        continue;
      }

      const absolutePath = resolveOutputPath(repoRoot, relativePath);
      if (!absolutePath) {
        changes.push({
          path: relativePath,
          action: "skipped",
          reason: "blocked unsafe output path",
        });
        progress.setWriteProgress(changes);
        continue;
      }
      const personaManagedPath = relativePath === ".pi/persona.md" || relativePath === "AGENTS.md";
      const allowOverwrite = options.force || personaManagedPath;
      const overwriteReason = options.force
        ? "overwritten by --force"
        : personaManagedPath
        ? "managed persona artifact refreshed"
        : "overwritten by --force";

      await writePlannedFile(absolutePath, content, allowOverwrite, changes, overwriteReason);
      progress.setWriteProgress(changes);
    }

    notes = dedupe([...notes, ...writeWarnings]);

    const elapsedMs = Date.now() - startedAtMs;
    const result = {
      repoRoot,
      domain,
      force: options.force,
      mode,
      lanes,
      synthesisModel: MODEL_SYNTHESIS,
      recommendedTarget,
      notes,
      changes,
      qualityGate,
      elapsedMs,
    } satisfies BootstrapResult;

    const created = changes.filter((item) => item.action === "created").length;
    const updated = changes.filter((item) => item.action === "updated").length;
    const skipped = changes.filter((item) => item.action === "skipped").length;

    progress.setPhase("completed", `created=${created} updated=${updated} skipped=${skipped}`);
    progress.finish();

    return result;
  } catch (error) {
    progress.finish(toErrorMessage(error));
    throw error;
  }
}

async function runBootstrapLanes(
  pi: ExtensionAPI,
  repoRoot: string,
  facts: RepoFacts,
  ctx: ExtensionContext,
  progress?: BootstrapProgressTracker,
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
      name: "context-bridge",
      model: MODEL_CONTEXT,
      thinking: "high",
      useWebSearch: false,
      task: buildContextBridgePrompt(facts),
    },
    {
      name: "docs-research",
      model: MODEL_RESEARCH,
      thinking: "high",
      useWebSearch: true,
      task: buildDocsResearchPrompt(facts),
    },
    {
      name: "workflow-critic",
      model: MODEL_CRITIC,
      thinking: "high",
      useWebSearch: false,
      task: buildWorkflowCriticPrompt(facts),
    },
  ];

  lanes.push(
    {
      name: "ambition-pass",
      model: MODEL_IDEATION,
      thinking: "high",
      useWebSearch: true,
      task: buildAgenticIdeationPrompt(facts),
    },
    {
      name: "implementation-critic",
      model: MODEL_CRITIC,
      thinking: "xhigh",
      useWebSearch: false,
      task: buildImplementationCriticPrompt(facts),
    },
  );

  progress?.setLanes(lanes.map((lane) => ({ name: lane.name, model: lane.model })));
  ctx.ui.notify(`bootstrap-repo running ${lanes.length} lane(s) in parallel…`, "info");

  const results = await Promise.all(
    lanes.map(async (lane) => {
      progress?.markLaneStarted(lane.name);

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

      const result = {
        name: lane.name,
        model: lane.model,
        thinking: lane.thinking,
        ok: run.ok,
        elapsedMs: run.elapsedMs,
        output: run.output,
        error: run.error,
      } satisfies LaneResult;

      progress?.markLaneFinished(result);

      const status = result.ok ? "ok" : "failed";
      const level = result.ok ? "info" : "warning";
      const errorSuffix = result.error ? ` error=${result.error}` : "";
      const message = `bootstrap lane ${result.name}: ${status} elapsed=${Math.round(result.elapsedMs / 1000)}s${errorSuffix}`;
      ctx.ui.notify(truncateForSynthesis(message, 220), level);

      return result;
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
    "Goal: produce the most effective repo-local Pi foundation for THIS repository.",
    "Approach: leverage evidence, model intelligence, and minimal rigid rules.",
    "",
    "Success criteria:",
    "- Repo-specific: grounded in repository facts and lane evidence.",
    "- Focused: explicit local opt-ins and auditable config.",
    "- Agentic: provide prompts, agent overlays, and pipelines for explore -> design -> implement -> review loops.",
    "- Practical: avoid over-prescriptive scripts; use role + objective + success criteria contracts.",
    "- Ambitious: include a single highest-leverage, radically accretive addition with a 72h validation experiment and kill criteria.",
    "- Safe: align with local quality gates, tooling, and project conventions.",
    "",
    "Return STRICT JSON only (no markdown fences) with this exact shape:",
    "{",
    '  "files": {',
    '    ".pi/settings.json": "...",',
    '    ".pi/persona.md": "...",',
    '    ".pi/agents/planner.md": "...",',
    '    ".pi/agents/worker.md": "...",',
    '    ".pi/agents/reviewer.md": "...",',
    '    ".pi/agents/teams.yaml": "...",',
    '    ".pi/agents/pipelines.yaml": "...",',
    '    ".pi/prompts/discover.md": "...",',
    '    ".pi/prompts/design.md": "...",',
    '    ".pi/prompts/deliver.md": "...",',
    '    ".pi/prompts/review.md": "...",',
    '    "docs/pi-local-workflow.md": "...",',
    '    ".pi/bootstrap-report.md": "..."',
    "  },",
    '  "recommendedTarget": "build|research|autopilot|daybook",',
    '  "notes": ["..."]',
    "}",
    "",
    "Requirements:",
    "- settings.json must be valid JSON with explicit local intent.",
    "- .pi/persona.md should define the local repo persona, tone, and decision posture.",
    "- settings.prompts must explicitly allow-list local prompts via + paths.",
    "- Teams and pipelines must only reference agents that exist in files output.",
    "- Include at least one repo-specific delivery pipeline.",
    "- Include concise rationale in .pi/bootstrap-report.md with lane evidence references.",
    "- .pi/bootstrap-report.md MUST include section `Single Highest-Leverage Addition` with labeled bullets:",
    "  - Idea:",
    "  - Source lane:",
    "  - Why now:",
    "  - 72h validation experiment:",
    "  - Kill criteria:",
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

export function evaluateBootstrapQualityGate(plan: BootstrapPlan, lanes: LaneResult[]): BootstrapQualityGate {
  const report = plan.files[".pi/bootstrap-report.md"] ?? "";
  const ambition = scoreAmbitionCheckpoint(report, lanes);
  const consensus = evaluateConsensusQuality(plan, lanes);

  const notes = dedupe([
    `ambition-score:${ambition.total}`,
    `consensus-score:${consensus.score}`,
    ...ambition.missingElements.map((item) => `ambition-missing:${item}`),
    ...consensus.blockingIssues.map((issue) => `consensus-block:${issue}`),
    ...consensus.warnings.map((warning) => `consensus-warn:${warning}`),
  ]);

  return {
    ambition,
    consensus,
    pass: ambition.pass && consensus.pass,
    notes,
  };
}

export function scoreAmbitionCheckpoint(report: string, lanes: LaneResult[]): AmbitionCheckpointScore {
  const section = extractMarkdownSection(report, "Single Highest-Leverage Addition");
  const idea = extractLabeledBullet(section, "Idea");
  const sourceLane = extractLabeledBullet(section, "Source lane");
  const whyNow = extractLabeledBullet(section, "Why now");
  const validation = extractLabeledBullet(section, "72h validation experiment");
  const killCriteria = extractLabeledBullet(section, "Kill criteria");

  const ambitionLane = lanes.find((lane) => lane.name === "ambition-pass");
  const ambitionEvidence = `${section}\n${ambitionLane?.output ?? ""}`.toLowerCase();

  let novelty = 0;
  if (isSubstantiveValue(idea, 18)) {
    novelty += 2;
  }
  if (idea.trim().length >= 80) {
    novelty += 1;
  }
  if (/(innovative|novel|compound|flywheel|automation|leverage|accretive|radical)/i.test(ambitionEvidence)) {
    novelty += 2;
  }
  novelty = Math.min(5, novelty);

  let feasibility = 0;
  if (isSubstantiveValue(whyNow, 20)) {
    feasibility += 2;
  }
  if (isSubstantiveValue(validation, 24)) {
    feasibility += 2;
  }
  if (/(72\s*h|72-hour|3\s*day|timebox|pilot)/i.test(validation)) {
    feasibility += 1;
  }
  feasibility = Math.min(5, feasibility);

  let evidence = 0;
  if (/ambition-pass/i.test(sourceLane)) {
    evidence += 2;
  }
  if (/##\s*Lane Evidence/i.test(report)) {
    evidence += 1;
  }
  if (ambitionLane?.ok && ambitionLane.output.trim().length >= 120) {
    evidence += 1;
  }
  if (/(https?:\/\/|evidence|reference|source)/i.test(ambitionEvidence)) {
    evidence += 1;
  }
  evidence = Math.min(5, evidence);

  let rollbackability = 0;
  if (isSubstantiveValue(killCriteria, 20)) {
    rollbackability += 3;
  }
  if (/(rollback|revert|disable|opt-?out|remove|stop|abort)/i.test(killCriteria)) {
    rollbackability += 2;
  }
  rollbackability = Math.min(5, rollbackability);

  const missingElements: string[] = [];
  if (!isSubstantiveValue(idea, 18)) {
    missingElements.push("idea");
  }
  if (!/ambition-pass/i.test(sourceLane)) {
    missingElements.push("source lane");
  }
  if (!isSubstantiveValue(whyNow, 20)) {
    missingElements.push("why now");
  }
  if (!isSubstantiveValue(validation, 24)) {
    missingElements.push("72h validation experiment");
  }
  if (!isSubstantiveValue(killCriteria, 20)) {
    missingElements.push("kill criteria");
  }

  const totalRaw = novelty + feasibility + evidence + rollbackability;
  const total = Math.round((totalRaw / 20) * 100);
  const hardRequirementsMet =
    !missingElements.includes("72h validation experiment") &&
    !missingElements.includes("kill criteria") &&
    !missingElements.includes("source lane");

  return {
    novelty,
    feasibility,
    evidence,
    rollbackability,
    total,
    pass: total >= AMBITION_MIN_SCORE && hardRequirementsMet,
    missingElements,
  };
}

export function evaluateConsensusQuality(plan: BootstrapPlan, lanes: LaneResult[]): ConsensusQualityValidation {
  const checks: ConsensusQualityCheck[] = [];
  const files = (plan.files ?? {}) as Record<string, unknown>;

  const missingRequired = REQUIRED_FILES.filter((filePath) => !isNonEmptyString(files[filePath]));
  checks.push(
    qualityCheck(
      "required-artifacts",
      30,
      missingRequired.length === 0 ? 30 : 0,
      missingRequired.length === 0,
      true,
      missingRequired.length === 0
        ? "all required bootstrap artifacts are present"
        : `missing: ${missingRequired.join(", ")}`,
    ),
  );

  const declaredAgents = collectDeclaredAgentNames(files);
  const teamAgentRefs = extractTeamAgentReferences(asString(files[".pi/agents/teams.yaml"]));
  const pipelineAgentRefs = extractPipelineAgentReferences(asString(files[".pi/agents/pipelines.yaml"]));

  const unknownTeamAgents = teamAgentRefs.filter((agent) => !declaredAgents.has(agent));
  checks.push(
    qualityCheck(
      "teams-agent-integrity",
      15,
      unknownTeamAgents.length === 0 ? 15 : 0,
      unknownTeamAgents.length === 0,
      true,
      unknownTeamAgents.length === 0
        ? "all team agents resolve to generated overlays"
        : `unknown team agents: ${unknownTeamAgents.join(", ")}`,
    ),
  );

  const unknownPipelineAgents = pipelineAgentRefs.filter((agent) => !declaredAgents.has(agent));
  checks.push(
    qualityCheck(
      "pipelines-agent-integrity",
      15,
      unknownPipelineAgents.length === 0 ? 15 : 0,
      unknownPipelineAgents.length === 0,
      true,
      unknownPipelineAgents.length === 0
        ? "all pipeline agents resolve to generated overlays"
        : `unknown pipeline agents: ${unknownPipelineAgents.join(", ")}`,
    ),
  );

  const laneSuccess = REQUIRED_CONSENSUS_LANES.filter((laneName) => {
    const lane = lanes.find((candidate) => candidate.name === laneName);
    return Boolean(lane?.ok && lane.output.trim().length >= 80);
  }).length;
  const laneCoverageWeight = 20;
  const laneCoverageEarned = Math.round((laneSuccess / REQUIRED_CONSENSUS_LANES.length) * laneCoverageWeight);
  checks.push(
    qualityCheck(
      "lane-coverage",
      laneCoverageWeight,
      laneCoverageEarned,
      laneSuccess >= 4,
      laneSuccess < 3,
      `${laneSuccess}/${REQUIRED_CONSENSUS_LANES.length} required lanes produced substantive outputs`,
    ),
  );

  const criticLanes = ["workflow-critic", "implementation-critic"];
  const criticSuccess = criticLanes.filter((laneName) => {
    const lane = lanes.find((candidate) => candidate.name === laneName);
    return Boolean(lane?.ok && lane.output.trim().length >= 120);
  }).length;
  checks.push(
    qualityCheck(
      "critic-consensus",
      10,
      Math.round((criticSuccess / criticLanes.length) * 10),
      criticSuccess === criticLanes.length,
      criticSuccess === 0,
      `${criticSuccess}/${criticLanes.length} critic lanes provided substantive pressure-testing`,
    ),
  );

  const report = asString(files[".pi/bootstrap-report.md"]);
  const additionSection = extractMarkdownSection(report, "Single Highest-Leverage Addition");
  const hasStructuredAddition = [
    extractLabeledBullet(additionSection, "Idea"),
    extractLabeledBullet(additionSection, "Why now"),
    extractLabeledBullet(additionSection, "72h validation experiment"),
    extractLabeledBullet(additionSection, "Kill criteria"),
  ].every((value) => isSubstantiveValue(value, 14));

  checks.push(
    qualityCheck(
      "ambition-structure",
      10,
      hasStructuredAddition ? 10 : 0,
      hasStructuredAddition,
      false,
      hasStructuredAddition
        ? "ambition section includes substantive idea/why-now/experiment/kill criteria"
        : "ambition section is missing one or more substantive required bullets",
    ),
  );

  const promptFiles = [
    ".pi/prompts/discover.md",
    ".pi/prompts/design.md",
    ".pi/prompts/deliver.md",
    ".pi/prompts/review.md",
  ];
  const weakPrompts = promptFiles.filter((filePath) => asString(files[filePath]).trim().length < 80);

  checks.push(
    qualityCheck(
      "prompt-signal",
      10,
      weakPrompts.length === 0 ? 10 : 0,
      weakPrompts.length === 0,
      false,
      weakPrompts.length === 0
        ? "all local prompt templates meet minimum signal length"
        : `weak prompt templates: ${weakPrompts.join(", ")}`,
    ),
  );

  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const earned = checks.reduce((sum, check) => sum + check.earned, 0);
  const score = totalWeight > 0 ? Math.round((earned / totalWeight) * 100) : 0;

  const blockingIssues = checks
    .filter((check) => check.blocking && !check.pass)
    .map((check) => `${check.name}: ${check.detail}`);
  const warnings = checks
    .filter((check) => !check.blocking && !check.pass)
    .map((check) => `${check.name}: ${check.detail}`);

  return {
    score,
    pass: blockingIssues.length === 0 && score >= CONSENSUS_MIN_SCORE,
    checks,
    blockingIssues,
    warnings,
  };
}

function qualityCheck(
  name: string,
  weight: number,
  earned: number,
  pass: boolean,
  blocking: boolean,
  detail: string,
): ConsensusQualityCheck {
  return {
    name,
    blocking,
    weight,
    earned: Math.max(0, Math.min(weight, earned)),
    pass,
    detail,
  };
}

function collectDeclaredAgentNames(files: Record<string, unknown>): Set<string> {
  const names = new Set<string>();

  for (const filePath of Object.keys(files)) {
    if (!filePath.startsWith(".pi/agents/") || !filePath.endsWith(".md")) {
      continue;
    }
    const base = path.basename(filePath, ".md").trim();
    if (base) {
      names.add(base);
    }
  }

  return names;
}

function extractTeamAgentReferences(yaml: string): string[] {
  if (!yaml.trim()) {
    return [];
  }

  const refs: string[] = [];
  for (const line of yaml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) {
      continue;
    }

    const candidate = trimmed.slice(2).trim();
    if (!candidate || candidate.includes(":")) {
      continue;
    }

    if (/^[a-zA-Z0-9_-]+$/.test(candidate)) {
      refs.push(candidate);
    }
  }

  return dedupe(refs);
}

function extractPipelineAgentReferences(yaml: string): string[] {
  if (!yaml.trim()) {
    return [];
  }

  const refs: string[] = [];
  const pattern = /\bagent\s*:\s*([a-zA-Z0-9_-]+)/g;
  let match: RegExpExecArray | null = pattern.exec(yaml);
  while (match) {
    refs.push(match[1]);
    match = pattern.exec(yaml);
  }

  return dedupe(refs);
}

export function applyQualityGateToReport(report: string | undefined, qualityGate: BootstrapQualityGate): string {
  const withoutExisting = removeMarkdownSection(report ?? "", "Quality Gate Scorecard").trimEnd();
  const scorecard = renderQualityGateScorecard(qualityGate);

  if (!withoutExisting) {
    return ["# Pi Bootstrap Report", "", scorecard, ""].join("\n");
  }

  return [withoutExisting, "", scorecard, ""].join("\n");
}

function renderQualityGateScorecard(qualityGate: BootstrapQualityGate): string {
  const lines = [
    "## Quality Gate Scorecard",
    `- Gate pass: ${qualityGate.pass ? "yes" : "no"}`,
    `- Ambition score: ${qualityGate.ambition.total}/100 (${qualityGate.ambition.pass ? "pass" : "fail"})`,
    `  - novelty: ${qualityGate.ambition.novelty}/5`,
    `  - feasibility: ${qualityGate.ambition.feasibility}/5`,
    `  - evidence: ${qualityGate.ambition.evidence}/5`,
    `  - rollbackability: ${qualityGate.ambition.rollbackability}/5`,
    `- Consensus score: ${qualityGate.consensus.score}/100 (${qualityGate.consensus.pass ? "pass" : "fail"})`,
  ];

  if (qualityGate.ambition.missingElements.length > 0) {
    lines.push("- Ambition gaps:");
    for (const missing of qualityGate.ambition.missingElements) {
      lines.push(`  - ${missing}`);
    }
  }

  if (qualityGate.consensus.blockingIssues.length > 0) {
    lines.push("- Blocking issues:");
    for (const issue of qualityGate.consensus.blockingIssues) {
      lines.push(`  - ${issue}`);
    }
  }

  if (qualityGate.consensus.warnings.length > 0) {
    lines.push("- Warnings:");
    for (const warning of qualityGate.consensus.warnings) {
      lines.push(`  - ${warning}`);
    }
  }

  return lines.join("\n");
}

function removeMarkdownSection(markdown: string, heading: string): string {
  if (!markdown.trim()) {
    return "";
  }

  const lines = markdown.split(/\r?\n/);
  const target = `## ${heading}`.toLowerCase();
  const start = lines.findIndex((line) => line.trim().toLowerCase() === target);
  if (start < 0) {
    return markdown;
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    if (/^##\s+/.test(trimmed) || /^#\s+/.test(trimmed)) {
      end = index;
      break;
    }
  }

  return [...lines.slice(0, start), ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function extractMarkdownSection(markdown: string, heading: string): string {
  if (!markdown.trim()) {
    return "";
  }

  const lines = markdown.split(/\r?\n/);
  const target = `## ${heading}`.toLowerCase();
  const start = lines.findIndex((line) => line.trim().toLowerCase() === target);
  if (start < 0) {
    return "";
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    if (/^##\s+/.test(trimmed) || /^#\s+/.test(trimmed)) {
      end = index;
      break;
    }
  }

  return lines.slice(start + 1, end).join("\n").trim();
}

function extractLabeledBullet(section: string, label: string): string {
  if (!section.trim()) {
    return "";
  }

  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^-\\s*${escaped}\\s*:\\s*(.*)$`, "im");
  const match = section.match(pattern);
  return match?.[1]?.trim() ?? "";
}

function isSubstantiveValue(value: string, minLength: number): boolean {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  if (PLACEHOLDER_VALUES.has(normalized.toLowerCase())) {
    return false;
  }

  const alphaNumCount = normalized.replace(/[^a-zA-Z0-9]/g, "").length;
  return alphaNumCount >= minLength;
}

export function normalizePlan(plan: BootstrapPlan, facts: RepoFacts, lanes: LaneResult[]): BootstrapPlan {
  const sanitized = sanitizePlanFiles(plan.files);
  const files: Record<string, string> = { ...sanitized.files };

  const fallback = buildRequiredFallbackFiles(facts, lanes, [
    "Auto-generated report because synthesized output omitted required artifacts.",
  ]);

  for (const required of REQUIRED_FILES) {
    if (!isNonEmptyString(files[required])) {
      files[required] = fallback[required];
    }
  }

  const settingsRaw = files[".pi/settings.json"];
  try {
    const parsed = JSON.parse(settingsRaw) as Record<string, unknown>;

    if (!Array.isArray(parsed.packages)) parsed.packages = [];
    if (!Array.isArray(parsed.extensions)) parsed.extensions = [];
    if (!Array.isArray(parsed.skills)) parsed.skills = [];
    if (!Array.isArray(parsed.themes)) parsed.themes = [];

    const requiredPromptAllowlist = [
      "+prompts/discover.md",
      "+prompts/design.md",
      "+prompts/deliver.md",
      "+prompts/review.md",
    ];

    const requiredExtensionAllowlist = getRequiredExtensionAllowlist();

    const existingPrompts = Array.isArray(parsed.prompts)
      ? parsed.prompts.filter((value): value is string => typeof value === "string")
      : [];

    const existingExtensions = Array.isArray(parsed.extensions)
      ? parsed.extensions.filter((value): value is string => typeof value === "string")
      : [];

    const promptSet = new Set(existingPrompts);
    for (const requiredPrompt of requiredPromptAllowlist) {
      promptSet.add(requiredPrompt);
    }
    parsed.prompts = Array.from(promptSet.values());

    const extensionSet = new Set(existingExtensions);
    for (const requiredExtension of requiredExtensionAllowlist) {
      extensionSet.add(requiredExtension);
    }
    parsed.extensions = Array.from(extensionSet.values());

    if (typeof parsed.enableSkillCommands !== "boolean") {
      parsed.enableSkillCommands = false;
    }

    files[".pi/settings.json"] = `${JSON.stringify(parsed, null, 2)}\n`;
  } catch {
    files[".pi/settings.json"] = fallback[".pi/settings.json"];
  }

  const notes = dedupe([...(plan.notes ?? []), ...sanitized.notes]);

  return {
    files,
    notes: notes.length > 0 ? notes : undefined,
    recommendedTarget: plan.recommendedTarget,
  };
}

function buildRequiredFallbackFiles(
  facts: RepoFacts,
  lanes: LaneResult[],
  reportNotes: string[],
): Record<RequiredBootstrapFilePath, string> {
  return {
    ".pi/settings.json": `${JSON.stringify(buildSettingsObject(facts), null, 2)}\n`,
    ".pi/persona.md": personaTemplate(facts),
    ".pi/agents/planner.md": plannerTemplate(facts),
    ".pi/agents/worker.md": workerTemplate(facts),
    ".pi/agents/reviewer.md": reviewerTemplate(facts),
    ".pi/agents/teams.yaml": teamsTemplate(facts),
    ".pi/agents/pipelines.yaml": pipelinesTemplate(facts),
    ".pi/prompts/discover.md": discoverPromptTemplate(facts),
    ".pi/prompts/design.md": designPromptTemplate(facts),
    ".pi/prompts/deliver.md": deliverPromptTemplate(facts),
    ".pi/prompts/review.md": reviewPromptTemplate(facts),
    "AGENTS.md": agentsTemplate(facts),
    "docs/pi-local-workflow.md": localWorkflowTemplate(facts),
    ".pi/bootstrap-report.md": buildBootstrapReport(facts, lanes, reportNotes),
  };
}

function fallbackPlan(facts: RepoFacts, lanes: LaneResult[]): BootstrapPlan {
  return {
    files: buildRequiredFallbackFiles(facts, lanes, [
      "Fallback plan used because synthesis was unavailable or invalid.",
    ]),
    recommendedTarget: inferRecommendedTarget(facts, lanes),
    notes: ["fallback-plan"],
  };
}

function sanitizePlanFiles(filesValue: unknown): { files: Record<string, string>; notes: string[] } {
  if (!filesValue || typeof filesValue !== "object") {
    return {
      files: {},
      notes: ["invalid-files-object"],
    };
  }

  const files: Record<string, string> = {};
  const notes: string[] = [];

  for (const [relativePath, content] of Object.entries(filesValue as Record<string, unknown>)) {
    const normalizedPath = relativePath.trim();
    if (!normalizedPath) {
      continue;
    }

    if (typeof content === "string") {
      files[normalizedPath] = content;
      continue;
    }

    notes.push(`invalid-file-content:${normalizedPath}:${describeValueType(content)}`);
  }

  return {
    files,
    notes: dedupe(notes),
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function describeValueType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function buildSettingsObject(_facts: RepoFacts): Record<string, unknown> {
  return {
    packages: [],
    extensions: getRequiredExtensionAllowlist(),
    skills: [],
    prompts: [
      "+prompts/discover.md",
      "+prompts/design.md",
      "+prompts/deliver.md",
      "+prompts/review.md",
    ],
    themes: [],
    enableSkillCommands: false,
  };
}

function getRequiredExtensionAllowlist(): string[] {
  const extensionRoot = path.join(getConfigDir(), "extensions");
  const required = [
    "organic-workflows",
    "profiles",
    "subagent",
    "orchestration",
    "web-search",
  ];

  return required.map((name) => `+${path.join(extensionRoot, name)}`);
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
    "## Repository Context Digest",
    truncateForSynthesis(facts.localContextSummary || "(none)", 6000),
    "",
    "## Single Highest-Leverage Addition",
    "- Idea: Establish a minimal planner -> worker -> reviewer local workflow loop that compounds repo familiarity through memory-first context reuse.",
    "- Source lane: ambition-pass",
    "- Why now: This creates immediate throughput gains with low maintenance while preserving room for optional advanced overlays.",
    "- 72h validation experiment: Run this bootstrap on two active tasks, then compare plan-to-merge latency and rework churn against the prior baseline.",
    "- Kill criteria: If cycle time or defect/rework metrics worsen by more than 15%, roll back to prior local config and revisit assumptions.",
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
    .slice(0, 80);
  const topLevelDirs = topEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .slice(0, 80);

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
  const localContextSummary = await buildLocalContextSummary(repoRoot);

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
    localContextSummary,
  };
}

async function buildLocalContextSummary(repoRoot: string): Promise<string> {
  const snippets = await collectFileSnippets(repoRoot, [
    "AGENTS.md",
    "CLAUDE.md",
    "PROMPT.md",
    "project.md",
    "ARCHITECTURE.md",
    "docs/ARCHITECTURE.md",
  ]);

  const claudeFiles = await collectDirInventory(repoRoot, ".claude", 80);
  const codexFiles = await collectDirInventory(repoRoot, ".codex", 80);
  const localPiFiles = await collectDirInventory(repoRoot, ".pi", 120);
  const scriptFiles = await collectDirInventory(repoRoot, "scripts", 80);

  return [
    "contextSnippets:",
    snippets.length > 0 ? snippets.join("\n\n") : "(none)",
    "",
    ".claude inventory:",
    claudeFiles.length > 0 ? claudeFiles.join(", ") : "(none)",
    "",
    ".codex inventory:",
    codexFiles.length > 0 ? codexFiles.join(", ") : "(none)",
    "",
    ".pi inventory:",
    localPiFiles.length > 0 ? localPiFiles.join(", ") : "(none)",
    "",
    "scripts inventory:",
    scriptFiles.length > 0 ? scriptFiles.join(", ") : "(none)",
  ].join("\n");
}

async function collectFileSnippets(repoRoot: string, relativePaths: string[]): Promise<string[]> {
  const snippets: string[] = [];

  for (const relativePath of relativePaths) {
    const fullPath = path.join(repoRoot, relativePath);
    if (!existsSync(fullPath)) {
      continue;
    }

    const snippet = await readFile(fullPath, "utf8")
      .then((raw) => raw.slice(0, 1500))
      .catch(() => "");

    if (!snippet.trim()) {
      continue;
    }

    snippets.push(`[${relativePath}]\n${snippet}`);
  }

  return snippets;
}

async function collectDirInventory(repoRoot: string, relativeDir: string, maxEntries: number): Promise<string[]> {
  const absoluteDir = path.join(repoRoot, relativeDir);
  if (!existsSync(absoluteDir)) {
    return [];
  }

  const blocked = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", "vendor", ".venv"]);
  const queue: Array<{ dir: string; depth: number }> = [{ dir: absoluteDir, depth: 0 }];
  const files: string[] = [];

  while (queue.length > 0 && files.length < maxEntries) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    const entries = await readdir(current.dir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      const relPath = path.relative(repoRoot, fullPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        if (blocked.has(entry.name) || current.depth >= 3) {
          continue;
        }
        queue.push({ dir: fullPath, depth: current.depth + 1 });
        continue;
      }

      files.push(relPath);
      if (files.length >= maxEntries) {
        break;
      }
    }
  }

  return files;
}

function buildRepoScoutPrompt(facts: RepoFacts): string {
  return [
    "Lane: repo-scout",
    "Role: Staff engineer doing deep repository reconnaissance.",
    "Objective: infer how engineering work really happens here and what Pi foundation would accelerate it.",
    "Latitude: investigate broadly, follow evidence, and use your judgment.",
    "",
    "Success criteria:",
    "- Accurate map of build/test/release/ops workflows.",
    "- Concrete implications for planner/worker/reviewer behavior.",
    "- Focused recommendations for local prompts and pipelines.",
    "",
    "Output contract:",
    "## Repo Profile",
    "## Engineering Workflow Reality",
    "## Quality Gates and Operational Constraints",
    "## High-Leverage Pi Foundation Recommendations",
    "",
    "Repository facts:",
    formatRepoFacts(facts),
  ].join("\n");
}

function buildContextBridgePrompt(facts: RepoFacts): string {
  return [
    "Lane: context-bridge",
    "Role: migration architect bridging existing repo machinery into Pi-native local config.",
    "Objective: decide what to adopt, bridge, or ignore from AGENTS/CLAUDE/.claude/.codex/.pi context.",
    "Latitude: prioritize pragmatic reuse over perfect translation.",
    "",
    "Success criteria:",
    "- Surfaces valuable local conventions and workflows worth preserving.",
    "- Explicit adopt/bridge/ignore decisions with rationale.",
    "- Detects collisions with focused Pi setup and suggests clean resolutions.",
    "",
    "Output contract:",
    "## Existing Context Signals",
    "## Adopt / Bridge / Ignore Decisions",
    "## Conflicts and Resolutions",
    "## Recommendations for Local Pi Artifacts",
    "",
    "Repository facts:",
    formatRepoFacts(facts),
  ].join("\n");
}

function buildDocsResearchPrompt(facts: RepoFacts): string {
  return [
    "Lane: docs-research",
    "Role: standards researcher for this repository's stack.",
    "Objective: gather current official guidance that materially improves local Pi workflows.",
    "Latitude: focus on practical signal, skip generic advice.",
    "",
    "Success criteria:",
    "- Uses current official docs or high-authority references.",
    "- Every factual claim has a URL.",
    "- Recommendations translate into concrete agent/prompt/pipeline behavior.",
    "",
    "Output contract:",
    "## High-Value References",
    "- url + why it matters",
    "## Practical Implications for Agentic Workflow",
    "## Recommended Bootstrap Adjustments",
    "",
    "Stack hints:",
    facts.stackHints.join(", ") || "unknown",
    `Package manager: ${facts.packageManager}`,
    `Scripts: ${facts.scripts.join(", ") || "none"}`,
  ].join("\n");
}

function buildWorkflowCriticPrompt(facts: RepoFacts): string {
  return [
    "Lane: workflow-critic",
    "Role: adversarial reviewer of proposed bootstrap foundations.",
    "Objective: find failure modes, hidden coupling, and safety gaps before config lands.",
    "Latitude: be sharp, specific, and evidence-driven.",
    "",
    "Success criteria:",
    "- Identifies realistic failure paths (quality drift, unsafe defaults, workflow friction).",
    "- Proposes mitigations that are lightweight and enforceable.",
    "- Improves reliability without bloating config.",
    "",
    "Output contract:",
    "## Critical Failure Modes",
    "## Missing Controls",
    "## Lean Safeguards",
    "",
    "Repository facts:",
    formatRepoFacts(facts),
  ].join("\n");
}

function buildAgenticIdeationPrompt(facts: RepoFacts): string {
  return [
    "Lane: ambition-pass",
    "Role: workflow designer optimizing for high-quality agentic engineering throughput.",
    "Objective: propose bold but practical local workflows that compound over repeated usage.",
    "Latitude: think creatively, but keep recommendations shippable in repo-local config.",
    "",
    "Mandatory question:",
    "- What is the single smartest and most radically innovative, accretive, useful, compelling addition to this bootstrap foundation right now?",
    "",
    "Success criteria:",
    "- Produces high-leverage workflow prompts and pipeline patterns.",
    "- Distinguishes must-have foundation from optional enhancements.",
    "- Keeps setup minimal while amplifying agent autonomy.",
    "- Defines one selected ambition addition with 72h validation + kill criteria.",
    "",
    "Output contract:",
    "## Foundation Workflow Pattern",
    "## Prompt + Pipeline Ideas",
    "## Minimal Viable Bootstrap vs Optional Upgrades",
    "## Single Highest-Leverage Addition",
    "",
    "Repository facts:",
    formatRepoFacts(facts),
  ].join("\n");
}

function buildImplementationCriticPrompt(facts: RepoFacts): string {
  return [
    "Lane: implementation-critic",
    "Role: production engineer reviewing whether the bootstrap outputs will be maintainable six months from now.",
    "Objective: pressure test proposed artifacts for durability, clarity, and operator usability.",
    "Latitude: prioritize maintainability and signal over novelty.",
    "",
    "Success criteria:",
    "- Flags unclear prompts, brittle assumptions, or hidden maintenance burden.",
    "- Recommends concise improvements to settings, overlays, and docs.",
    "- Ensures the generated foundation remains auditable and focused.",
    "",
    "Output contract:",
    "## Durability Risks",
    "## Clarity Gaps",
    "## Recommended Tightening",
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
    "",
    "localContext:",
    truncateForSynthesis(facts.localContextSummary || "(none)", 10_000),
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

  const policy = resolveTaskRecoveryPolicy(process.env, {
    ...DEFAULT_RECOVERY_POLICY,
    label: `bootstrap:${options.model}`,
    maxAttempts: Math.max(1, DEFAULT_RECOVERY_POLICY.maxAttempts),
    allowDegraded: true,
    minDegradedOutputLength: 200,
  });
  const totalAttempts = totalAllowedAttempts(policy);
  const quorum = createQuorumState(policy);

  let lastOutcome: DelegatedRunOutcome | null = null;
  let lastOutput = "";
  let lastError = "";

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    const attemptResult = await runPiPromptAttempt({
      cwd: options.cwd,
      args,
      model: options.model,
    });

    lastOutcome = attemptResult.outcome;
    lastOutput = attemptResult.output;
    lastError = attemptResult.error;

    if (isSuccessfulOutcome(attemptResult.outcome)) {
      const quorumDecision = evaluateQuorum(quorum, attemptResult.output, attempt);
      if (quorumDecision.action === "continue") {
        continue;
      }

      const elapsedMs = Date.now() - started;
      if (quorumDecision.action === "fail") {
        return {
          ok: false,
          output: attemptResult.output,
          error: quorumDecision.reason,
          elapsedMs,
          health: attemptResult.outcome.health,
        };
      }

      return {
        ok: true,
        output: quorumDecision.output ?? attemptResult.output,
        elapsedMs,
        health: attemptResult.outcome.health,
      };
    }

    const reason = classifyRecoveryReason(attemptResult.outcome);
    const decision = evaluateRecovery(
      {
        attempt,
        outcome: attemptResult.outcome,
        reason,
        output: attemptResult.output,
      },
      policy,
    );

    if (decision.action === "retry") {
      await sleep(decision.delayMs);
      continue;
    }

    const elapsedMs = Date.now() - started;

    if (decision.action === "complete") {
      return {
        ok: true,
        output: attemptResult.output,
        elapsedMs,
        health: attemptResult.outcome.health,
      };
    }

    return {
      ok: false,
      output: attemptResult.output,
      error: attemptResult.error || decision.reason,
      elapsedMs,
      health: attemptResult.outcome.health,
    };
  }

  const elapsedMs = Date.now() - started;
  return {
    ok: false,
    output: lastOutput,
    error: lastError || "delegated retries exhausted",
    elapsedMs,
    health: lastOutcome?.health,
  };
}

async function runPiPromptAttempt(options: {
  cwd: string;
  args: string[];
  model: string;
}): Promise<{ output: string; error: string; outcome: DelegatedRunOutcome }> {
  let latestAssistantText = "";
  let stopError = "";

  const delegated = await runDelegatedCommand({
    label: `bootstrap:${options.model}`,
    args: options.args,
    cwd: options.cwd,
    env: process.env,
    onStdoutLine: (line) => {
      const parsed = parsePiEvent(line);
      if (!parsed) {
        return;
      }

      if (parsed.text) {
        latestAssistantText = parsed.text;
      }
      if (parsed.error) {
        stopError = parsed.error;
      }

      const marker: DelegatedRunnerProgressMarker = {
        kind: parsed.kind,
        action: parsed.action,
        toolName: parsed.toolName,
        fingerprint: buildBootstrapProgressFingerprint(
          latestAssistantText,
          stopError,
          parsed.kind,
        ),
      };

      return { marker };
    },
  });

  if (delegated.aborted && !stopError) {
    stopError = delegated.abortReason || "delegated run stalled";
  }

  const stderrLine = firstNonEmptyLine(delegated.stderr);
  const error = stopError || (delegated.exitCode !== 0 ? stderrLine || `pi exited with code ${delegated.exitCode}` : "");

  return {
    output: latestAssistantText,
    error,
    outcome: delegated,
  };
}

interface ParsedPiEvent {
  kind: "tool_start" | "tool_end" | "assistant" | "assistant_error" | "other";
  action: string;
  toolName?: string;
  text?: string;
  error?: string;
}

function parsePiEvent(line: string): ParsedPiEvent | null {
  if (!line.trim()) {
    return null;
  }

  try {
    const event = JSON.parse(line) as {
      type?: string;
      message?: Message;
      toolName?: string;
      toolCallId?: string;
    };

    if (event.type === "tool_execution_start" && event.toolName) {
      return {
        kind: "tool_start",
        action: `tool_start:${event.toolName}`,
        toolName: event.toolName,
      };
    }

    if (event.type === "tool_execution_end" && event.toolName) {
      return {
        kind: "tool_end",
        action: `tool_end:${event.toolName}`,
        toolName: event.toolName,
      };
    }

    if (event.type !== "message_end" || !event.message || event.message.role !== "assistant") {
      return {
        kind: "other",
        action: `event:${String(event.type ?? "unknown")}`,
      };
    }

    const text = extractAssistantText(event.message);
    const error = event.message.errorMessage ||
      (event.message.stopReason === "error" || event.message.stopReason === "aborted"
        ? event.message.stopReason
        : "");

    return {
      kind: error ? "assistant_error" : "assistant",
      action: error ? `assistant:${error}` : "assistant:message",
      text: text || undefined,
      error: error || undefined,
    };
  } catch {
    return {
      kind: "other",
      action: "event:malformed_json",
    };
  }
}

function buildBootstrapProgressFingerprint(
  latestAssistantText: string,
  stopError: string,
  markerKind: ParsedPiEvent["kind"],
): string {
  return `${latestAssistantText.length}|${stopError}|${markerKind}`;
}

export function parseBootstrapPlan(raw: string): BootstrapPlan | null {
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
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" || !parsed.files || typeof parsed.files !== "object") {
        continue;
      }

      const sanitized = sanitizePlanFiles(parsed.files);
      const notes = Array.isArray(parsed.notes)
        ? parsed.notes.filter((note): note is string => typeof note === "string" && note.trim().length > 0)
        : [];
      const recommendedTarget =
        typeof parsed.recommendedTarget === "string" && parsed.recommendedTarget.trim().length > 0
          ? parsed.recommendedTarget.trim()
          : undefined;

      const combinedNotes = dedupe([...notes, ...sanitized.notes]);

      return {
        files: sanitized.files,
        notes: combinedNotes.length > 0 ? combinedNotes : undefined,
        recommendedTarget,
      };
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

export async function detectRepoRoot(pi: ExtensionAPI, cwd: string): Promise<string> {
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
  overwriteReason = "overwritten by --force",
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
  changes.push({ path: filePath, action: "updated", reason: overwriteReason });
}

export function resolveOutputPath(repoRoot: string, relativePath: string): string | null {
  const candidate = relativePath.trim();
  if (!candidate) {
    return null;
  }

  if (path.isAbsolute(candidate) || /^[a-zA-Z]:[\\/]/.test(candidate)) {
    return null;
  }

  const normalized = candidate
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/");

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }

  const relative = segments.join("/");
  const absolute = path.resolve(repoRoot, relative);
  const rel = path.relative(repoRoot, absolute);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }

  return absolute;
}

function detectPackageManager(_repoRoot: string, topLevelFiles: string[]): string {
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
  if (topLevelFiles.includes("Package.swift")) {
    return "swiftpm";
  }
  if (topLevelFiles.includes("Cargo.toml")) {
    return "cargo";
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
  if (deps.has("convex")) hints.add("convex");
  if (topLevelFiles.includes("go.mod")) hints.add("go");
  if (topLevelFiles.includes("Package.swift") || (topLevelDirs.includes("Sources") && topLevelDirs.includes("Tests"))) {
    hints.add("swift");
    hints.add("swiftpm");
  }
  if (topLevelFiles.includes("Cargo.toml")) hints.add("rust");
  if (topLevelFiles.includes("pyproject.toml")) hints.add("python");
  if (topLevelDirs.includes("apps") || topLevelDirs.includes("packages")) hints.add("monorepo");

  return Array.from(hints.values()).sort();
}

export function inferRecommendedTarget(facts: RepoFacts, lanes: LaneResult[]): string {
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


function personaTemplate(facts: RepoFacts): string {
  const stack = facts.stackHints.join(", ") || "general software";
  const qualityScripts = facts.scripts.filter((script) => /test|lint|type|check|build/i.test(script));

  return [
    "# Local Persona",
    "",
    `Name: ${facts.domain}-operator`,
    "",
    "## Mission",
    `Operate as the most effective AI engineer for this repository (${facts.domain}) with strong local-context fit.`,
    "",
    "## Behavioral posture",
    "- Be decisive, practical, and explicit about tradeoffs.",
    "- Prefer root-cause fixes and strategic simplification over patches.",
    "- Keep changes auditable and scoped.",
    "",
    "## Context anchors",
    `- Domain: ${facts.domain}`,
    `- Stack hints: ${stack}`,
    `- Package manager: ${facts.packageManager}`,
    `- Quality scripts: ${qualityScripts.join(", ") || "none"}`,
    "",
    "## Delivery contract",
    "- Plan before non-trivial changes.",
    "- Verify with relevant local checks.",
    "- Report residual risk and follow-ups.",
    "",
  ].join("\n");
}

function agentsTemplate(facts: RepoFacts): string {
  return [
    "# AGENTS.md — " + facts.domain,
    "",
    "## Scope",
    "- " + facts.domain + " repository-specific Pi foundation.",
    "- Optimized for " + facts.stackHints.join(", ") + ".",
    "",
    "## Engineering doctrine",
    "- Root-cause remediation over symptom patching.",
    "- Favor convention over configuration.",
    "",
    "## Quality bar",
    "- " + (facts.packageManager === "npm" ? "Ensure \\`npm test\\` passes before merge." : "Ensure local tests pass before merge."),
    "- Meaningful test coverage over line-count gaming.",
  ].join("\\n");
}

function plannerTemplate(facts: RepoFacts): string {
  return [
    "---",
    "name: planner",
    `description: ${facts.domain} planning specialist grounded in repo-native constraints and delivery goals`,
    "tools: read, grep, find, ls, bash",
    "---",
    "",
    "Role: repo-local planner.",
    "Objective: convert intent into a focused implementation design that matches this repository's workflow reality.",
    "Latitude: explore context broadly, then compress into a minimal executable plan.",
    "Use `.pi/persona.md` as the base local persona contract.",
    "",
    "Success criteria:",
    `- align with package manager: ${facts.packageManager}`,
    `- align with stack hints: ${facts.stackHints.join(", ") || "none"}`,
    `- align with quality scripts: ${facts.scripts.filter((script) => /test|lint|type|check|build/i.test(script)).join(", ") || "none"}`,
    "",
    "Output contract:",
    "1. Goal",
    "2. Proposed approach",
    "3. Files and deltas",
    "4. Verification plan",
    "5. Risks and tradeoffs",
    "",
  ].join("\n");
}

function workerTemplate(facts: RepoFacts): string {
  return [
    "---",
    "name: worker",
    `description: ${facts.domain} implementation specialist for high-signal, low-bloat execution`,
    "tools: read, grep, find, ls, bash, edit, write",
    "---",
    "",
    "Role: repo-local implementer.",
    "Objective: execute approved scope with precision, explicit verification, and minimal collateral change.",
    "Latitude: use engineering judgment, but keep diffs auditable and focused.",
    "Use `.pi/persona.md` as the base local persona contract.",
    "",
    "Success criteria:",
    `- uses local tooling (${facts.packageManager}) and quality scripts when relevant`,
    "- no speculative refactors",
    "- clear changed-file summary and residual risk callout",
    "",
    "Output contract:",
    "1. What changed",
    "2. Verification run",
    "3. Risks / follow-ups",
    "",
  ].join("\n");
}

function reviewerTemplate(facts: RepoFacts): string {
  return [
    "---",
    "name: reviewer",
    `description: ${facts.domain} review specialist for correctness, quality gates, and long-term maintainability`,
    "tools: read, grep, find, ls, bash",
    "---",
    "",
    "Role: final reviewer.",
    "Objective: detect correctness, risk, and maintainability issues before shipping.",
    "Latitude: be concise, specific, and severity-driven.",
    "Use `.pi/persona.md` as the base local persona contract.",
    "",
    "Review focus:",
    `- stack hints: ${facts.stackHints.join(", ") || "none"}`,
    `- quality scripts: ${facts.scripts.filter((script) => /test|lint|type|check|build/i.test(script)).join(", ") || "none"}`,
    "",
    "Output contract:",
    "1. ✅ What is solid",
    "2. ⚠️ Findings (severity + path)",
    "3. 🔧 Required fixes",
    "4. 🚀 Ready / not-ready verdict",
    "",
  ].join("\n");
}

function teamsTemplate(_facts: RepoFacts): string {
  return [
    "foundation:",
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
    .slice(0, 4)
    .join(", ");

  return [
    "repo-foundation-v1:",
    '  description: "Explore repo context, design focused Pi setup, and pressure-test before apply"',
    "  steps:",
    "    - agent: planner",
    '      prompt: "Investigate repository workflow context and propose a focused Pi foundation for: $INPUT"',
    "    - agent: reviewer",
    '      prompt: "Stress-test this foundation design for risks, blind spots, and maintainability: \\n\\n$INPUT"',
    "",
    "repo-delivery-v1:",
    '  description: "Plan -> implement -> review loop for day-to-day engineering work"',
    "  steps:",
    "    - agent: planner",
    '      prompt: "Plan the implementation for: $INPUT"',
    "    - agent: worker",
    `      prompt: "Implement with focused scope and run relevant checks (${verificationHint || "repo checks"}):\\n\\n$INPUT"`,
    "    - agent: reviewer",
    '      prompt: "Review for correctness, quality gates, and maintainability:\\n\\n$INPUT"',
    "",
  ].join("\n");
}

function discoverPromptTemplate(_facts: RepoFacts): string {
  return [
    "---",
    "description: Explore this repository and map high-leverage work options",
    "---",
    "Use `.pi/agents/planner.md` as your operating overlay.",
    "",
    "Task: $@",
    "",
    "Memory-first context warmup:",
    "- If `memory_context` is available, run it early with scope `both` and a focused query for this task.",
    "- Prioritize local hits; use global hits only as fallback context.",
    "",
    "Goal:",
    "- Investigate the codebase and workflow context deeply.",
    "- Surface an adopt/bridge/ignore view for existing local machinery.",
    "- Return only high-signal options and a recommended next move.",
    "",
  ].join("\n");
}

function designPromptTemplate(_facts: RepoFacts): string {
  return [
    "---",
    "description: Design a focused implementation plan with explicit verification",
    "---",
    "Use `.pi/agents/planner.md` as your operating overlay.",
    "",
    "Task: $@",
    "",
    "Memory-first context warmup:",
    "- If `memory_context` is available, fetch a scoped context pack before finalizing the design.",
    "- Prefer local memory evidence first, then blend global analogs for edge-case awareness.",
    "",
    "Deliver a concise design and verification plan tailored to this repository.",
    "Avoid over-prescriptive checklists; prioritize clarity, tradeoffs, and execution readiness.",
    "",
  ].join("\n");
}

function deliverPromptTemplate(_facts: RepoFacts): string {
  return [
    "---",
    "description: Execute a scoped change using planner -> worker -> reviewer flow",
    "---",
    "Task: $@",
    "",
    "Preferred path:",
    "- If `/pipeline` is available, run `/pipeline repo-delivery-v1 $@`.",
    "- Otherwise execute the same flow manually using `.pi/agents/planner.md`, `.pi/agents/worker.md`, and `.pi/agents/reviewer.md`.",
    "",
    "Keep the patch focused, verify with relevant repo checks, and report residual risk.",
    "",
  ].join("\n");
}

function reviewPromptTemplate(_facts: RepoFacts): string {
  return [
    "---",
    "description: Review current changes for correctness, risk, and merge readiness",
    "---",
    "Use `.pi/agents/reviewer.md` as your operating overlay.",
    "",
    "Review target: $@",
    "",
    "Provide severity-tagged findings, required fixes, and a clear ready/not-ready verdict.",
    "",
  ].join("\n");
}

function localWorkflowTemplate(facts: RepoFacts): string {
  return [
    "# Pi Local Workflow",
    "",
    `This repository is bootstrapped for ${facts.domain} using repo-local Pi config under .pi/.`,
    "",
    "## Recommended run pattern",
    "",
    "1. Use meta mode when evolving architecture/config primitives:",
    "   - `pictl meta`",
    "2. Use build mode for normal project delivery:",
    "   - `pictl build`",
    "3. Use local prompt workflows:",
    "   - `/discover`",
    "   - `/design`",
    "   - `/deliver`",
    "   - `/review`",
    "4. Prime and use local-first memory:",
    "   - `/memory-ingest --scope both --force` (first run, then periodic refresh)",
    "   - `/memory-search --scope local <topic>`",
    "   - `/memory-context --scope both <goal>`",
    "5. If orchestration is enabled, run local pipelines:",
    "   - `/pipeline repo-foundation-v1 <goal>`",
    "   - `/pipeline repo-delivery-v1 <goal>`",
    "",
    "## Local artifacts",
    "",
    "- `.pi/settings.json`",
    "- `.pi/persona.md`",
    "- `.pi/agents/*.md`",
    "- `.pi/agents/teams.yaml`",
    "- `.pi/agents/pipelines.yaml`",
    "- `.pi/prompts/*.md`",
    "- `.pi/bootstrap-report.md`",
    "",
  ].join("\n");
}

function bootstrapModeLabel(): string {
  return "opinionated-max";
}

export function formatBootstrapSummary(result: BootstrapResult): string {
  const created = result.changes.filter((item) => item.action === "created").length;
  const updated = result.changes.filter((item) => item.action === "updated").length;
  const skipped = result.changes.filter((item) => item.action === "skipped").length;

  const lines = [
    `bootstrap-repo (${result.domain})`,
    `repo: ${result.repoRoot}`,
    `mode: ${result.mode}`,
    `duration: ${formatElapsed(result.elapsedMs)}`,
    `recommended target: pictl ${result.recommendedTarget}`,
    `quality gate: ${result.qualityGate.pass ? "pass" : "fail"} (ambition=${result.qualityGate.ambition.total} consensus=${result.qualityGate.consensus.score})`,
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

export function toErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return "unknown error";
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
