import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type DaybookTone = "charismatic" | "calm" | "coach";

interface DaybookState {
  tone: DaybookTone;
}

const DEFAULT_TONE: DaybookTone = "charismatic";

export default function daybookExtension(pi: ExtensionAPI): void {
  let state: DaybookState = { tone: DEFAULT_TONE };

  pi.registerCommand("daybook-tone", {
    description: "Set daybook tone. Usage: /daybook-tone charismatic|calm|coach",
    handler: async (args, ctx) => {
      const requested = args.trim().toLowerCase();
      if (!requested) {
        ctx.ui.notify(`Current daybook tone: ${state.tone}`, "info");
        return;
      }

      if (!isTone(requested)) {
        ctx.ui.notify("Usage: /daybook-tone charismatic|calm|coach", "warning");
        return;
      }

      state.tone = requested;
      persistState(pi, state);
      ctx.ui.notify(`Daybook tone set to ${state.tone}.`, "success");
    },
  });

  pi.registerCommand("daybook-kickoff", {
    description: "Seed a daybook check-in prompt",
    handler: async (_args, ctx) => {
      const seed = [
        "Daybook check-in:",
        "- What happened today?",
        "- What felt energizing vs draining?",
        "- What is one concrete next move for tomorrow?",
      ].join("\n");

      if (ctx.isIdle()) {
        pi.sendUserMessage(seed);
      } else {
        pi.sendUserMessage(seed, { deliverAs: "followUp" });
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    state = restoreState(ctx) ?? state;
    ctx.ui.setStatus("daybook", `tone=${state.tone}`);
  });

  pi.on("session_tree", async (_event, ctx) => {
    state = restoreState(ctx) ?? state;
    ctx.ui.setStatus("daybook", `tone=${state.tone}`);
  });

  pi.on("before_agent_start", async (event) => {
    const instruction = buildDaybookInstruction(state.tone);
    return {
      systemPrompt: `${event.systemPrompt}\n\n${instruction}`,
    };
  });
}

function buildDaybookInstruction(tone: DaybookTone): string {
  const toneLine =
    tone === "charismatic"
      ? "Voice: charismatic, warm, engaging, and vivid."
      : tone === "coach"
        ? "Voice: practical coach — clear, motivating, structured."
        : "Voice: calm, reflective, and emotionally steady.";

  return [
    "Daybook mode:",
    "- Prioritize high-quality journaling conversation over coding execution.",
    "- Keep this as one-on-one dialogue; avoid suggesting team orchestration unless explicitly requested.",
    "- Ask grounded follow-up questions when it improves reflection quality.",
    "- Use tool calls only when they add clear value (web retrieval for current facts, local reads for prior notes).",
    "- If uncertain, state uncertainty plainly.",
    toneLine,
  ].join("\n");
}

function persistState(pi: ExtensionAPI, state: DaybookState): void {
  pi.appendEntry<DaybookState>("daybook-state", state);
}

function restoreState(ctx: ExtensionContext): DaybookState | null {
  let latest: DaybookState | null = null;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== "daybook-state") {
      continue;
    }
    const data = entry.data as DaybookState | undefined;
    if (data && isTone(data.tone)) {
      latest = data;
    }
  }
  return latest;
}

function isTone(value: string): value is DaybookTone {
  return value === "charismatic" || value === "calm" || value === "coach";
}
