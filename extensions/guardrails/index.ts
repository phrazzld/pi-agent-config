import { existsSync, readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";

import {
  appendPrGovernanceEvent,
  getPrGovernanceLogPath,
  readPrGovernanceEvents,
} from "../shared/pr-governance-log";
import { reviewerPolicyMatrixLines } from "../shared/reviewer-policy";
import { evaluateCommandSafety, listGuardrailRules } from "./policy";

const POST_EDIT_DEBOUNCE_MS = 1000;
const POST_EDIT_TIMEOUT_MS = Number(
  process.env.PI_FAST_FEEDBACK_TIMEOUT_MS ?? 90_000,
);
const PR_LINT_TIMEOUT_MS = Number(
  process.env.PI_PR_LINT_TIMEOUT_MS ?? 120_000,
);
const PR_TITLE_MAX_CHARS = clampNumber(
  Number(process.env.PI_PR_TITLE_MAX_CHARS ?? 72),
  40,
  120,
);
const PR_METADATA_AUTOFIX =
  process.env.PI_PR_GOVERNANCE_AUTOFIX?.toLowerCase() !== "false";

const ANSI_CSI_REGEX = new RegExp("\\u001b\\[[0-9;]*[A-Za-z]", "g");
const ANSI_OSC_REGEX = new RegExp("\\u001b\\][^\\u0007]*\\u0007", "g");

const LOG_NOISE_PATTERNS: RegExp[] = [
  /^\s*bun test v/i,
  /^\s*(stdout|stderr)\s*\|/i,
  /^\s*\(?(pass|fail)\)?\s/i,
  /^\s*created subscription for user/i,
  /^\s*updated subscription:/i,
  /^\s*expired subscription:/i,
  /^\s*marked subscription as/i,
  /^\s*updated subscription period end after payment/i,
  /^\s*test files\s+/i,
  /^\s*tests\s+\d+/i,
  /^\s*start at\s+/i,
  /^\s*duration\s+/i,
  /^\s*not implemented:\s+/i,
  /^\s*ran\s+\d+\s+tests?/i,
];

interface GuardrailsState {
  postEditTimer?: ReturnType<typeof setTimeout>;
  postEditRunning: boolean;
  rerunRequested: boolean;
  prLintRunning: boolean;
  prLintQueued: boolean;
  queuedPrCommand: string | null;
  prPromptPendingVerification: boolean;
  prPromptAutoReminderSent: boolean;
}

interface PullRequestMeta {
  number: number;
  title: string;
  body: string;
  url: string;
}

interface PrMetadataLintIssue {
  code: string;
  severity: "high" | "medium" | "low";
  message: string;
}

interface PrMetadataLintResult {
  issues: PrMetadataLintIssue[];
  fixedTitle: string;
  fixedBody: string;
}

interface PrMutationCommand {
  action: "create" | "edit";
  explicitPrNumber: number | null;
  usesInlineBody: boolean;
  usesBodyFile: boolean;
}

interface GitHubWriteCommand {
  target:
    | "pr-create"
    | "pr-edit"
    | "pr-comment"
    | "pr-review"
    | "issue-comment";
  usesInlineBody: boolean;
  usesBodyFile: boolean;
  raw: string;
}

export default function guardrailsExtension(pi: ExtensionAPI): void {
  const state: GuardrailsState = {
    postEditRunning: false,
    rerunRequested: false,
    prLintRunning: false,
    prLintQueued: false,
    queuedPrCommand: null,
    prPromptPendingVerification: false,
    prPromptAutoReminderSent: false,
  };

  pi.on("tool_call", async (event) => {
    if (event.toolName === "bash") {
      const command = String(event.input.command ?? "");

      const commandDecision = evaluateCommandSafety(command);
      if (commandDecision.block) {
        return {
          block: true,
          reason: commandDecision.reason ?? "Blocked by guardrails policy.",
        };
      }

      const prCommandDecision = evaluatePullRequestCommandSafety(command);
      if (prCommandDecision.block) {
        return {
          block: true,
          reason: prCommandDecision.reason ?? "Blocked by PR metadata guardrails.",
        };
      }

      return undefined;
    }

    return undefined;
  });

  pi.on("user_bash", async (event) => {
    const commandDecision = evaluateCommandSafety(event.command);
    if (commandDecision.block) {
      return {
        result: {
          output: commandDecision.reason ?? "Blocked by guardrails policy.",
          exitCode: 1,
          cancelled: true,
          truncated: false,
        },
      };
    }

    const prCommandDecision = evaluatePullRequestCommandSafety(event.command);
    if (prCommandDecision.block) {
      return {
        result: {
          output:
            prCommandDecision.reason ?? "Blocked by PR metadata guardrails.",
          exitCode: 1,
          cancelled: true,
          truncated: false,
        },
      };
    }

    return undefined;
  });

  pi.on("input", async (event) => {
    if (event.source === "extension") {
      return { action: "continue" };
    }

    if (isPrTemplateInvocation(event.text)) {
      state.prPromptPendingVerification = true;
      state.prPromptAutoReminderSent = false;
    }

    return { action: "continue" };
  });

  pi.on("before_agent_start", async (event) => {
    if (!state.prPromptPendingVerification) {
      return undefined;
    }

    return {
      systemPrompt:
        `${event.systemPrompt}\n\n` +
        "PR completion gate (non-negotiable): This /pr flow is not complete until a pull request exists for the current branch. If a PR does not exist, create one now with GitHub CLI using --body-file (never inline --body). In your final response, include a line `PR URL: <url>`. Verify existence before claiming completion.",
    };
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!state.prPromptPendingVerification) {
      return;
    }

    const prStatus = await findPrForCurrentBranch(pi, ctx.cwd);
    if (prStatus.found && prStatus.url) {
      state.prPromptPendingVerification = false;
      state.prPromptAutoReminderSent = false;
      if (ctx.hasUI) {
        ctx.ui.notify(
          `Guardrails: PR gate satisfied (${prStatus.url}).`,
          "success",
        );
      }
      return;
    }

    if (!state.prPromptAutoReminderSent) {
      state.prPromptAutoReminderSent = true;
      pi.sendUserMessage(
        "PR guard: A pull request for the current branch is still missing. Create it now using `gh pr create --body-file <path>` (or update existing with `gh pr edit --body-file <path>`), then report `PR URL: ...`.",
      );
      return;
    }

    if (ctx.hasUI) {
      const detail = prStatus.branch
        ? `No PR found for branch ${prStatus.branch}.`
        : "No PR found for current branch.";
      ctx.ui.notify(`Guardrails: ${detail}`, "warning");
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.isError) {
      return undefined;
    }

    if (event.toolName === "write" || event.toolName === "edit") {
      schedulePostEditFeedback(pi, state, ctx);
      return undefined;
    }

    if (event.toolName === "bash") {
      const command = String(event.input.command ?? "");
      if (parsePrMutationCommand(command)) {
        await schedulePrMetadataLint(pi, state, ctx, command);
      }
    }

    return undefined;
  });

  pi.registerCommand("guardrails", {
    description: "Show active guardrails policy",
    handler: async (_args, ctx) => {
      const fastFeedback = getPostEditCommand(ctx.cwd) ?? "(disabled)";
      const lines = [
        "Irreversible-command policy:",
        ...listGuardrailRules().map((rule) => `- ${rule}`),
        "",
        "PR metadata policy:",
        "- Inline --body/-b on GitHub write commands (`gh pr|issue ...`) is blocked (use --body-file/-F)",
        `- Auto-fix malformed PR title/body: ${PR_METADATA_AUTOFIX}`,
        `- PR title max chars: ${PR_TITLE_MAX_CHARS}`,
        `- PR governance log: ${getPrGovernanceLogPath()}`,
        "- /pr completion gate verifies PR exists for current branch before completion",
        "",
        `Post-edit feedback: ${fastFeedback}`,
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("pr-lint", {
    description:
      "Lint current PR title/body and auto-fix malformed metadata via gh pr edit",
    handler: async (_args, ctx) => {
      const command = "gh pr edit --title <guardrails-managed> --body-file <generated>";
      await runPrMetadataLint(pi, ctx, command, true);
    },
  });

  pi.registerCommand("pr-trends", {
    description: "Show recent PR governance trends from local NDJSON log",
    handler: async (args, ctx) => {
      const requestedLimit = Number(args.trim() || "200");
      const limit = clampNumber(
        Number.isFinite(requestedLimit) ? requestedLimit : 200,
        10,
        5000,
      );
      const events = await readPrGovernanceEvents(limit);
      if (events.length === 0) {
        ctx.ui.notify(
          `No PR governance events yet. Log path: ${getPrGovernanceLogPath()}`,
          "info",
        );
        return;
      }

      const lines = summarizeTrendEvents(events);
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("review-policy", {
    description: "Show reviewer severity policy matrix used by merge/readiness checks",
    handler: async (_args, ctx) => {
      const lines = [
        "Reviewer policy matrix (default):",
        "source | severity | decision          | default action",
        "------ | -------- | ----------------- | --------------",
        ...reviewerPolicyMatrixLines(),
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}

function schedulePostEditFeedback(
  pi: ExtensionAPI,
  state: GuardrailsState,
  ctx: ExtensionContext,
): void {
  if (state.postEditTimer) {
    clearTimeout(state.postEditTimer);
  }

  state.postEditTimer = setTimeout(() => {
    void runPostEditFeedback(pi, state, ctx);
  }, POST_EDIT_DEBOUNCE_MS);
}

async function runPostEditFeedback(
  pi: ExtensionAPI,
  state: GuardrailsState,
  ctx: ExtensionContext,
): Promise<void> {
  const command = getPostEditCommand(ctx.cwd);
  if (!command) {
    return;
  }

  if (state.postEditRunning) {
    state.rerunRequested = true;
    return;
  }

  state.postEditRunning = true;
  ctx.ui.setStatus("guardrails", "Running post-edit checks...");

  try {
    const result = await pi.exec("sh", ["-lc", command], {
      cwd: ctx.cwd,
      timeout: POST_EDIT_TIMEOUT_MS,
    });

    if (result.code === 0) {
      ctx.ui.notify("Guardrails: post-edit checks passed", "success");
    } else {
      const stderr =
        firstNonEmptyLine(result.stderr) ?? firstNonEmptyLine(result.stdout);
      const suffix = stderr ? ` (${stderr})` : "";
      ctx.ui.notify(`Guardrails: post-edit checks failed${suffix}`, "warning");
    }
  } catch (error) {
    ctx.ui.notify(
      `Guardrails: post-edit checks error (${String(error)})`,
      "warning",
    );
  } finally {
    ctx.ui.setStatus("guardrails", "");
    state.postEditRunning = false;
  }

  if (state.rerunRequested) {
    state.rerunRequested = false;
    void runPostEditFeedback(pi, state, ctx);
  }
}

async function schedulePrMetadataLint(
  pi: ExtensionAPI,
  state: GuardrailsState,
  ctx: ExtensionContext,
  command: string,
): Promise<void> {
  if (state.prLintRunning) {
    state.prLintQueued = true;
    state.queuedPrCommand = command;
    return;
  }

  state.prLintRunning = true;
  try {
    await runPrMetadataLint(pi, ctx, command, false);
  } finally {
    state.prLintRunning = false;
  }

  if (state.prLintQueued) {
    state.prLintQueued = false;
    const queued =
      state.queuedPrCommand ??
      "gh pr edit --title <guardrails-managed> --body-file <generated>";
    state.queuedPrCommand = null;
    await schedulePrMetadataLint(pi, state, ctx, queued);
  }
}

async function runPrMetadataLint(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  command: string,
  manualTrigger: boolean,
): Promise<void> {
  const parsedCommand = parsePrMutationCommand(command) ?? {
    action: "edit" as const,
    explicitPrNumber: null,
    usesInlineBody: false,
    usesBodyFile: true,
  };

  ctx.ui.setStatus("guardrails", "Linting PR metadata...");

  const metadata = await loadPullRequestMeta(
    pi,
    ctx.cwd,
    parsedCommand.explicitPrNumber,
  );

  if (!metadata) {
    ctx.ui.setStatus("guardrails", "");
    if (manualTrigger) {
      ctx.ui.notify(
        "Guardrails: no pull request found for current branch.",
        "warning",
      );
    }
    return;
  }

  const lint = lintPullRequestMetadata(metadata);
  const titleChanged = lint.fixedTitle !== metadata.title;
  const bodyChanged = lint.fixedBody !== metadata.body;

  if (lint.issues.length === 0) {
    ctx.ui.setStatus("guardrails", "");
    if (manualTrigger) {
      ctx.ui.notify(
        `Guardrails: PR #${metadata.number} title/body look clean.`,
        "success",
      );
    }

    await appendPrGovernanceEvent({
      ts: Date.now(),
      kind: "pr_metadata_lint",
      status: "pass",
      repo: repoFromPullRequestUrl(metadata.url),
      prNumber: metadata.number,
      details: {
        issueCodes: [],
        autoFixEnabled: PR_METADATA_AUTOFIX,
        manualTrigger,
      },
    });
    return;
  }

  if (!PR_METADATA_AUTOFIX || (!titleChanged && !bodyChanged)) {
    ctx.ui.setStatus("guardrails", "");
    ctx.ui.notify(
      `Guardrails: PR #${metadata.number} metadata issues detected (${lint.issues
        .map((issue) => issue.code)
        .join(", ")}).`,
      "warning",
    );

    await appendPrGovernanceEvent({
      ts: Date.now(),
      kind: "pr_metadata_lint",
      status: "warn",
      repo: repoFromPullRequestUrl(metadata.url),
      prNumber: metadata.number,
      details: {
        issueCodes: lint.issues.map((issue) => issue.code),
        autoFixEnabled: PR_METADATA_AUTOFIX,
        titleChanged,
        bodyChanged,
        manualTrigger,
      },
    });
    return;
  }

  const editResult = await updatePullRequestMeta(pi, ctx.cwd, {
    ...metadata,
    title: lint.fixedTitle,
    body: lint.fixedBody,
  });

  ctx.ui.setStatus("guardrails", "");

  if (editResult.ok) {
    ctx.ui.notify(
      `Guardrails: auto-fixed PR #${metadata.number} metadata (${lint.issues
        .map((issue) => issue.code)
        .join(", ")}).`,
      "success",
    );

    await appendPrGovernanceEvent({
      ts: Date.now(),
      kind: "pr_metadata_lint",
      status: "fixed",
      repo: repoFromPullRequestUrl(metadata.url),
      prNumber: metadata.number,
      details: {
        issueCodes: lint.issues.map((issue) => issue.code),
        titleChanged,
        bodyChanged,
        manualTrigger,
      },
    });
  } else {
    ctx.ui.notify(
      `Guardrails: failed to auto-fix PR #${metadata.number} metadata (${editResult.reason}).`,
      "warning",
    );

    await appendPrGovernanceEvent({
      ts: Date.now(),
      kind: "pr_metadata_lint",
      status: "error",
      repo: repoFromPullRequestUrl(metadata.url),
      prNumber: metadata.number,
      details: {
        issueCodes: lint.issues.map((issue) => issue.code),
        reason: editResult.reason,
        manualTrigger,
      },
    });
  }
}

function getPostEditCommand(cwd: string): string | null {
  const explicit = process.env.PI_FAST_FEEDBACK_CMD?.trim();
  if (explicit) {
    return explicit;
  }

  const packageJsonPath = path.join(cwd, "package.json");
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch {
    return null;
  }

  const scripts = (parsed as { scripts?: Record<string, string> }).scripts;
  if (!scripts) {
    return null;
  }

  const runner = detectRunner(cwd);
  const hasLint = Boolean(scripts.lint);
  const hasTypecheck = Boolean(scripts.typecheck);
  const hasCheck = Boolean(scripts.check);
  const hasTest = Boolean(scripts.test);

  if (hasLint && hasTypecheck) {
    return `${runnerCmd(runner, "typecheck")} && ${runnerCmd(runner, "lint")}`;
  }
  if (hasCheck) {
    return runnerCmd(runner, "check");
  }
  if (hasTypecheck) {
    return runnerCmd(runner, "typecheck");
  }
  if (hasLint) {
    return runnerCmd(runner, "lint");
  }
  if (hasTest) {
    return runnerCmd(runner, "test");
  }

  return null;
}

function detectRunner(cwd: string): "npm" | "pnpm" | "yarn" | "bun" {
  if (existsSync(path.join(cwd, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(path.join(cwd, "yarn.lock"))) {
    return "yarn";
  }
  if (
    existsSync(path.join(cwd, "bun.lock")) ||
    existsSync(path.join(cwd, "bun.lockb"))
  ) {
    return "bun";
  }
  return "npm";
}

function runnerCmd(
  runner: "npm" | "pnpm" | "yarn" | "bun",
  script: string,
): string {
  if (runner === "pnpm") {
    return `pnpm -s ${script}`;
  }
  if (runner === "yarn") {
    return `yarn ${script} --silent`;
  }
  if (runner === "bun") {
    return `bun run ${script}`;
  }
  return `npm run -s ${script}`;
}

function isPrTemplateInvocation(text: string): boolean {
  const trimmed = text.trim();
  return /^\/pr(?:\s|$)/.test(trimmed);
}

async function findPrForCurrentBranch(
  pi: ExtensionAPI,
  cwd: string,
): Promise<{ found: boolean; url?: string; branch?: string }> {
  const branchResult = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    timeout: 10_000,
  });

  if (branchResult.code !== 0) {
    return { found: false };
  }

  const branch = branchResult.stdout.trim();
  if (!branch) {
    return { found: false };
  }

  const prListResult = await pi.exec(
    "gh",
    [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "all",
      "--limit",
      "1",
      "--json",
      "url,state",
    ],
    {
      cwd,
      timeout: 15_000,
    },
  );

  if (prListResult.code !== 0) {
    return { found: false, branch };
  }

  try {
    const parsed = JSON.parse(prListResult.stdout) as Array<{
      url?: string;
      state?: string;
    }>;

    const item = parsed.find((entry) => Boolean(entry.url));
    if (!item?.url) {
      return { found: false, branch };
    }

    return { found: true, url: item.url, branch };
  } catch {
    return { found: false, branch };
  }
}

function evaluatePullRequestCommandSafety(command: string): {
  block: boolean;
  reason?: string;
} {
  const parsedWrite = parseGitHubWriteCommand(command);
  if (parsedWrite && parsedWrite.usesInlineBody && !parsedWrite.usesBodyFile) {
    return {
      block: true,
      reason:
        "Blocked: use `--body-file/-F <path>` for GitHub writes (`gh pr|issue ...`) instead of inline `--body/-b` to avoid shell interpolation and malformed markdown.",
    };
  }

  const parsedPr = parsePrMutationCommand(command);
  if (!parsedPr) {
    return { block: false };
  }

  if (parsedPr.usesInlineBody && !parsedPr.usesBodyFile) {
    return {
      block: true,
      reason:
        "Blocked: use `gh pr create/edit --body-file <path>` instead of inline --body/-b to prevent shell interpolation and malformed PR markdown.",
    };
  }

  return { block: false };
}

function parseGitHubWriteCommand(command: string): GitHubWriteCommand | null {
  const normalized = command.trim();
  if (!normalized.startsWith("gh ")) {
    return null;
  }

  const rules: Array<{ target: GitHubWriteCommand["target"]; pattern: RegExp }> = [
    { target: "pr-create", pattern: /\bgh\s+pr\s+create\b/i },
    { target: "pr-edit", pattern: /\bgh\s+pr\s+edit\b/i },
    { target: "pr-comment", pattern: /\bgh\s+pr\s+comment\b/i },
    { target: "pr-review", pattern: /\bgh\s+pr\s+review\b/i },
    { target: "issue-comment", pattern: /\bgh\s+issue\s+comment\b/i },
  ];

  const matched = rules.find((rule) => rule.pattern.test(normalized));
  if (!matched) {
    return null;
  }

  return {
    target: matched.target,
    usesInlineBody: /(^|\s)(--body|-b)(\s|=)/.test(normalized),
    usesBodyFile: /(^|\s)(--body-file|-F)(\s|=)/.test(normalized),
    raw: normalized,
  };
}

function parsePrMutationCommand(command: string): PrMutationCommand | null {
  const actionMatch = command.match(/\bgh\s+pr\s+(create|edit)\b/i);
  if (!actionMatch) {
    return null;
  }

  const action = actionMatch[1].toLowerCase() as "create" | "edit";
  const usesInlineBody = /(^|\s)(--body|-b)(\s|=)/.test(command);
  const usesBodyFile = /(^|\s)(--body-file|-F)(\s|=)/.test(command);

  let explicitPrNumber: number | null = null;
  if (action === "edit") {
    const prMatch = command.match(/\bgh\s+pr\s+edit\s+(?:#)?(\d+)\b/i);
    explicitPrNumber = prMatch ? Number(prMatch[1]) : null;
  }

  return {
    action,
    explicitPrNumber,
    usesInlineBody,
    usesBodyFile,
  };
}

async function loadPullRequestMeta(
  pi: ExtensionAPI,
  cwd: string,
  prNumber: number | null,
): Promise<PullRequestMeta | null> {
  const args = [
    "pr",
    "view",
    ...(prNumber ? [String(prNumber)] : []),
    "--json",
    "number,title,body,url",
  ];

  const result = await pi.exec("gh", args, {
    cwd,
    timeout: PR_LINT_TIMEOUT_MS,
  });
  if (result.code !== 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout) as PullRequestMeta;
    if (
      !parsed ||
      !Number.isInteger(parsed.number) ||
      typeof parsed.title !== "string" ||
      typeof parsed.body !== "string" ||
      typeof parsed.url !== "string"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function lintPullRequestMetadata(meta: PullRequestMeta): PrMetadataLintResult {
  const issues: PrMetadataLintIssue[] = [];

  if (!meta.title.trim()) {
    issues.push({
      code: "empty-title",
      severity: "high",
      message: "PR title is empty.",
    });
  }

  if (/\\n/.test(meta.title)) {
    issues.push({
      code: "escaped-newlines-title",
      severity: "high",
      message: "PR title includes escaped newline literals.",
    });
  }

  if (looksLikeNoiseLine(meta.title)) {
    issues.push({
      code: "title-log-noise",
      severity: "high",
      message: "PR title looks like accidental command output.",
    });
  }

  if (meta.title.trim().length > PR_TITLE_MAX_CHARS) {
    issues.push({
      code: "title-too-long",
      severity: "medium",
      message: `PR title exceeds ${PR_TITLE_MAX_CHARS} characters.`,
    });
  }

  if (/\\n/.test(meta.body)) {
    issues.push({
      code: "escaped-newlines-body",
      severity: "high",
      message: "PR body includes escaped newline literals.",
    });
  }

  if (containsAnsi(meta.body)) {
    issues.push({
      code: "ansi-artifacts",
      severity: "medium",
      message: "PR body contains ANSI control sequences.",
    });
  }

  if (countNoiseLines(meta.body) > 0) {
    issues.push({
      code: "body-log-noise",
      severity: "high",
      message: "PR body contains raw command/test output lines.",
    });
  }

  if (/^\s*-\s*$/m.test(meta.body)) {
    issues.push({
      code: "empty-bullets",
      severity: "medium",
      message: "PR body contains empty bullet points.",
    });
  }

  const fixedBody = normalizePullRequestBody(meta.body);
  const fixedTitle = normalizePullRequestTitle(meta.title, fixedBody);

  return {
    issues: dedupeIssues(issues),
    fixedTitle,
    fixedBody,
  };
}

function normalizePullRequestTitle(title: string, body: string): string {
  let next = stripAnsi(title)
    .replace(/\\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!next || looksLikeNoiseLine(next)) {
    const summaryLine = firstSummaryLine(body);
    if (summaryLine) {
      const compact = truncate(summaryLine, 56);
      next = `chore: ${compact}`;
    } else {
      next = "chore: Update pull request details";
    }
  }

  if (next.length > PR_TITLE_MAX_CHARS) {
    next = `${next.slice(0, PR_TITLE_MAX_CHARS - 1).trimEnd()}…`;
  }

  return next;
}

function normalizePullRequestBody(body: string): string {
  const withRealNewlines = body.replace(/\\n/g, "\n");
  const stripped = stripAnsi(withRealNewlines).replace(/\r\n/g, "\n");

  const lines = stripped.split("\n");
  const out: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      out.push(line);
      continue;
    }

    if (!inCodeBlock && looksLikeNoiseLine(line)) {
      continue;
    }

    if (!inCodeBlock && /^\s*-\s*$/.test(line)) {
      continue;
    }

    out.push(line);
  }

  const collapsed = collapseBlankLines(out.join("\n")).trim();
  if (collapsed.length > 0) {
    return collapsed;
  }

  return stripped.trim();
}

async function updatePullRequestMeta(
  pi: ExtensionAPI,
  cwd: string,
  meta: PullRequestMeta,
): Promise<{ ok: boolean; reason?: string }> {
  const tempBodyPath = path.join(
    tmpdir(),
    `pi-pr-body-${meta.number}-${Date.now()}.md`,
  );

  try {
    await fs.writeFile(tempBodyPath, meta.body, "utf8");

    const editResult = await pi.exec(
      "gh",
      [
        "pr",
        "edit",
        String(meta.number),
        "--title",
        meta.title,
        "--body-file",
        tempBodyPath,
      ],
      {
        cwd,
        timeout: PR_LINT_TIMEOUT_MS,
      },
    );

    if (editResult.code !== 0) {
      return {
        ok: false,
        reason:
          firstNonEmptyLine(editResult.stderr) ??
          firstNonEmptyLine(editResult.stdout) ??
          "gh pr edit failed",
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await fs.unlink(tempBodyPath).catch(() => undefined);
  }
}

function summarizeTrendEvents(
  events: Array<{
    kind?: string;
    status?: string;
    ts?: number;
    details?: Record<string, unknown>;
  }>,
): string[] {
  const byKind = new Map<string, number>();
  const byStatus = new Map<string, number>();
  const issueCodeCounts = new Map<string, number>();

  for (const event of events) {
    const kind = event.kind ?? "unknown";
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);

    const status = event.status ?? "unknown";
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);

    const issueCodes = Array.isArray(event.details?.issueCodes)
      ? (event.details?.issueCodes as string[])
      : [];
    for (const code of issueCodes) {
      issueCodeCounts.set(code, (issueCodeCounts.get(code) ?? 0) + 1);
    }
  }

  const latestTs = events
    .map((event) => Number(event.ts ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b - a)[0];

  const lines = [
    `PR governance trends (events=${events.length})`,
    `Log: ${getPrGovernanceLogPath()}`,
  ];

  if (latestTs) {
    lines.push(`Latest event: ${new Date(latestTs).toISOString()}`);
  }

  lines.push("", "By kind:");
  for (const [kind, count] of sortDesc(byKind)) {
    lines.push(`- ${kind}: ${count}`);
  }

  lines.push("", "By status:");
  for (const [status, count] of sortDesc(byStatus)) {
    lines.push(`- ${status}: ${count}`);
  }

  if (issueCodeCounts.size > 0) {
    lines.push("", "Top metadata issues:");
    for (const [code, count] of sortDesc(issueCodeCounts).slice(0, 8)) {
      lines.push(`- ${code}: ${count}`);
    }
  }

  return lines;
}

function sortDesc(values: Map<string, number>): Array<[string, number]> {
  return Array.from(values.entries()).sort((a, b) => b[1] - a[1]);
}

function repoFromPullRequestUrl(url: string): string | undefined {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\//i);
  if (!match) {
    return undefined;
  }
  return `${match[1]}/${match[2]}`;
}

function countNoiseLines(text: string): number {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => looksLikeNoiseLine(line)).length;
}

function looksLikeNoiseLine(line: string): boolean {
  return LOG_NOISE_PATTERNS.some((pattern) => pattern.test(line));
}

function firstSummaryLine(body: string): string | null {
  const cleaned = body.replace(/\\n/g, "\n");
  for (const line of cleaned.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("#")) {
      continue;
    }
    if (trimmed.startsWith("- ")) {
      return trimmed.slice(2).trim();
    }
  }

  const first = cleaned
    .split("\n")
    .map((value) => value.trim())
    .find(Boolean);
  return first ?? null;
}

function dedupeIssues(issues: PrMetadataLintIssue[]): PrMetadataLintIssue[] {
  const seen = new Set<string>();
  const out: PrMetadataLintIssue[] = [];

  for (const issue of issues) {
    if (seen.has(issue.code)) {
      continue;
    }
    seen.add(issue.code);
    out.push(issue);
  }

  return out;
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_CSI_REGEX, "").replace(ANSI_OSC_REGEX, "");
}

function containsAnsi(value: string): boolean {
  return stripAnsi(value) !== value;
}

function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}

function truncate(text: string, maxChars: number): string {
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

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}
