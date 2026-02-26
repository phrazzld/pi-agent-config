import { describe, expect, test } from "bun:test";

import {
  appendSubagentExecutionContract,
  resolveGuardrailBudget,
} from "../guardrails";

describe("subagent guardrail budget", () => {
  test("defaults to no explicit hard caps", () => {
    const budget = resolveGuardrailBudget();
    expect(budget.maxTurns).toBeUndefined();
    expect(budget.maxRuntimeSeconds).toBeUndefined();
  });

  test("clamps explicit hard caps into safe bounds", () => {
    const budget = resolveGuardrailBudget({
      maxTurns: 2,
      maxRuntimeSeconds: 10,
    });

    expect(budget.maxTurns).toBe(5);
    expect(budget.maxRuntimeSeconds).toBe(15);

    const high = resolveGuardrailBudget({
      maxTurns: 5_000,
      maxRuntimeSeconds: 999_999,
    });

    expect(high.maxTurns).toBe(500);
    expect(high.maxRuntimeSeconds).toBe(7_200);
  });

  test("execution contract is progress-first when no caps configured", () => {
    const prompt = appendSubagentExecutionContract("Base prompt", {});

    expect(prompt).toContain("Execution contract");
    expect(prompt).toContain("No default turn/runtime budget is configured");
    expect(prompt).toContain("If progress stalls");
    expect(prompt).not.toContain("Explicit hard budget for this run");
  });

  test("execution contract includes explicit cap line when configured", () => {
    const prompt = appendSubagentExecutionContract("Base prompt", {
      maxTurns: 42,
      maxRuntimeSeconds: 600,
    });

    expect(prompt).toContain("Explicit hard budget for this run: 42 assistant turns and 600s runtime.");
    expect(prompt).toContain("If budget risk is high");
  });
});
