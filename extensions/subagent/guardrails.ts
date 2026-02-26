export interface GuardrailBudget {
  maxTurns?: number;
  maxRuntimeSeconds?: number;
}

const MIN_MAX_TURNS = 5;
const MAX_MAX_TURNS = 500;
const MIN_MAX_RUNTIME_SECONDS = 15;
const MAX_MAX_RUNTIME_SECONDS = 7_200;

export function resolveGuardrailBudget(
  primary?: Partial<GuardrailBudget>,
  fallback?: Partial<GuardrailBudget>
): GuardrailBudget {
  return {
    maxTurns: clampOptionalInteger(
      primary?.maxTurns ?? fallback?.maxTurns,
      MIN_MAX_TURNS,
      MAX_MAX_TURNS
    ),
    maxRuntimeSeconds: clampOptionalInteger(
      primary?.maxRuntimeSeconds ?? fallback?.maxRuntimeSeconds,
      MIN_MAX_RUNTIME_SECONDS,
      MAX_MAX_RUNTIME_SECONDS
    ),
  };
}

export function appendSubagentExecutionContract(basePrompt: string, budget: GuardrailBudget): string {
  const lines = [
    basePrompt.trim(),
    "",
    "Execution contract:",
    "- Keep investigation bounded and converge quickly.",
    "- If evidence is sufficient, stop exploring and synthesize.",
    "- Emit concise status notes while working: `STATUS: <what changed> | next: <next action>`.",
  ];

  if (budget.maxTurns || budget.maxRuntimeSeconds) {
    const maxTurnsText = budget.maxTurns ? `${budget.maxTurns} assistant turns` : "unbounded assistant turns";
    const maxRuntimeText = budget.maxRuntimeSeconds ? `${budget.maxRuntimeSeconds}s runtime` : "unbounded runtime";
    lines.push(`- Explicit hard budget for this run: ${maxTurnsText} and ${maxRuntimeText}.`);
    lines.push("- If budget risk is high, summarize best-known answer with explicit uncertainty.");
  } else {
    lines.push("- No default turn/runtime budget is configured; continue while meaningful progress is being made.");
    lines.push("- If progress stalls, summarize known findings + uncertainty and exit.");
  }

  return lines.join("\n");
}

function clampOptionalInteger(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const rounded = Math.round(value);
  return Math.min(max, Math.max(min, rounded));
}
