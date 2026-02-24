import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { evaluateCommandSafety, listGuardrailRules } from "./policy";

const POST_EDIT_DEBOUNCE_MS = 1000;
const POST_EDIT_TIMEOUT_MS = Number(process.env.PI_FAST_FEEDBACK_TIMEOUT_MS ?? 90_000);

interface GuardrailsState {
  postEditTimer?: ReturnType<typeof setTimeout>;
  postEditRunning: boolean;
  rerunRequested: boolean;
}

export default function guardrailsExtension(pi: ExtensionAPI): void {
  const state: GuardrailsState = {
    postEditRunning: false,
    rerunRequested: false,
  };

  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash") {
      return undefined;
    }

    const command = String(event.input.command ?? "");
    const decision = evaluateCommandSafety(command);
    if (!decision.block) {
      return undefined;
    }

    return {
      block: true,
      reason: decision.reason ?? "Blocked by guardrails policy.",
    };
  });

  pi.on("user_bash", async (event) => {
    const decision = evaluateCommandSafety(event.command);
    if (!decision.block) {
      return undefined;
    }
    return {
      result: {
        output: decision.reason ?? "Blocked by guardrails policy.",
        exitCode: 1,
        cancelled: true,
        truncated: false,
      },
    };
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.isError) {
      return undefined;
    }

    if (event.toolName === "write" || event.toolName === "edit") {
      schedulePostEditFeedback(pi, state, ctx);
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
        `Post-edit feedback: ${fastFeedback}`,
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}

function schedulePostEditFeedback(
  pi: ExtensionAPI,
  state: GuardrailsState,
  ctx: ExtensionContext
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
  ctx: ExtensionContext
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
      const stderr = firstNonEmptyLine(result.stderr) ?? firstNonEmptyLine(result.stdout);
      const suffix = stderr ? ` (${stderr})` : "";
      ctx.ui.notify(`Guardrails: post-edit checks failed${suffix}`, "warning");
    }
  } catch (error) {
    ctx.ui.notify(`Guardrails: post-edit checks error (${String(error)})`, "warning");
  } finally {
    ctx.ui.setStatus("guardrails", "");
    state.postEditRunning = false;
  }

  if (state.rerunRequested) {
    state.rerunRequested = false;
    void runPostEditFeedback(pi, state, ctx);
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
  if (existsSync(path.join(cwd, "bun.lock")) || existsSync(path.join(cwd, "bun.lockb"))) {
    return "bun";
  }
  return "npm";
}

function runnerCmd(runner: "npm" | "pnpm" | "yarn" | "bun", script: string): string {
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

function firstNonEmptyLine(text: string): string | null {
  const line = text
    .split("\n")
    .map((value) => value.trim())
    .find(Boolean);
  return line ?? null;
}
